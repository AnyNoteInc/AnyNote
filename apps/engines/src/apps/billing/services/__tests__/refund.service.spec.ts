import { jest } from "@jest/globals"
import { Test } from "@nestjs/testing"
import { prisma } from "@repo/db"

import { RefundService } from "../refund.service.js"
import { YookassaClientFactory } from "../yookassa-client.factory.js"

const orderId = "22222222-2222-4222-8222-222222222222"
const subscriptionId = "11111111-1111-4111-8111-111111111111"

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    subscriptionId,
    status: "PAID",
    amountKopecks: 15_000,
    currency: "RUB",
    yookassaPaymentId: "pmt_1",
    refundedAt: null,
    ...overrides,
  }
}

describe("RefundService.fullRefund", () => {
  let svc: RefundService
  let createRefund: jest.Mock

  beforeEach(async () => {
    jest.restoreAllMocks()
    createRefund = jest.fn()

    jest.spyOn(prisma.order, "findUniqueOrThrow").mockResolvedValue(makeOrder() as never)
    jest.spyOn(prisma.order, "update").mockResolvedValue({ id: orderId } as never)
    jest.spyOn(prisma.subscription, "update").mockResolvedValue({ id: subscriptionId } as never)
    jest.spyOn(prisma, "$transaction").mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops) as never
      }
      return (ops as (tx: unknown) => Promise<unknown>)(prisma) as never
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundService,
        {
          provide: YookassaClientFactory,
          useValue: {
            get: () => ({ createRefund }),
          },
        },
      ],
    }).compile()

    svc = moduleRef.get(RefundService)
  })

  it("creates YooKassa refund and marks Order REFUNDED, Subscription EXPIRED", async () => {
    createRefund.mockResolvedValue({
      id: "rf_1",
      payment_id: "pmt_1",
      status: "succeeded",
      amount: { value: "150.00", currency: "RUB" },
      created_at: "2026-04-26T00:00:00Z",
    } as never)

    const result = await svc.fullRefund(orderId)

    expect(result).toEqual({ yookassaRefundId: "rf_1", subscriptionId })
    expect(prisma.order.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: orderId } })
    expect(createRefund).toHaveBeenCalledWith(
      {
        payment_id: "pmt_1",
        amount: { value: "150.00", currency: "RUB" },
        description: "Возврат",
      },
      expect.any(String),
    )
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: {
        status: "REFUNDED",
        refundedAt: expect.any(Date),
        yookassaRefundId: "rf_1",
      },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: {
        status: "EXPIRED",
        expiredAt: expect.any(Date),
        currentPeriodEnd: expect.any(Date),
      },
    })
  })

  it("rejects already-refunded order", async () => {
    jest.spyOn(prisma.order, "findUniqueOrThrow").mockResolvedValue(
      makeOrder({ status: "REFUNDED", refundedAt: new Date("2026-04-26T00:00:00Z") }) as never,
    )

    await expect(svc.fullRefund(orderId)).rejects.toThrow(/already refunded/i)
    expect(createRefund).not.toHaveBeenCalled()
  })
})
