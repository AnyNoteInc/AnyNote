import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import { YookassaApiError } from '@repo/yookassa'
import type { PrismaClient } from '@repo/db'

import { subscriptionRouter } from '../src/routers/subscription'
import { createCallerFactory } from '../src/trpc'

type MockYookassa = {
  createPayment: ReturnType<typeof vi.fn>
  getPayment?: ReturnType<typeof vi.fn>
}

function ctx(prisma: PrismaClient, yookassa: MockYookassa) {
  return {
    prisma,
    user: { id: 'user-1' } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: yookassa as never,
    returnUrlBase: 'http://localhost',
  }
}

function buildPrisma(overrides: Partial<Record<string, unknown>> = {}): {
  prisma: PrismaClient
  orderCreate: ReturnType<typeof vi.fn>
  orderUpdate: ReturnType<typeof vi.fn>
} {
  const orderCreate = vi.fn().mockResolvedValue({ id: 'order-1' })
  const orderUpdate = vi.fn().mockResolvedValue({})
  const prisma = {
    plan: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'plan-pro', slug: 'pro', priceMonthlyKopecks: 39000, name: 'Pro' }),
    },
    subscription: { findFirst: vi.fn().mockResolvedValue(null) },
    order: { create: orderCreate, update: orderUpdate },
    ...overrides,
  } as unknown as PrismaClient
  return { prisma, orderCreate, orderUpdate }
}

describe('subscription.startCheckout', () => {
  const ORIGINAL_ENV = process.env.YOOKASSA_SAVE_PAYMENT_METHOD

  beforeEach(() => {
    delete process.env.YOOKASSA_SAVE_PAYMENT_METHOD
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.YOOKASSA_SAVE_PAYMENT_METHOD
    else process.env.YOOKASSA_SAVE_PAYMENT_METHOD = ORIGINAL_ENV
  })

  it('sends save_payment_method=true by default and persists savedPaymentMethod=true', async () => {
    const { prisma, orderCreate } = buildPrisma()
    const yookassa: MockYookassa = {
      createPayment: vi.fn().mockResolvedValue({
        id: 'pmt_1',
        status: 'pending',
        paid: false,
        amount: { value: '390.00', currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          confirmation_url: 'https://yookassa.ru/pay/pmt_1',
        },
        created_at: '2026-05-13T00:00:00Z',
      }),
    }

    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))
    const result = await caller.startCheckout({ planSlug: 'pro', period: 'MONTHLY' })

    expect(result.confirmationUrl).toBe('https://yookassa.ru/pay/pmt_1')
    expect(orderCreate.mock.calls[0]![0].data.savedPaymentMethod).toBe(true)
    const [payload] = yookassa.createPayment.mock.calls[0]!
    expect(payload.save_payment_method).toBe(true)
  })

  it('omits save_payment_method when YOOKASSA_SAVE_PAYMENT_METHOD=false', async () => {
    process.env.YOOKASSA_SAVE_PAYMENT_METHOD = 'false'
    const { prisma, orderCreate } = buildPrisma()
    const yookassa: MockYookassa = {
      createPayment: vi.fn().mockResolvedValue({
        id: 'pmt_2',
        status: 'pending',
        paid: false,
        amount: { value: '390.00', currency: 'RUB' },
        confirmation: {
          type: 'redirect',
          confirmation_url: 'https://yookassa.ru/pay/pmt_2',
        },
        created_at: '2026-05-13T00:00:00Z',
      }),
    }

    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))
    await caller.startCheckout({ planSlug: 'pro', period: 'MONTHLY' })

    expect(orderCreate.mock.calls[0]![0].data.savedPaymentMethod).toBe(false)
    const [payload] = yookassa.createPayment.mock.calls[0]!
    expect(payload).not.toHaveProperty('save_payment_method')
  })

  it('marks order FAILED and surfaces YooKassa description when 403 forbidden', async () => {
    const { prisma, orderUpdate } = buildPrisma()
    const yookassa: MockYookassa = {
      createPayment: vi.fn().mockRejectedValue(
        new YookassaApiError(
          'forbidden: Магазин не имеет права на проведение операции',
          403,
          { code: 'forbidden', description: 'Магазин не имеет права на проведение операции' },
        ),
      ),
    }

    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))
    await expect(caller.startCheckout({ planSlug: 'pro', period: 'MONTHLY' })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
        message: 'forbidden: Магазин не имеет права на проведение операции',
      },
    )
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'FAILED' },
    })
  })
})

describe('subscription.syncOrder', () => {
  const PENDING_ORDER = {
    userId: 'user-1',
    status: 'PENDING',
    yookassaPaymentId: 'pmt_yk_1',
  }
  const PAID_ORDER = {
    id: 'order-1',
    userId: 'user-1',
    status: 'PAID',
    plan: { name: 'Pro', slug: 'pro' },
  }
  const STILL_PENDING_ORDER = {
    id: 'order-1',
    userId: 'user-1',
    status: 'PENDING',
    plan: { name: 'Pro', slug: 'pro' },
  }

  function buildSyncPrisma(opts: {
    initialOrder: typeof PENDING_ORDER | null
    finalOrder: unknown
    transactionImpl?: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>
  }): { prisma: PrismaClient; transaction: ReturnType<typeof vi.fn> } {
    const transaction = vi.fn().mockImplementation(opts.transactionImpl ?? (async (cb) => cb({
      subscription: { updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'sub-1' }), update: vi.fn().mockResolvedValue({ id: 'sub-1' }) },
      order: { update: vi.fn().mockResolvedValue({}) },
    })))
    const prisma = {
      order: {
        findUnique: vi.fn().mockImplementation(async ({ where, select, include }: { where: { id?: string; yookassaPaymentId?: string }; select?: unknown; include?: unknown }) => {
          if (where.yookassaPaymentId) {
            return opts.initialOrder
              ? { ...opts.initialOrder, id: 'order-1', planId: 'plan-pro', billingPeriod: 'MONTHLY', plan: { id: 'plan-pro', slug: 'pro' } }
              : null
          }
          if (select) return opts.initialOrder
          if (include) return opts.finalOrder
          return null
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(opts.finalOrder),
      },
      $transaction: transaction,
    } as unknown as PrismaClient
    return { prisma, transaction }
  }

  it('returns the order without calling YooKassa when status is not PENDING', async () => {
    const { prisma } = buildSyncPrisma({
      initialOrder: { ...PENDING_ORDER, status: 'PAID' } as never,
      finalOrder: PAID_ORDER,
    })
    const yookassa: MockYookassa = {
      createPayment: vi.fn(),
      getPayment: vi.fn(),
    }
    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))

    const result = await caller.syncOrder({ orderId: '00000000-0000-4000-8000-000000000001' })

    expect(yookassa.getPayment).not.toHaveBeenCalled()
    expect(result.status).toBe('PAID')
  })

  it('queries YooKassa when order is PENDING and applies succeeded transition', async () => {
    const { prisma } = buildSyncPrisma({
      initialOrder: PENDING_ORDER,
      finalOrder: PAID_ORDER,
    })
    const yookassa: MockYookassa = {
      createPayment: vi.fn(),
      getPayment: vi.fn().mockResolvedValue({
        id: 'pmt_yk_1',
        status: 'succeeded',
        paid: true,
        amount: { value: '390.00', currency: 'RUB' },
        payment_method: { id: 'pm_1', type: 'bank_card', saved: true, card: { last4: '4242' } },
        created_at: '2026-05-13T00:00:00Z',
      }),
    }
    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))

    const result = await caller.syncOrder({ orderId: '00000000-0000-4000-8000-000000000001' })

    expect(yookassa.getPayment).toHaveBeenCalledWith('pmt_yk_1')
    expect(result.status).toBe('PAID')
  })

  it('swallows YooKassa errors and still returns the local order', async () => {
    const { prisma } = buildSyncPrisma({
      initialOrder: PENDING_ORDER,
      finalOrder: STILL_PENDING_ORDER,
    })
    const yookassa: MockYookassa = {
      createPayment: vi.fn(),
      getPayment: vi.fn().mockRejectedValue(new Error('network blip')),
    }
    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await caller.syncOrder({ orderId: '00000000-0000-4000-8000-000000000001' })
    errorSpy.mockRestore()

    expect(result.status).toBe('PENDING')
  })

  it('throws NOT_FOUND when order belongs to another user', async () => {
    const { prisma } = buildSyncPrisma({
      initialOrder: { ...PENDING_ORDER, userId: 'someone-else' },
      finalOrder: null,
    })
    const yookassa: MockYookassa = { createPayment: vi.fn(), getPayment: vi.fn() }
    const caller = createCallerFactory(subscriptionRouter)(ctx(prisma, yookassa))

    await expect(
      caller.syncOrder({ orderId: '00000000-0000-4000-8000-000000000001' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(yookassa.getPayment).not.toHaveBeenCalled()
  })
})
