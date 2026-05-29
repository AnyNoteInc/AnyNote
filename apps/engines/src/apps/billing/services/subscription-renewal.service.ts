import { Injectable, Logger } from '@nestjs/common'
import { prisma } from '@repo/db'
import { syncWorkspaceLimits } from '@repo/domain'
import type { Payment } from '@repo/yookassa'
import { randomUUID } from 'node:crypto'

import { YookassaClientFactory } from './yookassa-client.factory.js'

function renewalBatchSize(): number {
  const parsed = Number.parseInt(process.env.BILLING_RENEWAL_BATCH_SIZE ?? '50', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50
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
      }
    }
  }

  async renewOne(subscriptionId: string): Promise<void> {
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    })

    if (subscription.status !== 'ACTIVE' || !subscription.paymentMethodId) {
      return
    }

    const amountKopecks =
      subscription.billingPeriod === 'YEARLY'
        ? subscription.plan.priceYearlyKopecks
        : subscription.plan.priceMonthlyKopecks
    const idempotencyKey = randomUUID()

    const order = await prisma.order.create({
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
      },
    })

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
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: {
            status: 'PAID',
            yookassaPaymentId: payment.id,
            paidAt: now,
          },
        }),
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodStart: now,
            currentPeriodEnd: addBillingPeriod(now, subscription.billingPeriod),
          },
        }),
      ])
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

    await prisma.order.update({
      where: { id: order.id },
      data: { yookassaPaymentId: payment.id },
    })
  }
}
