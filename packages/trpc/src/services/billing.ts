import type { PrismaClient } from '@repo/db'
import {
  applySeatPurchaseTx,
  applySeatRenewalTx,
  parseSeatPurchaseOrderMetadata,
  resetAddonsForOwnerTx,
} from '@repo/domain'
import type { Payment, Refund } from '@repo/yookassa'

import { syncWorkspaceLimits } from '../helpers/plan'

type BillingYookassa = {
  getPayment(paymentId: string): Promise<Payment>
}

type Ctx = { yookassa: BillingYookassa; prisma: PrismaClient }

function addPeriod(start: Date, period: 'MONTHLY' | 'YEARLY'): Date {
  const end = new Date(start)
  if (period === 'MONTHLY') end.setMonth(end.getMonth() + 1)
  else end.setFullYear(end.getFullYear() + 1)
  return end
}

export async function handlePaymentSucceeded(ctx: Ctx, eventPayment: Payment): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: eventPayment.id },
    include: { plan: true },
  })
  if (order?.status !== 'PENDING') return

  const verified = await ctx.yookassa.getPayment(eventPayment.id)
  if (verified.status !== 'succeeded') return

  const now = new Date()

  const seatMeta = parseSeatPurchaseOrderMetadata(order.metadata)
  if (seatMeta) {
    // Seat-purchase orders NEVER touch subscription rows or workspace limits
    // (spec §7.8): flip the order PAID and apply the seats, one tx. The
    // status-guarded flip is the idempotency boundary — a concurrent second
    // callback (double webhook / poll race) flips zero rows and applies nothing.
    await ctx.prisma.$transaction(async (tx) => {
      const flipped = await tx.order.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: {
          status: 'PAID',
          paidAt: now,
          savedPaymentMethod: verified.payment_method?.saved ?? false,
        },
      })
      if (flipped.count === 0) return
      await applySeatPurchaseTx(tx, {
        workspaceId: seatMeta.workspaceId,
        seats: seatMeta.seats,
        orderId: order.id,
        amountKopecks: order.amountKopecks,
        actorId: order.userId,
      })
    })
    return
  }

  const periodEnd = addPeriod(now, order.billingPeriod)

  await ctx.prisma.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { userId: order.userId, status: 'ACTIVE', planId: { not: order.planId } },
      data: { status: 'EXPIRED', expiredAt: now },
    })

    const existing = await tx.subscription.findFirst({
      where: { userId: order.userId, planId: order.planId },
    })

    const subData = {
      status: 'ACTIVE' as const,
      billingPeriod: order.billingPeriod,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      paymentMethodId: verified.payment_method?.id ?? null,
      paymentMethodLast4: verified.payment_method?.card?.last4 ?? null,
      paymentMethodBrand: verified.payment_method?.type ?? null,
    }

    const subscription = existing
      ? await tx.subscription.update({ where: { id: existing.id }, data: subData })
      : await tx.subscription.create({
          data: { userId: order.userId, planId: order.planId, ...subData },
        })

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: now,
        subscriptionId: subscription.id,
        savedPaymentMethod: verified.payment_method?.saved ?? false,
      },
    })
    await syncWorkspaceLimits(tx, order.userId)

    if (order.isInitial) {
      // Tier change: purchased seats die with the old tier (spec §3). Only
      // INITIAL checkouts reset — renewals must keep the addons (pinned).
      await resetAddonsForOwnerTx(tx, order.userId, { reason: 'plan_change' })
    } else if (order.subscriptionId) {
      // A pending RENEWAL completing via webhook/poll: the upsert above just
      // rolled the period, so the seat renewal applies HERE — exactly once,
      // because the PENDING guard lets a single callback through (the
      // synchronous renewOne path flips the order in ITS tx and applies seats
      // there; whichever flip wins, the other side sees a non-PENDING order).
      await applySeatRenewalTx(tx, {
        userId: order.userId,
        billingPeriod: order.billingPeriod,
        plan: order.plan,
        orderId: order.id,
        subscriptionId: order.subscriptionId,
      })
    }
  })
}

export async function handlePaymentCanceled(ctx: Ctx, eventPayment: Payment): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: eventPayment.id },
  })
  if (order?.status !== 'PENDING') return
  await ctx.prisma.order.update({
    where: { id: order.id },
    data: { status: 'FAILED' },
  })
}

export async function handleRefundSucceeded(ctx: Ctx, refund: Refund): Promise<void> {
  const order = await ctx.prisma.order.findUnique({
    where: { yookassaPaymentId: refund.payment_id },
  })
  if (!order || order.status === 'REFUNDED') return
  await ctx.prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED', refundedAt: new Date(), yookassaRefundId: refund.id },
    })
    if (order.subscriptionId) {
      await tx.subscription.update({
        where: { id: order.subscriptionId },
        data: { status: 'EXPIRED', expiredAt: new Date(), currentPeriodEnd: new Date() },
      })
      await syncWorkspaceLimits(tx, order.userId)
    }
  })
}

export async function syncOrderFromProvider(
  ctx: Ctx,
  yookassaPaymentId: string,
): Promise<'succeeded' | 'canceled' | 'pending'> {
  const payment = await ctx.yookassa.getPayment(yookassaPaymentId)
  if (payment.status === 'succeeded') {
    await handlePaymentSucceeded(ctx, payment)
    return 'succeeded'
  }
  if (payment.status === 'canceled') {
    await handlePaymentCanceled(ctx, payment)
    return 'canceled'
  }
  return 'pending'
}
