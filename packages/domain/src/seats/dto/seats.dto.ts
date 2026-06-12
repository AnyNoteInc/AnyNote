import type { Prisma } from '@repo/db'

import { DomainError } from '../../shared/errors.ts'

/**
 * Prisma enums as string unions (the people/security-module precedent — the
 * enums aren't re-exported from the `@repo/db` barrel). `SeatBillingPeriod`
 * mirrors `BillingPeriod`; `SeatLedgerEventType` mirrors `SeatBillingEventType`;
 * `InvoiceRequestState` mirrors `InvoiceRequestStatus`.
 */
export type SeatBillingPeriod = 'MONTHLY' | 'YEARLY'

export type SeatLedgerEventType =
  | 'MEMBER_JOINED'
  | 'MEMBER_REMOVED'
  | 'SEATS_PURCHASED'
  | 'SEATS_REDUCTION_SCHEDULED'
  | 'SEATS_RENEWED'
  | 'ADDONS_RESET'

export type InvoiceRequestState = 'NEW' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED'

// ── audit catalog (spec §2) ───────────────────────────────────────────────────

/**
 * `WorkspaceAuditLog.action` catalog for per-seat billing (Phase 8D). Every
 * money/seat-config mutation writes exactly one row per audited event, in the
 * same transaction. `seats.renewal_applied` is declared for the engines
 * renewal caller (Task 4 wiring) — not emitted by this module.
 *
 * MEMBER_JOINED/REMOVED ledger rows intentionally do NOT double into the
 * audit log — the people/identity audits already record joins/removals; the
 * LEDGER is the billing record (spec §2).
 */
export const BILLING_AUDIT_ACTIONS = {
  seatsPurchased: 'seats.purchased',
  seatsReductionScheduled: 'seats.reduction_scheduled',
  seatsRenewalApplied: 'seats.renewal_applied',
  seatsAddonsReset: 'seats.addons_reset',
  invoiceRequested: 'invoice.requested',
} as const

export type BillingAuditAction = (typeof BILLING_AUDIT_ACTIONS)[keyof typeof BILLING_AUDIT_ACTIONS]

// ── error codes (spec §3) ─────────────────────────────────────────────────────

export const SEATS_ERROR_CODES = {
  SEATS_NOT_AVAILABLE: 'SEATS_NOT_AVAILABLE',
  NOT_SUBSCRIPTION_OWNER: 'NOT_SUBSCRIPTION_OWNER',
  INVALID_SEAT_COUNT: 'INVALID_SEAT_COUNT',
  PERIOD_ENDED: 'PERIOD_ENDED',
  REDUCTION_INVALID_TARGET: 'REDUCTION_INVALID_TARGET',
  REDUCTION_BELOW_USAGE: 'REDUCTION_BELOW_USAGE',
  INVALID_INN: 'INVALID_INN',
  INVALID_KPP: 'INVALID_KPP',
  INVALID_INVOICE_PERIOD: 'INVALID_INVOICE_PERIOD',
  INVOICE_SEATS_BELOW_USAGE: 'INVOICE_SEATS_BELOW_USAGE',
} as const

export type SeatsErrorCode = keyof typeof SEATS_ERROR_CODES

// Honest messages that NAME the refusal reason (the security-module precedent).
const SEATS_ERROR_DEFS: Record<SeatsErrorCode, { httpStatus: number; message: string }> = {
  SEATS_NOT_AVAILABLE: {
    httpStatus: 403,
    message: 'На текущем тарифе докупка мест недоступна — обновите тариф',
  },
  NOT_SUBSCRIPTION_OWNER: {
    httpStatus: 403,
    message: 'Управлять платными местами может только владелец подписки пространства',
  },
  INVALID_SEAT_COUNT: {
    httpStatus: 400,
    message: 'Количество мест — целое число от 1 до 50',
  },
  PERIOD_ENDED: {
    httpStatus: 409,
    message: 'Оплаченный период завершён — сначала продлите подписку',
  },
  REDUCTION_INVALID_TARGET: {
    httpStatus: 400,
    message: 'Новое количество мест должно быть неотрицательным и меньше текущего',
  },
  REDUCTION_BELOW_USAGE: {
    httpStatus: 409,
    message: 'Нельзя сократить места ниже текущего числа участников — сначала удалите участников',
  },
  INVALID_INN: { httpStatus: 400, message: 'ИНН должен содержать ровно 10 или 12 цифр' },
  INVALID_KPP: { httpStatus: 400, message: 'КПП должен содержать ровно 9 цифр' },
  INVALID_INVOICE_PERIOD: { httpStatus: 400, message: 'Период счёта — от 1 до 12 месяцев' },
  INVOICE_SEATS_BELOW_USAGE: {
    httpStatus: 400,
    message: 'Количество мест в счёте не может быть меньше текущего числа участников',
  },
}

/** A `DomainError` whose `code` is the seats-error code itself (people/security pattern). */
export function seatsError(code: SeatsErrorCode): DomainError {
  const def = SEATS_ERROR_DEFS[code]
  return new DomainError(code, def.message, def.httpStatus)
}

// ── purchase limits (spec §3) ─────────────────────────────────────────────────

export const MIN_SEAT_PURCHASE = 1
export const MAX_SEAT_PURCHASE = 50
export const INVOICE_MIN_PERIOD_MONTHS = 1
export const INVOICE_MAX_PERIOD_MONTHS = 12

// ── proration (spec §3, pure) ─────────────────────────────────────────────────

export interface ProrateSeatPurchaseInput {
  seats: number
  periodStart: Date
  periodEnd: Date
  /** Injected by the caller — no `Date.now()` inside (deterministic, table-tested). */
  now: Date
  /** The FULL-period price per extra seat, per the owner's billing period. */
  seatPriceKopecks: number
}

/**
 * `max(1, ceil(seats × seatPriceKopecks × remainingMs / periodMs))`.
 *
 * - `remainingMs ≤ 0` (period over, or a degenerate period) ⇒ `PERIOD_ENDED` —
 *   the purchase is refused, never billed at zero (spec §3: renew first).
 * - `now` before `periodStart` clamps `remainingMs` to the full period — a
 *   purchase never costs MORE than the full per-period price.
 */
export function prorateSeatPurchase(input: ProrateSeatPurchaseInput): number {
  const periodMs = input.periodEnd.getTime() - input.periodStart.getTime()
  const remainingMs = input.periodEnd.getTime() - input.now.getTime()
  if (periodMs <= 0 || remainingMs <= 0) throw seatsError('PERIOD_ENDED')
  const clampedMs = Math.min(remainingMs, periodMs)
  return Math.max(1, Math.ceil((input.seats * input.seatPriceKopecks * clampedMs) / periodMs))
}

// ── invoice field validation (spec §3, pure) ──────────────────────────────────

/** ИНН: exactly 10 (юрлицо) or 12 (ИП) digits. Format-only — no checksum (spec §2). */
export function isValidInn(inn: string): boolean {
  return /^(\d{10}|\d{12})$/.test(inn)
}

/** КПП: exactly 9 digits. */
export function isValidKpp(kpp: string): boolean {
  return /^\d{9}$/.test(kpp)
}

// ── seat usage (spec §3) ──────────────────────────────────────────────────────

export interface SeatPriceInfo {
  monthlyKopecks: number
  yearlyKopecks: number
  /** The price actually charged per extra seat — chosen by the OWNER's current billingPeriod. */
  currentKopecks: number
  billingPeriod: SeatBillingPeriod
}

export interface SeatUsage {
  memberCount: number
  /**
   * The OPERATIVE included-seat count: `WorkspaceLimit.maxMembers` when a limit
   * row exists (the people module's enforcement source), falling back to the
   * owner plan's `maxMembersPerWorkspace`. Usage must agree with enforcement.
   */
  includedSeats: number
  paidSeats: number
  /** Effective from the next renewal; null = no reduction pending. */
  scheduledSeats: number | null
  /** includedSeats + paidSeats — scheduled reductions don't shrink this until applied (spec §7.5). */
  capacity: number
  /** Null = the plan sells no extra seats (price 0 — e.g. personal). */
  seatPrice: SeatPriceInfo | null
  periodEnd: Date | null
  /** Seat price > 0 AND the owner's subscription status is ACTIVE (spec §3). */
  canPurchase: boolean
}

// ── purchase flow (spec §3) ───────────────────────────────────────────────────

export interface BeginSeatPurchaseInput {
  workspaceId: string
  actorId: string
  seats: number
  /** Injectable clock for deterministic proration; defaults to `new Date()`. */
  now?: Date
}

export interface BeginSeatPurchaseResult {
  seats: number
  amountKopecks: number
  periodStart: Date
  periodEnd: Date
}

export interface ApplySeatPurchaseInput {
  workspaceId: string
  seats: number
  /** The PAID YooKassa order this purchase settles. */
  orderId: string
  amountKopecks: number
  actorId: string
}

export interface ApplySeatPurchaseResult {
  /** paidSeats after the increment. */
  paidSeats: number
}

// ── reduction (spec §3) ───────────────────────────────────────────────────────

export interface ScheduleSeatReductionInput {
  workspaceId: string
  actorId: string
  /** Must be ≥ 0 and strictly below the current paidSeats. */
  targetSeats: number
}

export interface SeatReductionState {
  paidSeats: number
  scheduledSeats: number | null
}

export interface CancelScheduledReductionInput {
  workspaceId: string
  actorId: string
}

// ── renewal hooks (spec §3, consumed by the engines cron in Task 4) ──────────

export interface OwnerSeatChargeRow {
  workspaceId: string
  /** scheduled ?? paid — the value the renewal will apply (read-only here). */
  effectiveSeats: number
  seatKopecks: number
  memberCount: number
  includedSeats: number
}

export interface OwnerSeatCharge {
  totalSeatKopecks: number
  perWorkspace: OwnerSeatChargeRow[]
}

export interface ResetAddonsResult {
  /** Workspaces whose addon actually carried state — one ledger + audit row each. */
  resetWorkspaceIds: string[]
}

// ── invoice requests (spec §3) ────────────────────────────────────────────────

export interface CreateInvoiceRequestInput {
  workspaceId: string
  actorId: string
  legalName: string
  inn: string
  kpp?: string | null
  legalAddress: string
  contactEmail: string
  /** 1..12. */
  periodMonths: number
  /** Requested TOTAL seats — must cover the current member count. */
  seats: number
  comment?: string | null
}

export interface InvoiceRequestDto {
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
  status: InvoiceRequestState
  createdAt: Date
  updatedAt: Date
}

/** Mirrors `@repo/mail`'s `invoice-request` payload — the ROUTER sends; the domain emits nothing. */
export interface InvoiceRequestMailData {
  legalName: string
  inn: string
  workspaceName: string
  ownerEmail: string
  seats: number
  periodMonths: number
  comment?: string
}

export interface CreateInvoiceRequestResult {
  request: InvoiceRequestDto
  mail: InvoiceRequestMailData
}

// ── writers (repository inputs) ───────────────────────────────────────────────

export interface SeatsAuditEntry {
  workspaceId: string
  /** Null = system/cron action. */
  actorId: string | null
  action: BillingAuditAction
  targetUserId?: string
  metadata?: Prisma.InputJsonValue
}

export interface SeatLedgerEntry {
  workspaceId: string
  type: SeatLedgerEventType
  /** Signed where meaningful. */
  seatsDelta: number
  /** paidSeats after the event. */
  seatsAfter?: number
  /** Money events only. */
  amountKopecks?: number
  orderId?: string
  /** Null/absent = system/cron. */
  actorId?: string | null
  targetUserId?: string
  metadata?: Prisma.InputJsonValue
}
