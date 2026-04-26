import { Injectable } from "@nestjs/common"
import { prisma } from "@repo/db"
import { randomUUID } from "node:crypto"

import { YookassaClientFactory } from "./yookassa-client.factory.js"

@Injectable()
export class RefundService {
  constructor(private readonly yookassaFactory: YookassaClientFactory) {}

  async fullRefund(orderId: string): Promise<{ yookassaRefundId: string; subscriptionId: string }> {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    })

    if (order.status !== "PAID" || order.refundedAt) {
      throw new Error(`Order ${orderId} is already refunded or not paid`)
    }

    if (!order.yookassaPaymentId) {
      throw new Error(`Order ${orderId} has no YooKassa payment id`)
    }

    if (!order.subscriptionId) {
      throw new Error(`Order ${orderId} has no subscription`)
    }

    const refund = await this.yookassaFactory.get().createRefund(
      {
        payment_id: order.yookassaPaymentId,
        amount: { value: (order.amountKopecks / 100).toFixed(2), currency: "RUB" },
        description: "Возврат",
      },
      randomUUID(),
    )

    const now = new Date()
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: {
          status: "REFUNDED",
          refundedAt: now,
          yookassaRefundId: refund.id,
        },
      }),
      prisma.subscription.update({
        where: { id: order.subscriptionId },
        data: {
          status: "EXPIRED",
          expiredAt: now,
          currentPeriodEnd: now,
        },
      }),
    ])

    return { yookassaRefundId: refund.id, subscriptionId: order.subscriptionId }
  }
}
