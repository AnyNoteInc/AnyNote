import { randomUUID } from 'node:crypto'

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import type { PrismaClient } from '@repo/db'
import {
  INVOICE_MAX_PERIOD_MONTHS,
  INVOICE_MIN_PERIOD_MONTHS,
  MAX_SEAT_PURCHASE,
  MIN_SEAT_PURCHASE,
  SEAT_PURCHASE_ORDER_KIND,
  seatsError,
} from '@repo/domain'
import { sendMailNow } from '@repo/mail'
import { YookassaApiError } from '@repo/yookassa'

import { domain as domainSvc } from '../domain'
import { mapDomain } from '../helpers/map-domain'
import { assertRole } from '../helpers/membership'
import { router, protectedProcedure } from '../trpc'

// Per-seat billing (Phase 8D, spec §5). The gate matrix: any OWNER/ADMIN may
// VIEW seatUsage; everything else is OWNER-only; the MONEY procs (purchase,
// reduction) additionally require the actor to BE the workspace's
// `createdById` subscription holder — only the paying owner moves money
// (NOT_SUBSCRIPTION_OWNER otherwise, pinned by tests).

type Ctx = { prisma: PrismaClient; user: { id: string } }

const SEAT_EVENTS_PAGE_SIZE = 30

// The browser tRPC client has no transformer — a cursor Date arrives as an
// ISO string over HTTP (the notification.list precedent).
const cursorSchema = z
  .object({
    createdAt: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
    id: z.string().uuid(),
  })
  .optional()

/**
 * The reduction procs' holder gate. `purchaseSeats` doesn't need it — the
 * domain's `beginSeatPurchase` performs the same `createdById` check and the
 * error maps through `mapDomain`; this mirror exists for the procs whose
 * domain methods are gate-free (schedule/cancel reduction).
 */
async function assertSubscriptionHolder(ctx: Ctx, workspaceId: string): Promise<void> {
  const workspace = await ctx.prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true },
  })
  if (workspace?.createdById !== ctx.user.id) {
    // The domain's error is the single source of the message.
    const err = seatsError('NOT_SUBSCRIPTION_OWNER')
    throw new TRPCError({ code: 'FORBIDDEN', message: err.message })
  }
}

type NamedUser = { email: string; firstName?: string | null; lastName?: string | null }

/** The ledger display name — `firstName lastName` or the email (the security-router mirror). */
function displayName(user: NamedUser): string {
  const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
  return full || user.email
}

export const billingRouter = router({
  // ── usage (OWNER/ADMIN view) ────────────────────────────────────────────────

  seatUsage: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER', 'ADMIN'])
      return mapDomain(() => domainSvc.seats.getSeatUsage(input.workspaceId))
    }),

  // ── purchase (spec §4.1 — the startCheckout pattern) ────────────────────────

  purchaseSeats: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        seats: z.number().int().min(MIN_SEAT_PURCHASE).max(MAX_SEAT_PURCHASE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      // The domain gates the rest: actor must BE the createdById subscription
      // holder (NOT_SUBSCRIPTION_OWNER), the plan must sell seats, the paid
      // period must still be running — and prices the prorated remainder.
      const begin = await mapDomain(() =>
        domainSvc.seats.beginSeatPurchase({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          seats: input.seats,
        }),
      )

      // The Order row requires the tier context (planId/billingPeriod) — the
      // same ACTIVE subscription beginSeatPurchase just priced against.
      const sub = await ctx.prisma.subscription.findFirst({
        where: { userId: ctx.user.id, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: { planId: true, billingPeriod: true },
      })
      if (!sub) throw new TRPCError({ code: 'CONFLICT', message: 'NO_ACTIVE_SUBSCRIPTION' })

      const idempotencyKey = randomUUID()
      const order = await ctx.prisma.order.create({
        data: {
          userId: ctx.user.id,
          planId: sub.planId,
          billingPeriod: sub.billingPeriod,
          amountKopecks: begin.amountKopecks,
          currency: 'RUB',
          status: 'PENDING',
          // NEVER initial: an isInitial success would reset the very addons
          // this order purchases (the tier-change reset, spec §3).
          isInitial: false,
          yookassaIdempotencyKey: idempotencyKey,
          metadata: {
            kind: SEAT_PURCHASE_ORDER_KIND,
            workspaceId: input.workspaceId,
            seats: begin.seats,
            periodEnd: begin.periodEnd.toISOString(),
          },
        },
      })

      const rub = (begin.amountKopecks / 100).toFixed(2)
      let payment
      try {
        payment = await ctx.yookassa.createPayment(
          {
            amount: { value: rub, currency: 'RUB' },
            capture: true,
            confirmation: {
              type: 'redirect',
              return_url: `${ctx.returnUrlBase}/billing/return?orderId=${order.id}`,
            },
            description: 'Доплата за места',
            // YooKassa metadata values are strings; the typed seat payload
            // lives on the ORDER row (the payment-success consumer reads it).
            metadata: {
              orderId: order.id,
              userId: ctx.user.id,
              kind: SEAT_PURCHASE_ORDER_KIND,
              workspaceId: input.workspaceId,
              seats: String(begin.seats),
            },
          },
          idempotencyKey,
        )
      } catch (err) {
        await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } })
        if (err instanceof YookassaApiError) {
          console.error('[billing.purchaseSeats] YooKassa rejected payment', {
            orderId: order.id,
            status: err.status,
            body: err.body,
          })
          const code = err.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST'
          throw new TRPCError({ code, message: err.message, cause: err })
        }
        throw err
      }

      await ctx.prisma.order.update({
        where: { id: order.id },
        data: { yookassaPaymentId: payment.id },
      })

      if (!payment.confirmation?.confirmation_url) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'NO_CONFIRMATION_URL' })
      }
      return { orderId: order.id, confirmationUrl: payment.confirmation.confirmation_url }
    }),

  // ── reductions (spec §3 — next-renewal, never mid-cycle credits) ────────────

  scheduleReduction: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), targetSeats: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      await assertSubscriptionHolder(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.seats.scheduleSeatReduction({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          targetSeats: input.targetSeats,
        }),
      )
    }),

  cancelReduction: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      await assertSubscriptionHolder(ctx, input.workspaceId)
      return mapDomain(() =>
        domainSvc.seats.cancelScheduledReduction({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
        }),
      )
    }),

  // ── the ledger (OWNER, keyset 30) ───────────────────────────────────────────

  seatEvents: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), cursor: cursorSchema }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      const rows = await ctx.prisma.seatBillingEvent.findMany({
        where: {
          workspaceId: input.workspaceId,
          ...(input.cursor
            ? {
                OR: [
                  { createdAt: { lt: input.cursor.createdAt } },
                  { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SEAT_EVENTS_PAGE_SIZE,
      })

      // SeatBillingEvent carries scalar user ids only — resolve the display
      // names in one read.
      const userIds = [
        ...new Set(
          rows.flatMap((r) => [r.actorId, r.targetUserId]).filter((v): v is string => v !== null),
        ),
      ]
      const users = userIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, firstName: true, lastName: true },
          })
        : []
      const nameById = new Map(users.map((u) => [u.id, displayName(u)]))

      const items = rows.map((r) => ({
        id: r.id,
        type: r.type,
        seatsDelta: r.seatsDelta,
        seatsAfter: r.seatsAfter,
        amountKopecks: r.amountKopecks,
        orderId: r.orderId,
        createdAt: r.createdAt,
        actorName: r.actorId ? (nameById.get(r.actorId) ?? null) : null,
        targetName: r.targetUserId ? (nameById.get(r.targetUserId) ?? null) : null,
      }))
      const last = rows[rows.length - 1]
      const nextCursor =
        rows.length === SEAT_EVENTS_PAGE_SIZE && last
          ? { createdAt: last.createdAt, id: last.id }
          : null
      return { items, nextCursor }
    }),

  // ── invoice requests (spec §3 — the offline-payment workflow) ───────────────

  createInvoiceRequest: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        legalName: z.string().min(1).max(255),
        inn: z.string().min(1).max(12),
        kpp: z.string().max(9).optional(),
        legalAddress: z.string().min(1).max(500),
        contactEmail: z.string().email().max(255),
        periodMonths: z
          .number()
          .int()
          .min(INVOICE_MIN_PERIOD_MONTHS)
          .max(INVOICE_MAX_PERIOD_MONTHS),
        seats: z.number().int().min(1),
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      const { request, mail } = await mapDomain(() =>
        domainSvc.seats.createInvoiceRequest({ ...input, actorId: ctx.user.id }),
      )
      // Operator mail, not user mail. Absent env ⇒ no send — the persisted
      // row is still the workflow record, and the skip is logged (spec §2)
      // so a missing-config deploy is visible in the request logs.
      const operatorEmail = process.env.BILLING_INVOICE_EMAIL
      if (operatorEmail) {
        await sendMailNow({ kind: 'invoice-request', to: operatorEmail, data: mail })
      } else {
        console.info('[mail] invoice-request skipped: BILLING_INVOICE_EMAIL is not set')
      }
      // The response never carries the operator payload/address — just the row.
      return request
    }),

  listInvoiceRequests: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, ['OWNER'])
      return mapDomain(() => domainSvc.seats.listInvoiceRequests(input.workspaceId))
    }),
})
