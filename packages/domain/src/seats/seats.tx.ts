import type { Db } from '../shared/unit-of-work.ts'
import {
  BILLING_AUDIT_ACTIONS,
  type ApplySeatPurchaseInput,
  type ApplySeatPurchaseResult,
  type OwnerSeatCharge,
  type ResetAddonsResult,
  type SeatBillingPeriod,
} from './dto/seats.dto.ts'
import type { SeatAddonRow, SeatPlanRow } from './repositories/seats.repository.ts'

/**
 * Standalone tx-carve-out functions (the `billing.tx.ts` precedent). They
 * operate on a raw Prisma client / tx handle passed by the caller, because the
 * money producers compose them into their OWN transactions:
 *
 * - trpc `handlePaymentSucceeded` — the order PENDING→PAID flip and the seat
 *   application must be one atomic write (seat purchases, initial-order addon
 *   resets, webhook-completed renewals);
 * - the engines renewal cron — the period roll and the seat renewal must be
 *   one atomic write (synchronous saved-method charges), and `expireCanceled`
 *   resets addons of expired owners.
 *
 * NOT registered in the DI container; `SeatsService` delegates to these so the
 * money-write logic lives in exactly one place.
 */

/** The FULL-period price per extra seat, per the owner's billing period. */
export function seatPriceForPeriod(plan: SeatPlanRow, billingPeriod: SeatBillingPeriod): number {
  return billingPeriod === 'YEARLY'
    ? plan.pricePerExtraSeatYearlyKopecks
    : plan.pricePerExtraSeatMonthlyKopecks
}

const ADDON_SELECT = { workspaceId: true, paidSeats: true, scheduledSeats: true } as const

async function findOwnedWorkspaceIds(tx: Db, userId: string): Promise<string[]> {
  // Deterministic order — renewals iterate and snapshot in creation order.
  const workspaces = await tx.workspace.findMany({
    where: { createdById: userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return workspaces.map((w) => w.id)
}

async function findAddonsByWorkspaceIds(tx: Db, workspaceIds: string[]): Promise<SeatAddonRow[]> {
  return tx.workspaceSeatAddon.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: ADDON_SELECT,
  })
}

async function countMembersByWorkspaceIds(
  tx: Db,
  workspaceIds: string[],
): Promise<Map<string, number>> {
  const groups = await tx.workspaceMember.groupBy({
    by: ['workspaceId'],
    where: { workspaceId: { in: workspaceIds } },
    _count: { _all: true },
  })
  return new Map(groups.map((g) => [g.workspaceId, g._count._all]))
}

async function findLimitsByWorkspaceIds(
  tx: Db,
  workspaceIds: string[],
): Promise<Map<string, number>> {
  const rows = await tx.workspaceLimit.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { workspaceId: true, maxMembers: true },
  })
  return new Map(rows.map((r) => [r.workspaceId, r.maxMembers]))
}

// ── seat purchase settlement (spec §4.1) ──────────────────────────────────────

/**
 * Settle a PAID seat-purchase order: addon += seats, SEATS_PURCHASED ledger
 * row, audit. DELIBERATELY NOT idempotent at this layer — the CALLER's
 * status-guarded order flip is the idempotency boundary; calling it twice for
 * one order would double the seats AND the ledger.
 */
export async function applySeatPurchaseTx(
  tx: Db,
  input: ApplySeatPurchaseInput,
): Promise<ApplySeatPurchaseResult> {
  const row = await tx.workspaceSeatAddon.upsert({
    where: { workspaceId: input.workspaceId },
    create: { workspaceId: input.workspaceId, paidSeats: input.seats },
    update: { paidSeats: { increment: input.seats } },
    select: { paidSeats: true },
  })
  await tx.seatBillingEvent.create({
    data: {
      workspaceId: input.workspaceId,
      type: 'SEATS_PURCHASED',
      seatsDelta: input.seats,
      seatsAfter: row.paidSeats,
      amountKopecks: input.amountKopecks,
      orderId: input.orderId,
      actorId: input.actorId,
    },
  })
  await tx.workspaceAuditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: BILLING_AUDIT_ACTIONS.seatsPurchased,
      metadata: {
        seats: input.seats,
        seatsAfter: row.paidSeats,
        amountKopecks: input.amountKopecks,
        orderId: input.orderId,
      },
    },
  })
  return { paidSeats: row.paidSeats }
}

// ── renewal charge input (spec §4.2, read-only) ───────────────────────────────

export interface OwnerSeatChargeTxInput {
  userId: string
  billingPeriod: SeatBillingPeriod
  /** The owner's plan slice — both money producers already hold the full Plan row. */
  plan: SeatPlanRow
}

/**
 * The renewal amount input: effective (scheduled ?? paid) seats across ALL the
 * owner's workspaces, priced per the given billing period. READ-ONLY — compute
 * it BEFORE creating the renewal order so the order amount is authoritative.
 */
export async function computeOwnerSeatChargeTx(
  tx: Db,
  input: OwnerSeatChargeTxInput,
): Promise<OwnerSeatCharge> {
  const ids = await findOwnedWorkspaceIds(tx, input.userId)
  if (ids.length === 0) return { totalSeatKopecks: 0, perWorkspace: [] }

  const pricePerSeat = seatPriceForPeriod(input.plan, input.billingPeriod)
  const addons = await findAddonsByWorkspaceIds(tx, ids)
  const memberCounts = await countMembersByWorkspaceIds(tx, ids)
  const limits = await findLimitsByWorkspaceIds(tx, ids)
  const addonByWs = new Map(addons.map((a) => [a.workspaceId, a]))

  const perWorkspace = ids.map((workspaceId) => {
    const addon = addonByWs.get(workspaceId)
    const effectiveSeats = addon ? (addon.scheduledSeats ?? addon.paidSeats) : 0
    return {
      workspaceId,
      effectiveSeats,
      seatKopecks: effectiveSeats * pricePerSeat,
      memberCount: memberCounts.get(workspaceId) ?? 0,
      includedSeats: limits.get(workspaceId) ?? input.plan.maxMembersPerWorkspace,
    }
  })
  return {
    totalSeatKopecks: perWorkspace.reduce((sum, row) => sum + row.seatKopecks, 0),
    perWorkspace,
  }
}

// ── renewal application (spec §4.2 — the SEATS_RENEWED record, one place) ─────

export interface ApplySeatRenewalInput extends OwnerSeatChargeTxInput {
  /** The renewal Order this application settles. */
  orderId: string
  subscriptionId?: string | null
}

export interface SeatRenewalApplication {
  totalSeatKopecks: number
  renewedWorkspaceIds: string[]
}

/**
 * Apply the seat renewal for every owned workspace that carries seat state:
 * scheduled values become paid, plus the renewal record — WorkspaceSeatSnapshot
 * (memberCount at capture, includedSeats, effective extraSeats,
 * seatAmountKopecks), the SEATS_RENEWED ledger row (orderId, actor = system),
 * and the `seats.renewal_applied` audit — all in the caller's tx.
 *
 * EXACTLY-ONCE contract: call this in the SAME tx that flips the renewal order
 * PENDING→PAID. The synchronous renewOne path flips the order itself; a
 * pending renewal completing via webhook flips it in `handlePaymentSucceeded` —
 * whichever flip wins, the other caller sees a non-PENDING order and skips.
 *
 * Zero-addon owners write NOTHING (the flat-price regression pin).
 */
export async function applySeatRenewalTx(
  tx: Db,
  input: ApplySeatRenewalInput,
): Promise<SeatRenewalApplication> {
  const ids = await findOwnedWorkspaceIds(tx, input.userId)
  if (ids.length === 0) return { totalSeatKopecks: 0, renewedWorkspaceIds: [] }

  const addons = await findAddonsByWorkspaceIds(tx, ids)
  const dirty = addons.filter((a) => a.paidSeats > 0 || a.scheduledSeats !== null)
  if (dirty.length === 0) return { totalSeatKopecks: 0, renewedWorkspaceIds: [] }

  const pricePerSeat = seatPriceForPeriod(input.plan, input.billingPeriod)
  const dirtyIds = dirty.map((a) => a.workspaceId)
  const memberCounts = await countMembersByWorkspaceIds(tx, dirtyIds)
  const limits = await findLimitsByWorkspaceIds(tx, dirtyIds)

  let totalSeatKopecks = 0
  for (const addon of dirty) {
    const effectiveSeats = addon.scheduledSeats ?? addon.paidSeats
    if (addon.scheduledSeats !== null) {
      await tx.workspaceSeatAddon.update({
        where: { workspaceId: addon.workspaceId },
        data: { paidSeats: effectiveSeats, scheduledSeats: null },
      })
    }
    const seatKopecks = effectiveSeats * pricePerSeat
    totalSeatKopecks += seatKopecks
    await tx.workspaceSeatSnapshot.create({
      data: {
        workspaceId: addon.workspaceId,
        subscriptionId: input.subscriptionId ?? null,
        orderId: input.orderId,
        memberCount: memberCounts.get(addon.workspaceId) ?? 0,
        includedSeats: limits.get(addon.workspaceId) ?? input.plan.maxMembersPerWorkspace,
        extraSeats: effectiveSeats,
        seatAmountKopecks: seatKopecks,
      },
    })
    await tx.seatBillingEvent.create({
      data: {
        workspaceId: addon.workspaceId,
        type: 'SEATS_RENEWED',
        seatsDelta: effectiveSeats - addon.paidSeats,
        seatsAfter: effectiveSeats,
        amountKopecks: seatKopecks,
        orderId: input.orderId,
        actorId: null, // system/cron — no human actor behind a renewal
      },
    })
    await tx.workspaceAuditLog.create({
      data: {
        workspaceId: addon.workspaceId,
        actorId: null,
        action: BILLING_AUDIT_ACTIONS.seatsRenewalApplied,
        metadata: {
          orderId: input.orderId,
          extraSeats: effectiveSeats,
          seatAmountKopecks: seatKopecks,
          previousPaidSeats: addon.paidSeats,
        },
      },
    })
  }
  return { totalSeatKopecks, renewedWorkspaceIds: dirtyIds }
}

// ── addon reset (spec §3 — tier change / subscription expiry) ─────────────────

/**
 * Clear addons + schedules for ALL the owner's workspaces. One ADDONS_RESET
 * ledger row + audit per workspace that actually carried state — idempotent
 * (a second run finds nothing dirty and writes nothing). No charge, ever.
 */
export async function resetAddonsForOwnerTx(
  tx: Db,
  userId: string,
  options: { reason: string },
): Promise<ResetAddonsResult> {
  const ids = await findOwnedWorkspaceIds(tx, userId)
  if (ids.length === 0) return { resetWorkspaceIds: [] }
  const addons = await findAddonsByWorkspaceIds(tx, ids)
  const dirty = addons.filter((a) => a.paidSeats > 0 || a.scheduledSeats !== null)
  if (dirty.length === 0) return { resetWorkspaceIds: [] }

  for (const addon of dirty) {
    await tx.seatBillingEvent.create({
      data: {
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
      },
    })
    await tx.workspaceAuditLog.create({
      data: {
        workspaceId: addon.workspaceId,
        actorId: userId,
        action: BILLING_AUDIT_ACTIONS.seatsAddonsReset,
        metadata: {
          reason: options.reason,
          previousPaidSeats: addon.paidSeats,
          previousScheduledSeats: addon.scheduledSeats,
        },
      },
    })
  }
  const dirtyIds = dirty.map((a) => a.workspaceId)
  await tx.workspaceSeatAddon.updateMany({
    where: { workspaceId: { in: dirtyIds } },
    data: { paidSeats: 0, scheduledSeats: null },
  })
  return { resetWorkspaceIds: dirtyIds }
}
