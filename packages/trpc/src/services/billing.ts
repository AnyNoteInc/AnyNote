import type { PrismaClient } from '@repo/db'
import type { Payment, Refund } from '@repo/yookassa'

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
