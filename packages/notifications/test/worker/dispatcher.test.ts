import { describe, expect, it, vi } from 'vitest'

const { lockMock, sendEmailMock, sendPushMock, GoneSubscriptionError } = vi.hoisted(() => {
  class GoneSubscriptionError extends Error {}
  return {
    lockMock: vi.fn(async () => ['d1']),
    sendEmailMock: vi.fn(async () => undefined),
    sendPushMock: vi.fn(async () => undefined),
    GoneSubscriptionError,
  }
})

vi.mock('../../src/worker/lock.ts', () => ({ lockPendingDeliveries: lockMock }))
vi.mock('../../src/worker/send-email.ts', () => ({ sendDeliveryEmail: sendEmailMock }))
vi.mock('../../src/worker/send-web-push.ts', () => ({
  sendDeliveryWebPush: sendPushMock,
  GoneSubscriptionError,
}))

import { runDispatcherTick } from '../../src/worker/dispatcher.ts'

function makePrisma(delivery: Record<string, unknown>) {
  return {
    notificationDelivery: {
      findUnique: vi.fn(async () => delivery),
      update: vi.fn(async () => undefined),
    },
    pushSubscription: { delete: vi.fn(async () => undefined) },
  } as never
}

describe('runDispatcherTick', () => {
  it('marks delivery DELIVERED on success', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockResolvedValueOnce(undefined)
    const prisma = makePrisma({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 0,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as never as {
      notificationDelivery: { update: { mock: { calls: Array<[Record<string, unknown>]> } } }
    }).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0]).toMatchObject({
      where: { id: 'd1' },
      data: { status: 'DELIVERED' },
    })
  })

  it('increments attempts and reschedules on failure', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const prisma = makePrisma({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 1,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as never as {
      notificationDelivery: {
        update: { mock: { calls: Array<[{ data: { attempts: number; status: string; nextAttemptAt: unknown } }]> } }
      }
    }).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.attempts).toBe(2)
    expect(updateCalls[0][0].data.status).toBe('PENDING')
    expect(updateCalls[0][0].data.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('marks FAILED after max attempts', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const prisma = makePrisma({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 4,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const updateCalls = (prisma as never as {
      notificationDelivery: { update: { mock: { calls: Array<[{ data: { status: string } }]> } } }
    }).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.status).toBe('FAILED')
  })

  it('deletes push subscription and marks FAILED on GoneSubscriptionError', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendPushMock.mockRejectedValueOnce(new GoneSubscriptionError('gone'))
    const prisma = makePrisma({
      id: 'd1',
      channel: 'WEB_PUSH',
      attempts: 0,
      targetSubscriptionId: 'sub1',
      event: {},
      targetSubscription: { id: 'sub1' },
    })
    await runDispatcherTick(prisma, { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const pushDelete = (prisma as never as {
      pushSubscription: { delete: { mock: { calls: Array<[{ where: { id: string } }]> } } }
    }).pushSubscription.delete
    expect(pushDelete).toHaveBeenCalledWith({ where: { id: 'sub1' } })
    const updateCalls = (prisma as never as {
      notificationDelivery: { update: { mock: { calls: Array<[{ data: { status: string } }]> } } }
    }).notificationDelivery.update.mock.calls
    expect(updateCalls[0][0].data.status).toBe('FAILED')
  })
})
