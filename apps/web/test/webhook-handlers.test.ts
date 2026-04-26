import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@repo/db'
import type { Payment, YookassaClient } from '@repo/yookassa'

vi.mock('server-only', () => ({}))

import { handlePaymentSucceeded } from '../src/server/billing/webhook-handlers'

describe('handlePaymentSucceeded', () => {
  let userId: string
  let planId: string
  let orderId: string
  const TEST_EMAIL_SUFFIX = '+webhook-test@anynote.dev'

  beforeEach(async () => {
    // cleanup
    await prisma.order.deleteMany({ where: { user: { email: { contains: TEST_EMAIL_SUFFIX } } } })
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: TEST_EMAIL_SUFFIX } } },
    })
    await prisma.user.deleteMany({ where: { email: { contains: TEST_EMAIL_SUFFIX } } })

    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    planId = pro.id
    const user = await prisma.user.create({
      data: {
        email: `wh${TEST_EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'WH',
        firstName: 'WH',
        lastName: 'Test',
      },
    })
    userId = user.id
    const order = await prisma.order.create({
      data: {
        userId,
        planId,
        billingPeriod: 'MONTHLY',
        amountKopecks: 15000,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: true,
        savedPaymentMethod: true,
        yookassaPaymentId: 'pmt_wh_test_1',
        yookassaIdempotencyKey: 'key-wh-test-1',
      },
    })
    orderId = order.id
  })

  it('transitions Order to PAID and creates ACTIVE Subscription', async () => {
    const yk = {
      getPayment: vi.fn(
        async (id: string) =>
          ({
            id,
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            payment_method: {
              id: 'pm_xx',
              type: 'bank_card',
              saved: true,
              card: { last4: '0000', card_type: 'MIR' },
            },
            created_at: '2026-04-26T00:00:00Z',
          }) as Payment,
      ),
    }
    await handlePaymentSucceeded({ yookassa: yk as unknown as YookassaClient, prisma }, {
      id: 'pmt_wh_test_1',
    } as Payment)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('PAID')
    expect(order.paidAt).not.toBeNull()
    const sub = await prisma.subscription.findFirst({ where: { userId, planId } })
    expect(sub?.status).toBe('ACTIVE')
    expect(sub?.paymentMethodId).toBe('pm_xx')
    expect(sub?.paymentMethodLast4).toBe('0000')
  })

  it('is idempotent: second invocation does not duplicate Subscription', async () => {
    const yk = {
      getPayment: vi.fn(
        async () =>
          ({
            id: 'pmt_wh_test_1',
            status: 'succeeded',
            amount: { value: '150.00', currency: 'RUB' },
            created_at: '2026-04-26T00:00:00Z',
          }) as Payment,
      ),
    }
    await handlePaymentSucceeded({ yookassa: yk as unknown as YookassaClient, prisma }, {
      id: 'pmt_wh_test_1',
    } as Payment)
    await handlePaymentSucceeded({ yookassa: yk as unknown as YookassaClient, prisma }, {
      id: 'pmt_wh_test_1',
    } as Payment)
    const subs = await prisma.subscription.findMany({ where: { userId, planId } })
    expect(subs).toHaveLength(1)
  })

  it('ignores when YooKassa says payment is not succeeded', async () => {
    const yk = {
      getPayment: vi.fn(
        async () =>
          ({
            id: 'pmt_wh_test_1',
            status: 'pending',
            amount: { value: '150.00', currency: 'RUB' },
            created_at: '2026-04-26T00:00:00Z',
          }) as Payment,
      ),
    }
    await handlePaymentSucceeded({ yookassa: yk as unknown as YookassaClient, prisma }, {
      id: 'pmt_wh_test_1',
    } as Payment)
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('PENDING')
  })
})
