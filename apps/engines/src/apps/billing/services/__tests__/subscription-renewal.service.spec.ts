import { jest } from '@jest/globals'
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { prisma } from '@repo/db'

import { SubscriptionRenewalService } from '../subscription-renewal.service.js'
import { YookassaClientFactory } from '../yookassa-client.factory.js'

const subscriptionId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const workspaceId = '77777777-7777-4777-8777-777777777777'
const currentPeriodEnd = new Date('2026-06-10T00:00:00.000Z')
/** The deterministic key (group review Fix 2): YooKassa dedupes per key, so two overlapping ticks cannot double-charge. */
const expectedIdempotencyKey = `renew:${subscriptionId}:${currentPeriodEnd.getTime()}`

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: subscriptionId,
    userId,
    planId: '44444444-4444-4444-8444-444444444444',
    status: 'ACTIVE',
    billingPeriod: 'MONTHLY',
    currency: 'RUB',
    paymentMethodId: 'pm_saved',
    currentPeriodStart: new Date('2026-05-10T00:00:00.000Z'),
    currentPeriodEnd,
    plan: {
      name: 'Pro',
      priceMonthlyKopecks: 15_000,
      priceYearlyKopecks: 150_000,
      maxMembersPerWorkspace: 5,
      pricePerExtraSeatMonthlyKopecks: 9_000,
      pricePerExtraSeatYearlyKopecks: 90_000,
    },
    ...overrides,
  }
}

/** One owned workspace carrying 2 paid seats with a reduction to 1 scheduled. */
function mockSeatFixtures() {
  jest.spyOn(prisma.workspace, 'findMany').mockResolvedValue([{ id: workspaceId }] as never)
  jest
    .spyOn(prisma.workspaceSeatAddon, 'findMany')
    .mockResolvedValue([{ workspaceId, paidSeats: 2, scheduledSeats: 1 }] as never)
  jest
    .spyOn(prisma.workspaceMember, 'groupBy')
    .mockResolvedValue([{ workspaceId, _count: { _all: 3 } }] as never)
  jest
    .spyOn(prisma.workspaceLimit, 'findMany')
    .mockResolvedValue([{ workspaceId, maxMembers: 5 }] as never)
}

describe('SubscriptionRenewalService', () => {
  let svc: SubscriptionRenewalService
  let chargeWithSavedMethod: jest.Mock

  beforeEach(async () => {
    jest.restoreAllMocks()
    chargeWithSavedMethod = jest.fn()
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    jest.spyOn(prisma.order, 'create').mockResolvedValue({ id: orderId } as never)
    jest.spyOn(prisma.order, 'update').mockResolvedValue({ id: orderId } as never)
    jest.spyOn(prisma.subscription, 'update').mockResolvedValue({ id: subscriptionId } as never)
    // Seat-renewal defaults: no owned workspaces ⇒ zero seat charge and no
    // seat writes — the flat-price regression baseline for the older tests.
    jest.spyOn(prisma.workspace, 'findMany').mockResolvedValue([] as never)
    jest.spyOn(prisma.workspaceSeatAddon, 'findMany').mockResolvedValue([] as never)
    jest.spyOn(prisma.workspaceSeatAddon, 'update').mockResolvedValue({} as never)
    jest.spyOn(prisma.workspaceSeatAddon, 'updateMany').mockResolvedValue({ count: 0 } as never)
    jest.spyOn(prisma.workspaceSeatSnapshot, 'create').mockResolvedValue({} as never)
    jest.spyOn(prisma.seatBillingEvent, 'create').mockResolvedValue({} as never)
    jest.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as never)
    jest.spyOn(prisma, '$transaction').mockImplementation(async (ops: unknown) => {
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

  it('marks the renewal order paid and extends the subscription when saved-method charge succeeds', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-04-26T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: '33333333-3333-4333-8333-333333333333',
        planId: '44444444-4444-4444-8444-444444444444',
        subscriptionId,
        billingPeriod: 'MONTHLY',
        amountKopecks: 15_000,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: false,
        savedPaymentMethod: true,
      }),
    })
    expect(chargeWithSavedMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { value: '150.00', currency: 'RUB' },
        payment_method_id: 'pm_saved',
        description: 'Автопродление Pro (Месяц)',
        metadata: { orderId, subscriptionId },
      }),
      expect.any(String),
    )
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: expect.objectContaining({
        status: 'PAID',
        yookassaPaymentId: 'pmt_succeeded',
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

  it('marks the renewal order failed and expires the subscription when saved-method charge is canceled', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_canceled',
      status: 'canceled',
      amount: { value: '150.00', currency: 'RUB' },
      paid: false,
      created_at: '2026-04-26T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'FAILED', yookassaPaymentId: 'pmt_canceled' },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: { status: 'EXPIRED', expiredAt: expect.any(Date) },
    })
  })

  it('marks the renewal order failed and expires the subscription when saved-method charge throws', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockRejectedValue(new Error('charge failed') as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'FAILED' },
    })
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: subscriptionId },
      data: { status: 'EXPIRED', expiredAt: expect.any(Date) },
    })
  })

  it('charges tier + effective seat price and applies scheduled seats with snapshot/ledger/audit in the success tx', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    mockSeatFixtures()
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '240.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    // effective seats = scheduled ?? paid = 1 ⇒ 15 000 + 1 × 9 000; the order
    // carries the charge-time row snapshot so BOTH completion paths apply
    // exactly what was charged (group review Fix 4).
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountKopecks: 24_000,
        status: 'PENDING',
        metadata: {
          kind: 'seat_renewal',
          rows: [
            {
              workspaceId,
              effectiveSeats: 1,
              seatKopecks: 9_000,
              memberCount: 3,
              includedSeats: 5,
              paidSeats: 2,
              scheduledSeats: 1,
            },
          ],
        },
      }),
    })
    expect(chargeWithSavedMethod).toHaveBeenCalledWith(
      expect.objectContaining({ amount: { value: '240.00', currency: 'RUB' } }),
      expect.any(String),
    )
    // the scheduled reduction is applied with the period roll
    expect(prisma.workspaceSeatAddon.update).toHaveBeenCalledWith({
      where: { workspaceId },
      data: { paidSeats: 1, scheduledSeats: null },
    })
    expect(prisma.workspaceSeatSnapshot.create).toHaveBeenCalledWith({
      data: {
        workspaceId,
        subscriptionId,
        orderId,
        memberCount: 3,
        includedSeats: 5,
        extraSeats: 1,
        seatAmountKopecks: 9_000,
      },
    })
    expect(prisma.seatBillingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId,
        type: 'SEATS_RENEWED',
        seatsDelta: -1,
        seatsAfter: 1,
        amountKopecks: 9_000,
        orderId,
        actorId: null,
      }),
    })
    expect(prisma.workspaceAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId,
        actorId: null,
        action: 'seats.renewal_applied',
      }),
    })
  })

  it('uses the deterministic idempotency key renew:<subscriptionId>:<periodEnd ms> for both the order and the charge', async () => {
    // Two overlapping ticks compute the SAME key — YooKassa dedupes per key,
    // so even a second charge attempt cannot bill the owner twice (Fix 2).
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    expect(expectedIdempotencyKey.length).toBeLessThanOrEqual(64) // the column is VarChar(64)
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ yookassaIdempotencyKey: expectedIdempotencyKey }),
    })
    expect(chargeWithSavedMethod).toHaveBeenCalledWith(expect.anything(), expectedIdempotencyKey)
  })

  it('skips the renewal when a concurrent tick already created the order: P2002 on the key, no charge, no throw', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    // Tick 1 renews normally.
    await svc.renewOne(subscriptionId)
    expect(chargeWithSavedMethod).toHaveBeenCalledTimes(1)

    // Tick 2 for the same subscription+period: the unique yookassaIdempotencyKey
    // makes the order create P2002 — the renewal must skip gracefully.
    jest
      .spyOn(prisma.order, 'create')
      .mockRejectedValueOnce(
        Object.assign(new Error('Unique constraint failed on yookassa_idempotency_key'), {
          code: 'P2002',
        }) as never,
      )
    await expect(svc.renewOne(subscriptionId)).resolves.toBeUndefined()

    expect(chargeWithSavedMethod).toHaveBeenCalledTimes(1) // no second charge
  })

  it('does not renew a subscription without a currentPeriodEnd — no period, no deterministic key, no charge', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription({ currentPeriodEnd: null }) as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.create).not.toHaveBeenCalled()
    expect(chargeWithSavedMethod).not.toHaveBeenCalled()
  })

  it('applies EXACTLY the charged rows even when the addon changed between order creation and completion', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    jest.spyOn(prisma.workspace, 'findMany').mockResolvedValue([{ id: workspaceId }] as never)
    jest
      .spyOn(prisma.workspaceMember, 'groupBy')
      .mockResolvedValue([{ workspaceId, _count: { _all: 3 } }] as never)
    jest
      .spyOn(prisma.workspaceLimit, 'findMany')
      .mockResolvedValue([{ workspaceId, maxMembers: 5 }] as never)
    // Charge-time read: 2 paid with a reduction to 1 scheduled ⇒ charged
    // effective = 1. Application-time read (liveness only): the addon GREW
    // mid-window — the re-read 5 must NOT leak into what gets applied.
    jest
      .spyOn(prisma.workspaceSeatAddon, 'findMany')
      .mockResolvedValueOnce([{ workspaceId, paidSeats: 2, scheduledSeats: 1 }] as never)
      .mockResolvedValueOnce([{ workspaceId, paidSeats: 5, scheduledSeats: null }] as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '240.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    // charged 15 000 + 1 × 9 000 …
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountKopecks: 24_000 }),
    })
    // … and applied EXACTLY 1 seat @ 9 000 — never the re-read 5.
    expect(prisma.workspaceSeatAddon.update).toHaveBeenCalledWith({
      where: { workspaceId },
      data: { paidSeats: 1, scheduledSeats: null },
    })
    expect(prisma.workspaceSeatSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ extraSeats: 1, seatAmountKopecks: 9_000 }),
    })
    expect(prisma.seatBillingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'SEATS_RENEWED', seatsAfter: 1, amountKopecks: 9_000 }),
    })
  })

  it('REGRESSION PIN: zero-addon owners charge exactly the flat tier price and write no seat records', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_succeeded',
      status: 'succeeded',
      amount: { value: '150.00', currency: 'RUB' },
      paid: true,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountKopecks: 15_000 }),
    })
    expect(prisma.workspaceSeatSnapshot.create).not.toHaveBeenCalled()
    expect(prisma.seatBillingEvent.create).not.toHaveBeenCalled()
    expect(prisma.workspaceAuditLog.create).not.toHaveBeenCalled()
    expect(prisma.workspaceSeatAddon.update).not.toHaveBeenCalled()
  })

  it('PIN: a pending charge applies NO seats — the order carries the seat amount and the webhook path settles it', async () => {
    jest
      .spyOn(prisma.subscription, 'findUniqueOrThrow')
      .mockResolvedValue(makeSubscription() as never)
    mockSeatFixtures()
    chargeWithSavedMethod.mockResolvedValue({
      id: 'pmt_pending',
      status: 'pending',
      amount: { value: '240.00', currency: 'RUB' },
      paid: false,
      created_at: '2026-06-12T00:00:00Z',
    } as never)

    await svc.renewOne(subscriptionId)

    // the order amount already includes the seat charge for the webhook to settle
    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountKopecks: 24_000 }),
    })
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { yookassaPaymentId: 'pmt_pending' },
    })
    // seats apply ONLY in the tx that flips the order PAID — here it stays PENDING
    expect(prisma.subscription.update).not.toHaveBeenCalled()
    expect(prisma.workspaceSeatAddon.update).not.toHaveBeenCalled()
    expect(prisma.workspaceSeatSnapshot.create).not.toHaveBeenCalled()
    expect(prisma.seatBillingEvent.create).not.toHaveBeenCalled()
  })

  it('expireCanceled resets addons of expired owners: ADDONS_RESET ledger + audit, no charge', async () => {
    jest
      .spyOn(prisma.subscription, 'findMany')
      .mockResolvedValue([{ id: subscriptionId, userId }] as never)
    jest.spyOn(prisma.subscription, 'updateMany').mockResolvedValue({ count: 1 } as never)
    // syncWorkspaceLimits internals: expired owner falls back to personal
    jest.spyOn(prisma.subscription, 'findFirst').mockResolvedValue(null as never)
    jest.spyOn(prisma.plan, 'findUniqueOrThrow').mockResolvedValue({
      slug: 'personal',
      maxMembersPerWorkspace: 1,
      maxFileBytes: 524_288_000n,
    } as never)
    jest.spyOn(prisma.workspaceLimit, 'upsert').mockResolvedValue({} as never)
    jest.spyOn(prisma.workspace, 'findMany').mockResolvedValue([{ id: workspaceId }] as never)
    jest
      .spyOn(prisma.workspaceSeatAddon, 'findMany')
      .mockResolvedValue([{ workspaceId, paidSeats: 2, scheduledSeats: null }] as never)

    await svc.expireCanceled()

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [subscriptionId] } },
      data: { status: 'EXPIRED', expiredAt: expect.any(Date) },
    })
    expect(prisma.seatBillingEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId,
        type: 'ADDONS_RESET',
        seatsDelta: -2,
        seatsAfter: 0,
        actorId: userId,
        metadata: expect.objectContaining({ reason: 'subscription_expired' }),
      }),
    })
    expect(prisma.workspaceAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId,
        actorId: userId,
        action: 'seats.addons_reset',
      }),
    })
    expect(prisma.workspaceSeatAddon.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: { in: [workspaceId] } },
      data: { paidSeats: 0, scheduledSeats: null },
    })
  })

  it('renews due active subscriptions with saved payment methods in batches', async () => {
    const first = '55555555-5555-4555-8555-555555555555'
    const second = '66666666-6666-4666-8666-666666666666'
    jest
      .spyOn(prisma.subscription, 'findMany')
      .mockResolvedValue([{ id: first }, { id: second }] as never)
    const renewOne = jest.spyOn(svc, 'renewOne').mockResolvedValue(undefined)

    await svc.renewActive()

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
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
