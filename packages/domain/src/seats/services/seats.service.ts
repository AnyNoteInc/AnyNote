import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import {
  BILLING_AUDIT_ACTIONS,
  INVOICE_MAX_PERIOD_MONTHS,
  INVOICE_MIN_PERIOD_MONTHS,
  MAX_SEAT_PURCHASE,
  MIN_SEAT_PURCHASE,
  isValidInn,
  isValidKpp,
  prorateSeatPurchase,
  seatsError,
} from '../dto/seats.dto.ts'
import type {
  ApplySeatPurchaseInput,
  ApplySeatPurchaseResult,
  BeginSeatPurchaseInput,
  BeginSeatPurchaseResult,
  CancelScheduledReductionInput,
  CreateInvoiceRequestInput,
  CreateInvoiceRequestResult,
  InvoiceRequestDto,
  OwnerSeatCharge,
  ResetAddonsResult,
  ScheduleSeatReductionInput,
  SeatBillingPeriod,
  SeatPriceInfo,
  SeatReductionState,
  SeatUsage,
} from '../dto/seats.dto.ts'
import type {
  InvoiceRequestRow,
  SeatPlanRow,
  SeatsRepository,
} from '../repositories/seats.repository.ts'

function pickSeatPrice(plan: SeatPlanRow, billingPeriod: SeatBillingPeriod): number {
  return billingPeriod === 'YEARLY'
    ? plan.pricePerExtraSeatYearlyKopecks
    : plan.pricePerExtraSeatMonthlyKopecks
}

function toInvoiceRequestDto(row: InvoiceRequestRow): InvoiceRequestDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    legalName: row.legalName,
    inn: row.inn,
    kpp: row.kpp,
    legalAddress: row.legalAddress,
    contactEmail: row.contactEmail,
    periodMonths: row.periodMonths,
    seats: row.seats,
    comment: row.comment,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class SeatsService {
  private readonly repo: SeatsRepository
  private readonly uow: UnitOfWork

  constructor(repo: SeatsRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  // ── counting (spec §7.1/§7.2) ─────────────────────────────────────────────────

  /**
   * Billable seats = `WorkspaceMember` rows: OWNER included, blocked included
   * (seats free only on removal), every role counted. Guests are excluded by
   * construction — they have no member row.
   */
  async countBillableSeats(workspaceId: string): Promise<number> {
    return this.repo.countMembers(workspaceId)
  }

  // ── usage (spec §3) ───────────────────────────────────────────────────────────

  async getSeatUsage(workspaceId: string): Promise<SeatUsage> {
    const workspace = await this.repo.findWorkspace(workspaceId)
    if (!workspace) throw notFound('Пространство не найдено')

    const [memberCount, addon, limit, sub] = await Promise.all([
      this.repo.countMembers(workspaceId),
      this.repo.findSeatAddon(workspaceId),
      this.repo.findWorkspaceLimit(workspaceId),
      workspace.createdById
        ? this.repo.findActiveSubscriptionWithPlan(workspace.createdById)
        : Promise.resolve(null),
    ])
    const plan = sub?.plan ?? (await this.repo.findPersonalPlan())

    // WorkspaceLimit is the OPERATIVE capacity source (the people module's
    // enforcement reads it) — usage must agree with enforcement, so the plan
    // count is only the no-limit-row fallback.
    const includedSeats = limit?.maxMembers ?? plan.maxMembersPerWorkspace
    const billingPeriod = sub?.billingPeriod ?? 'MONTHLY'
    const currentKopecks = pickSeatPrice(plan, billingPeriod)
    const seatPrice: SeatPriceInfo | null =
      currentKopecks > 0
        ? {
            monthlyKopecks: plan.pricePerExtraSeatMonthlyKopecks,
            yearlyKopecks: plan.pricePerExtraSeatYearlyKopecks,
            currentKopecks,
            billingPeriod,
          }
        : null
    const paidSeats = addon?.paidSeats ?? 0

    return {
      memberCount,
      includedSeats,
      paidSeats,
      scheduledSeats: addon?.scheduledSeats ?? null,
      capacity: includedSeats + paidSeats,
      seatPrice,
      periodEnd: sub?.currentPeriodEnd ?? null,
      canPurchase: currentKopecks > 0 && sub?.status === 'ACTIVE',
    }
  }

  // ── purchase (spec §3/§7.4/§7.6) ──────────────────────────────────────────────

  /**
   * Gate order per spec §3: the actor must BE the workspace's `createdById`
   * subscription holder (only the paying owner buys), the plan must sell seats,
   * the count must be sane, the paid period must still be running. Returns the
   * order payload — the tRPC layer creates the Order + YooKassa payment.
   */
  async beginSeatPurchase(input: BeginSeatPurchaseInput): Promise<BeginSeatPurchaseResult> {
    const workspace = await this.repo.findWorkspace(input.workspaceId)
    if (!workspace) throw notFound('Пространство не найдено')
    if (!workspace.createdById || workspace.createdById !== input.actorId) {
      throw seatsError('NOT_SUBSCRIPTION_OWNER')
    }

    const sub = await this.repo.findActiveSubscriptionWithPlan(input.actorId)
    const seatPriceKopecks = sub ? pickSeatPrice(sub.plan, sub.billingPeriod) : 0
    // canPurchase parity (spec §3): price > 0 AND status strictly ACTIVE —
    // TRIAL/PAST_DUE owners must settle the tier first.
    if (!sub || sub.status !== 'ACTIVE' || seatPriceKopecks <= 0) {
      throw seatsError('SEATS_NOT_AVAILABLE')
    }

    if (
      !Number.isInteger(input.seats) ||
      input.seats < MIN_SEAT_PURCHASE ||
      input.seats > MAX_SEAT_PURCHASE
    ) {
      throw seatsError('INVALID_SEAT_COUNT')
    }

    if (!sub.currentPeriodStart || !sub.currentPeriodEnd) throw seatsError('PERIOD_ENDED')
    const amountKopecks = prorateSeatPurchase({
      seats: input.seats,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now: input.now ?? new Date(),
      seatPriceKopecks,
    })
    return {
      seats: input.seats,
      amountKopecks,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
    }
  }

  /**
   * Settle a PAID seat-purchase order: addon += seats, SEATS_PURCHASED ledger
   * row, audit — one transaction.
   *
   * DELIBERATELY NOT idempotent at this layer: the CALLER's order-status guard
   * is the idempotency boundary (the `handlePaymentSucceeded` precedent flips
   * the Order PENDING→PAID exactly once and calls this inside the same tx).
   * Calling it twice for one order would double the seats AND the ledger.
   */
  async applySeatPurchase(input: ApplySeatPurchaseInput): Promise<ApplySeatPurchaseResult> {
    return this.uow.transaction(async () => {
      const paidSeats = await this.repo.incrementPaidSeats(input.workspaceId, input.seats)
      await this.repo.writeSeatEvent({
        workspaceId: input.workspaceId,
        type: 'SEATS_PURCHASED',
        seatsDelta: input.seats,
        seatsAfter: paidSeats,
        amountKopecks: input.amountKopecks,
        orderId: input.orderId,
        actorId: input.actorId,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: BILLING_AUDIT_ACTIONS.seatsPurchased,
        metadata: {
          seats: input.seats,
          seatsAfter: paidSeats,
          amountKopecks: input.amountKopecks,
          orderId: input.orderId,
        },
      })
      return { paidSeats }
    })
  }

  // ── reduction (spec §3/§7.4/§7.5) ────────────────────────────────────────────

  /**
   * Reductions never refund mid-cycle: `paidSeats` stays untouched until the
   * next renewal applies `scheduledSeats`. The capacity AFTER the reduction
   * must still fit the CURRENT member count — remove members first.
   */
  async scheduleSeatReduction(input: ScheduleSeatReductionInput): Promise<SeatReductionState> {
    if (!Number.isInteger(input.targetSeats) || input.targetSeats < 0) {
      throw seatsError('REDUCTION_INVALID_TARGET')
    }
    return this.uow.transaction(async () => {
      const addon = await this.repo.findSeatAddon(input.workspaceId)
      const paidSeats = addon?.paidSeats ?? 0
      if (input.targetSeats >= paidSeats) throw seatsError('REDUCTION_INVALID_TARGET')

      const includedSeats = await this.resolveIncludedSeats(input.workspaceId)
      const memberCount = await this.repo.countMembers(input.workspaceId)
      if (includedSeats + input.targetSeats < memberCount) {
        throw seatsError('REDUCTION_BELOW_USAGE')
      }

      await this.repo.setScheduledSeats(input.workspaceId, input.targetSeats)
      await this.repo.writeSeatEvent({
        workspaceId: input.workspaceId,
        type: 'SEATS_REDUCTION_SCHEDULED',
        seatsDelta: input.targetSeats - paidSeats,
        seatsAfter: paidSeats,
        actorId: input.actorId,
        metadata: { targetSeats: input.targetSeats },
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: BILLING_AUDIT_ACTIONS.seatsReductionScheduled,
        metadata: { targetSeats: input.targetSeats, paidSeats },
      })
      return { paidSeats, scheduledSeats: input.targetSeats }
    })
  }

  /**
   * Idempotent: clearing an absent schedule (or addon) is a calm no-op. No
   * ledger/audit — the §2 catalog has no cancel entries; the schedule row
   * stays in the ledger as history and the cleared state is the record.
   */
  async cancelScheduledReduction(
    input: CancelScheduledReductionInput,
  ): Promise<SeatReductionState> {
    return this.uow.transaction(async () => {
      const addon = await this.repo.findSeatAddon(input.workspaceId)
      if (!addon || addon.scheduledSeats === null) {
        return { paidSeats: addon?.paidSeats ?? 0, scheduledSeats: null }
      }
      await this.repo.clearScheduledSeats(input.workspaceId)
      return { paidSeats: addon.paidSeats, scheduledSeats: null }
    })
  }

  // ── renewal hooks (spec §3 — consumed by the engines cron, Task 4) ───────────

  /**
   * paidSeats = scheduledSeats ?? paidSeats; scheduled cleared. Returns the
   * effective count. NO ledger here — the renewal caller writes SEATS_RENEWED
   * with the charge, in the same tx (the ALS UnitOfWork joins automatically).
   */
  async applyScheduledSeats(workspaceId: string): Promise<number> {
    return this.uow.transaction(async () => {
      const addon = await this.repo.findSeatAddon(workspaceId)
      if (!addon) return 0
      if (addon.scheduledSeats === null) return addon.paidSeats
      await this.repo.setAppliedSeats(workspaceId, addon.scheduledSeats)
      return addon.scheduledSeats
    })
  }

  /**
   * The renewal amount input: effective (scheduled ?? paid) seats across ALL
   * the owner's workspaces, priced per the given billing period. READ-ONLY —
   * the cron applies + charges atomically per renewal.
   */
  async computeOwnerSeatCharge(
    userId: string,
    billingPeriod: SeatBillingPeriod,
  ): Promise<OwnerSeatCharge> {
    const workspaces = await this.repo.findOwnedWorkspaces(userId)
    if (workspaces.length === 0) return { totalSeatKopecks: 0, perWorkspace: [] }

    const ids = workspaces.map((w) => w.id)
    const sub = await this.repo.findActiveSubscriptionWithPlan(userId)
    const plan = sub?.plan ?? (await this.repo.findPersonalPlan())
    const pricePerSeat = pickSeatPrice(plan, billingPeriod)

    const [addons, memberCounts, limits] = await Promise.all([
      this.repo.findAddonsByWorkspaceIds(ids),
      this.repo.countMembersByWorkspaceIds(ids),
      this.repo.findLimitsByWorkspaceIds(ids),
    ])
    const addonByWs = new Map(addons.map((a) => [a.workspaceId, a]))

    const perWorkspace = workspaces.map((w) => {
      const addon = addonByWs.get(w.id)
      const effectiveSeats = addon ? (addon.scheduledSeats ?? addon.paidSeats) : 0
      return {
        workspaceId: w.id,
        effectiveSeats,
        seatKopecks: effectiveSeats * pricePerSeat,
        memberCount: memberCounts.get(w.id) ?? 0,
        includedSeats: limits.get(w.id) ?? plan.maxMembersPerWorkspace,
      }
    })
    return {
      totalSeatKopecks: perWorkspace.reduce((sum, row) => sum + row.seatKopecks, 0),
      perWorkspace,
    }
  }

  /**
   * Tier change / subscription expiry: clear addons + schedules for ALL the
   * owner's workspaces. One ADDONS_RESET ledger row + audit per workspace that
   * actually carried state — so the call is idempotent (a second run finds
   * nothing dirty and writes nothing).
   */
  async resetAddonsForOwner(
    userId: string,
    options: { reason: string },
  ): Promise<ResetAddonsResult> {
    return this.uow.transaction(async () => {
      const workspaces = await this.repo.findOwnedWorkspaces(userId)
      if (workspaces.length === 0) return { resetWorkspaceIds: [] }
      const addons = await this.repo.findAddonsByWorkspaceIds(workspaces.map((w) => w.id))
      const dirty = addons.filter((a) => a.paidSeats > 0 || a.scheduledSeats !== null)
      if (dirty.length === 0) return { resetWorkspaceIds: [] }

      for (const addon of dirty) {
        await this.repo.writeSeatEvent({
          workspaceId: addon.workspaceId,
          type: 'ADDONS_RESET',
          seatsDelta: -addon.paidSeats,
          seatsAfter: 0,
          actorId: userId,
          metadata: {
            reason: options.reason,
            previousPaidSeats: addon.paidSeats,
            previousScheduledSeats: addon.scheduledSeats,
          },
        })
        await this.repo.writeAudit({
          workspaceId: addon.workspaceId,
          actorId: userId,
          action: BILLING_AUDIT_ACTIONS.seatsAddonsReset,
          metadata: {
            reason: options.reason,
            previousPaidSeats: addon.paidSeats,
            previousScheduledSeats: addon.scheduledSeats,
          },
        })
      }
      await this.repo.resetAddons(dirty.map((a) => a.workspaceId))
      return { resetWorkspaceIds: dirty.map((a) => a.workspaceId) }
    })
  }

  // ── invoice requests (spec §3) ────────────────────────────────────────────────

  /**
   * Validates the юрлицо fields, persists the request, audits — and returns
   * the operator-mail payload. The ROUTER sends the mail (the domain emits
   * nothing); payment stays offline, the row is the workflow record.
   */
  async createInvoiceRequest(
    input: CreateInvoiceRequestInput,
  ): Promise<CreateInvoiceRequestResult> {
    const inn = input.inn.trim()
    if (!isValidInn(inn)) throw seatsError('INVALID_INN')
    const kpp = input.kpp?.trim() || null
    if (kpp !== null && !isValidKpp(kpp)) throw seatsError('INVALID_KPP')
    if (
      !Number.isInteger(input.periodMonths) ||
      input.periodMonths < INVOICE_MIN_PERIOD_MONTHS ||
      input.periodMonths > INVOICE_MAX_PERIOD_MONTHS
    ) {
      throw seatsError('INVALID_INVOICE_PERIOD')
    }
    if (!Number.isInteger(input.seats) || input.seats < 1) throw seatsError('INVALID_SEAT_COUNT')

    const workspace = await this.repo.findWorkspace(input.workspaceId)
    if (!workspace) throw notFound('Пространство не найдено')
    const memberCount = await this.repo.countMembers(input.workspaceId)
    if (input.seats < memberCount) throw seatsError('INVOICE_SEATS_BELOW_USAGE')

    const ownerEmail = (await this.repo.findUserEmail(input.actorId)) ?? ''
    const comment = input.comment?.trim() || null

    return this.uow.transaction(async () => {
      const row = await this.repo.createInvoiceRequest({
        workspaceId: input.workspaceId,
        userId: input.actorId,
        legalName: input.legalName.trim(),
        inn,
        kpp,
        legalAddress: input.legalAddress.trim(),
        contactEmail: input.contactEmail.trim(),
        periodMonths: input.periodMonths,
        seats: input.seats,
        comment,
      })
      await this.repo.writeAudit({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: BILLING_AUDIT_ACTIONS.invoiceRequested,
        metadata: {
          invoiceRequestId: row.id,
          inn,
          seats: input.seats,
          periodMonths: input.periodMonths,
        },
      })
      return {
        request: toInvoiceRequestDto(row),
        mail: {
          legalName: row.legalName,
          inn: row.inn,
          workspaceName: workspace.name,
          ownerEmail,
          seats: row.seats,
          periodMonths: row.periodMonths,
          ...(comment === null ? {} : { comment }),
        },
      }
    })
  }

  async listInvoiceRequests(workspaceId: string): Promise<InvoiceRequestDto[]> {
    const rows = await this.repo.listInvoiceRequests(workspaceId)
    return rows.map(toInvoiceRequestDto)
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** The operative included-seat count: WorkspaceLimit override, then the owner plan. */
  private async resolveIncludedSeats(workspaceId: string): Promise<number> {
    const limit = await this.repo.findWorkspaceLimit(workspaceId)
    if (limit) return limit.maxMembers
    const workspace = await this.repo.findWorkspace(workspaceId)
    const sub = workspace?.createdById
      ? await this.repo.findActiveSubscriptionWithPlan(workspace.createdById)
      : null
    const plan = sub?.plan ?? (await this.repo.findPersonalPlan())
    return plan.maxMembersPerWorkspace
  }
}
