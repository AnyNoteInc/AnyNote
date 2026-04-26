import { jest } from "@jest/globals"
import { Logger } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { prisma } from "@repo/db"

import { SubscriptionRenewalService } from "../subscription-renewal.service.js"
import { YookassaClientFactory } from "../yookassa-client.factory.js"

const subscriptionId = "11111111-1111-4111-8111-111111111111"
const orderId = "22222222-2222-4222-8222-222222222222"

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: subscriptionId,
    userId: "33333333-3333-4333-8333-333333333333",
    planId: "44444444-4444-4444-8444-444444444444",
    status: "ACTIVE",
    billingPeriod: "MONTHLY",
    currency: "RUB",
    paymentMethodId: "pm_saved",
    plan: {
      name: "Pro",
      priceMonthlyKopecks: 15_000,
      priceYearlyKopecks: 150_000,
    },
    ...overrides,
  }
}

describe("SubscriptionRenewalService", () => {
  let svc: SubscriptionRenewalService
  let chargeWithSavedMethod: jest.Mock

  beforeEach(async () => {
    jest.restoreAllMocks()
    chargeWithSavedMethod = jest.fn()
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)

    jest.spyOn(prisma.order, "create").mockResolvedValue({ id: orderId } as never)
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
        SubscriptionRenewalService,
        {
          provide: YookassaClientFactory,
          useValue: {
            get: () => ({ chargeWithSavedMethod }),
          },
        },
      ],
    }).compile()

    svc = moduleRef.get(SubscriptionRenewalService)
  })

  it("marks the renewal order paid and extends the subscription when saved-method charge succeeds", async () => {
    jest.spyOn(prisma.subscription, "findUniqueOrThrow").mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: "pmt_succeeded",
      status: "succeeded",
      amount: { value: "150.00", currency: "RUB" },
      paid: true,
      created_at: "2026-04-26T00:00:00Z",
    } as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "33333333-3333-4333-8333-333333333333",
        planId: "44444444-4444-4444-8444-444444444444",
        subscriptionId,
        billingPeriod: "MONTHLY",
        amountKopecks: 15_000,
        currency: "RUB",
        status: "PENDING",
        isInitial: false,
        savedPaymentMethod: true,
      }),
    })
    expect(chargeWithSavedMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { value: "150.00", currency: "RUB" },
        payment_method_id: "pm_saved",
        description: "Автопродление Pro (Месяц)",
        metadata: { orderId, subscriptionId },
      }),
      expect.any(String),
    )
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: expect.objectContaining({
        status: "PAID",
        yookassaPaymentId: "pmt_succeeded",
        paidAt: expect.any(Date),
      }),
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: expect.objectContaining({
        currentPeriodStart: expect.any(Date),
        currentPeriodEnd: expect.any(Date),
      }),
    })
  })

  it("marks the renewal order failed and expires the subscription when saved-method charge is canceled", async () => {
    jest.spyOn(prisma.subscription, "findUniqueOrThrow").mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: "pmt_canceled",
      status: "canceled",
      amount: { value: "150.00", currency: "RUB" },
      paid: false,
      created_at: "2026-04-26T00:00:00Z",
    } as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: "FAILED", yookassaPaymentId: "pmt_canceled" },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: { status: "EXPIRED", expiredAt: expect.any(Date) },
    })
  })

  it("marks the renewal order failed and expires the subscription when saved-method charge throws", async () => {
    jest.spyOn(prisma.subscription, "findUniqueOrThrow").mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockRejectedValue(new Error("charge failed") as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: "FAILED" },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: { status: "EXPIRED", expiredAt: expect.any(Date) },
    })
  })

  it("renews due active subscriptions with saved payment methods in batches", async () => {
    const first = "55555555-5555-4555-8555-555555555555"
    const second = "66666666-6666-4666-8666-666666666666"
    jest.spyOn(prisma.subscription, "findMany").mockResolvedValue([{ id: first }, { id: second }] as never)
    const renewOne = jest.spyOn(svc, "renewOne").mockResolvedValue(undefined)

    await svc.renewActive()

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: {
        status: "ACTIVE",
        cancelAtPeriodEnd: false,
        paymentMethodId: { not: null },
        currentPeriodEnd: { not: null, lte: expect.any(Date) },
      },
      take: 50,
      select: { id: true },
    })
    expect(renewOne).toHaveBeenCalledTimes(2)
    expect(renewOne).toHaveBeenNthCalledWith(1, first)
    expect(renewOne).toHaveBeenNthCalledWith(2, second)
  })
})
