import { Injectable, Logger } from '@nestjs/common'
import * as Sentry from '@sentry/nestjs'
import { prisma, type Prisma } from '@repo/db'
import {
  applySeatRenewalTx,
  buildSeatRenewalOrderMetadata,
  computeOwnerSeatChargeTx,
  resetAddonsForOwnerTx,
  syncWorkspaceLimits,
} from '@repo/domain'
import type { Payment } from '@repo/yookassa'

import { YookassaClientFactory } from './yookassa-client.factory.js'

function renewalBatchSize(): number {
  const parsed = Number.parseInt(process.env.BILLING_RENEWAL_BATCH_SIZE ?? '50', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50
}

/**
 * Prisma P2002 (unique-constraint violation), duck-typed: `instanceof
 * Prisma.PrismaClientKnownRequestError` is brittle across the monorepo's
 * client instances, and the `code` field is the documented contract.
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

function addBillingPeriod(start: Date, period: 'MONTHLY' | 'YEARLY'): Date {
  const end = new Date(start)
  if (period === 'YEARLY') {
    end.setFullYear(end.getFullYear() + 1)
    return end
  }

  end.setMonth(end.getMonth() + 1)
  return end
}

@Injectable()
export class SubscriptionRenewalService {
  private readonly logger = new Logger(SubscriptionRenewalService.name)

  constructor(private readonly yookassaFactory: YookassaClientFactory) {}

  async expireCanceled(): Promise<void> {
    const now = new Date()
    const affected = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: { not: null, lte: now },
      },
      select: { id: true, userId: true },
    })
    if (affected.length === 0) return

    await prisma.subscription.updateMany({
      where: { id: { in: affected.map((s) => s.id) } },
      data: { status: 'EXPIRED', expiredAt: now },
    })

    const uniqueUserIds = Array.from(new Set(affected.map((s) => s.userId)))
    for (const userId of uniqueUserIds) {
      await syncWorkspaceLimits(prisma, userId)
      // Addons die with the subscription: ADDONS_RESET ledger + audit per
      // workspace that carried state, no charge (spec §4.2).
      await prisma.$transaction((tx) =>
        resetAddonsForOwnerTx(tx, userId, { reason: 'subscription_expired' }),
      )
    }
  }

  async renewActive(): Promise<void> {
    const dueSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        paymentMethodId: { not: null },
        currentPeriodEnd: { not: null, lte: new Date() },
      },
      take: renewalBatchSize(),
      select: { id: true },
    })

    for (const subscription of dueSubscriptions) {
      try {
        await this.renewOne(subscription.id)
      } catch (err) {
        this.logger.error(`renewOne(${subscription.id}) failed`, err)
        Sentry.captureException(err, {
          tags: { service: 'engines', worker: 'billing-renewal', integration: 'billing' },
          extra: { subscriptionId: subscription.id },
        })
      }
    }
  }

  async renewOne(subscriptionId: string): Promise<void> {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    })

    if (
      subscription.status !== 'ACTIVE' ||
      !subscription.paymentMethodId ||
      !subscription.currentPeriodEnd
    ) {
      // No currentPeriodEnd ⇒ nothing to renew and no deterministic key.
      return
    }

    const tierKopecks =
      subscription.billingPeriod === 'YEARLY'
        ? subscription.plan.priceYearlyKopecks
        : subscription.plan.priceMonthlyKopecks
    // The seat charge is computed BEFORE the order is created so the order
    // amount is authoritative (spec §4.2): effective = scheduled ?? paid seats
    // across all owned workspaces, read-only here. Zero-addon owners get
    // totalSeatKopecks 0 — exactly the old flat tier price (regression pin).
    const seatCharge = await computeOwnerSeatChargeTx(prisma, {
      userId: subscription.userId,
      billingPeriod: subscription.billingPeriod,
      plan: subscription.plan,
    })
    const amountKopecks = tierKopecks + seatCharge.totalSeatKopecks
    // DETERMINISTIC per subscription+period (group review Fix 2): two
    // overlapping cron ticks compute the SAME key, so YooKassa dedupes the
    // charge — and the unique column below stops the second order row.
    // Epoch ms, not toISOString: the column is VarChar(64) and
    // `renew:` + uuid + `:` + ISO would be 67 chars.
    const idempotencyKey = `renew:${subscription.id}:${subscription.currentPeriodEnd.getTime()}`

    let order: { id: string }
    try {
      order = await prisma.order.create({
        data: {
          userId: subscription.userId,
          planId: subscription.planId,
          subscriptionId: subscription.id,
          billingPeriod: subscription.billingPeriod,
          amountKopecks,
          currency: subscription.currency,
          status: 'PENDING',
          isInitial: false,
          savedPaymentMethod: true,
          yookassaIdempotencyKey: idempotencyKey,
          // The charge-time row snapshot: BOTH completion paths (the
          // synchronous flip below and the trpc webhook) apply EXACTLY these
          // rows, so charged == applied even if an addon mutates mid-window.
          metadata: buildSeatRenewalOrderMetadata(seatCharge) as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        // A concurrent tick already created this period's renewal order —
        // it owns the charge; this tick skips (the cheap DB-level guard).
        this.logger.warn(
          `renewOne(${subscriptionId}): renewal order for key ${idempotencyKey} already exists — skipping concurrent tick`,
        )
        return
      }
      throw err
    }

    const amount = (amountKopecks / 100).toFixed(2)
    const periodLabel = subscription.billingPeriod === 'YEARLY' ? 'Год' : 'Месяц'

    let payment: Payment
    try {
      payment = await this.yookassaFactory.get().chargeWithSavedMethod(
        {
          amount: { value: amount, currency: 'RUB' },
          payment_method_id: subscription.paymentMethodId,
          description: `Автопродление ${subscription.plan.name} (${periodLabel})`,
          metadata: { orderId: order.id, subscriptionId: subscription.id },
        },
        idempotencyKey,
      )
    } catch (err) {
      this.logger.error('chargeWithSavedMethod threw', err)
      Sentry.captureException(err, {
        tags: { service: 'engines', worker: 'billing-renewal', integration: 'billing' },
        extra: { subscriptionId: subscription.id, orderId: order.id },
      })
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED' },
        }),
        prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED', expiredAt: new Date() },
        }),
      ])
      return
    }

    if (payment.status === 'succeeded') {
      const now = new Date()
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            yookassaPaymentId: payment.id,
            paidAt: now,
          },
        })
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodStart: now,
            currentPeriodEnd: addBillingPeriod(now, subscription.billingPeriod),
          },
        })
        // Seats apply in the SAME tx as the order flip + period roll, from
        // the SAME rows the charge was computed from (charged == applied):
        // scheduled values become paid, plus snapshot + SEATS_RENEWED ledger +
        // audit per workspace with seat state. Zero-addon owners write nothing.
        await applySeatRenewalTx(tx, {
          orderId: order.id,
          subscriptionId: subscription.id,
          rows: seatCharge.perWorkspace,
        })
      })
      return
    }

    if (payment.status === 'canceled') {
      const now = new Date()
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', yookassaPaymentId: payment.id },
        }),
        prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'EXPIRED', expiredAt: now },
        }),
      ])
      return
    }

    // Payment still pending: the order keeps PENDING (with the seat charge
    // already in its amount) and the WEBHOOK path finishes it — trpc
    // handlePaymentSucceeded flips the order, rolls the period AND applies the
    // seat renewal in its own tx. Applying seats here too would double them;
    // the PENDING→PAID flip is the exactly-once boundary.
    await prisma.order.update({
      where: { id: order.id },
      data: { yookassaPaymentId: payment.id },
    })
  }
}
