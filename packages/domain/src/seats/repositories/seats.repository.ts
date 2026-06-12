import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../billing/index.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { SeatBillingPeriod, SeatLedgerEntry, SeatsAuditEntry } from '../dto/seats.dto.ts'

/** The plan fields the seat math needs (a subset of `Plan`). */
export interface SeatPlanRow {
  maxMembersPerWorkspace: number
  pricePerExtraSeatMonthlyKopecks: number
  pricePerExtraSeatYearlyKopecks: number
}

/** The owner's active-enough subscription with its seat-relevant plan slice. */
export interface OwnerSubscriptionRow {
  id: string
  status: string
  billingPeriod: SeatBillingPeriod
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  plan: SeatPlanRow
}

export interface SeatAddonRow {
  workspaceId: string
  paidSeats: number
  scheduledSeats: number | null
}

export interface InvoiceRequestRow {
  id: string
  workspaceId: string
  userId: string
  legalName: string
  inn: string
  kpp: string | null
  legalAddress: string
  contactEmail: string
  periodMonths: number
  seats: number
  comment: string | null
  status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'
  createdAt: Date
  updatedAt: Date
}

const seatPlanSelect = {
  maxMembersPerWorkspace: true,
  pricePerExtraSeatMonthlyKopecks: true,
  pricePerExtraSeatYearlyKopecks: true,
} as const

export class SeatsRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  // ── audit / ledger writers ────────────────────────────────────────────────────

  /** Runs on `uow.client()` — inside `uow.transaction()` this is the active tx. */
  async writeAudit(entry: SeatsAuditEntry): Promise<void> {
    await this.uow.client().workspaceAuditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        targetUserId: entry.targetUserId ?? null,
        metadata: entry.metadata,
      },
    })
  }

  /** Append-only billable-seat ledger write (spec §7.7). */
  async writeSeatEvent(entry: SeatLedgerEntry): Promise<void> {
    await this.uow.client().seatBillingEvent.create({
      data: {
        workspaceId: entry.workspaceId,
        type: entry.type,
        seatsDelta: entry.seatsDelta,
        seatsAfter: entry.seatsAfter ?? null,
        amountKopecks: entry.amountKopecks ?? null,
        orderId: entry.orderId ?? null,
        actorId: entry.actorId ?? null,
        targetUserId: entry.targetUserId ?? null,
        metadata: entry.metadata,
      },
    })
  }

  // ── owner chain (the billing-repository precedent) ────────────────────────────

  async findWorkspace(workspaceId: string): Promise<{
    id: string
    name: string
    createdById: string | null
  } | null> {
    return this.uow.client().workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, createdById: true },
    })
  }

  /** Latest active-enough subscription (TRIAL/ACTIVE/PAST_DUE) with the seat plan slice. */
  async findActiveSubscriptionWithPlan(userId: string): Promise<OwnerSubscriptionRow | null> {
    return this.uow.client().subscription.findFirst({
      where: { userId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        billingPeriod: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: { select: seatPlanSelect },
      },
    })
  }

  /** The no-subscription fallback plan (`getWorkspaceFeatures` precedent). */
  async findPersonalPlan(): Promise<SeatPlanRow> {
    return this.uow.client().plan.findUniqueOrThrow({
      where: { slug: 'personal' },
      select: seatPlanSelect,
    })
  }

  // ── counting / capacity sources ───────────────────────────────────────────────

  /** Member rows only — guests have no `WorkspaceMember` row by construction (spec §7.1). */
  async countMembers(workspaceId: string): Promise<number> {
    return this.uow.client().workspaceMember.count({ where: { workspaceId } })
  }

  async findWorkspaceLimit(workspaceId: string): Promise<{ maxMembers: number } | null> {
    return this.uow.client().workspaceLimit.findUnique({
      where: { workspaceId },
      select: { maxMembers: true },
    })
  }

  // ── seat addons ───────────────────────────────────────────────────────────────

  async findSeatAddon(workspaceId: string): Promise<SeatAddonRow | null> {
    return this.uow.client().workspaceSeatAddon.findUnique({
      where: { workspaceId },
      select: { workspaceId: true, paidSeats: true, scheduledSeats: true },
    })
  }

  async setScheduledSeats(workspaceId: string, targetSeats: number): Promise<void> {
    await this.uow.client().workspaceSeatAddon.update({
      where: { workspaceId },
      data: { scheduledSeats: targetSeats },
    })
  }

  /** Idempotent — no-op when the row is absent. */
  async clearScheduledSeats(workspaceId: string): Promise<void> {
    await this.uow.client().workspaceSeatAddon.updateMany({
      where: { workspaceId },
      data: { scheduledSeats: null },
    })
  }

  /** The renewal application write: paidSeats = effective, scheduled cleared. */
  async setAppliedSeats(workspaceId: string, paidSeats: number): Promise<void> {
    await this.uow.client().workspaceSeatAddon.update({
      where: { workspaceId },
      data: { paidSeats, scheduledSeats: null },
    })
  }

  // NOTE: owner-wide reads/writes (renewal, addon reset, purchase settlement)
  // live in `../seats.tx.ts` — tx-carve-out functions shared with the trpc
  // payment-success handler and the engines billing cron.

  // ── invoice requests ──────────────────────────────────────────────────────────

  async findUserEmail(userId: string): Promise<string | null> {
    const user = await this.uow.client().user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return user?.email ?? null
  }

  async createInvoiceRequest(data: {
    workspaceId: string
    userId: string
    legalName: string
    inn: string
    kpp: string | null
    legalAddress: string
    contactEmail: string
    periodMonths: number
    seats: number
    comment: string | null
  }): Promise<InvoiceRequestRow> {
    return this.uow.client().invoiceRequest.create({ data })
  }

  async listInvoiceRequests(workspaceId: string): Promise<InvoiceRequestRow[]> {
    // id is uuid(7) (time-ordered) — a stable tiebreak for same-millisecond rows.
    return this.uow.client().invoiceRequest.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  }
}
