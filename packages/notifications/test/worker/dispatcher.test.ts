import { describe, expect, it, vi } from 'vitest'

import type { PrismaClient } from '@repo/db'

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

type MockPrisma = {
  notificationDelivery: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  notificationInApp: { upsert: ReturnType<typeof vi.fn> }
  pushSubscription: { delete: ReturnType<typeof vi.fn> }
}

function makeMock(delivery: Record<string, unknown>): MockPrisma {
  return {
    notificationDelivery: {
      findUnique: vi.fn(async () => delivery),
      update: vi.fn(async () => undefined),
    },
    notificationInApp: { upsert: vi.fn(async () => undefined) },
    pushSubscription: { delete: vi.fn(async () => undefined) },
  }
}

const asPrisma = (mock: MockPrisma): PrismaClient => mock as unknown as PrismaClient

describe('runDispatcherTick', () => {
  it('marks delivery DELIVERED on success', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockResolvedValueOnce(undefined)
    const mock = makeMock({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 0,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(asPrisma(mock), { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    expect(mock.notificationDelivery.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'd1' },
      data: { status: 'DELIVERED' },
    })
  })

  it('creates the in-app notification when an IN_APP delivery fires', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    const mock = makeMock({
      id: 'd1',
      channel: 'IN_APP',
      attempts: 0,
      userId: 'user-1',
      eventId: 'evt-1',
      event: {},
      targetSubscription: null,
    })

    await runDispatcherTick(asPrisma(mock), { workerId: 'w1', batchSize: 10, maxAttempts: 5 })

    expect(mock.notificationInApp.upsert).toHaveBeenCalledWith({
      where: { eventId: 'evt-1' },
      create: { eventId: 'evt-1', userId: 'user-1' },
      update: {},
    })
    expect(mock.notificationDelivery.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'd1' },
      data: { status: 'DELIVERED' },
    })
  })

  it('increments attempts and reschedules on failure', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const mock = makeMock({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 1,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(asPrisma(mock), { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    const call = mock.notificationDelivery.update.mock.calls[0][0]
    expect(call.data.attempts).toBe(2)
    expect(call.data.status).toBe('PENDING')
    expect(call.data.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('marks FAILED after max attempts', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendEmailMock.mockRejectedValueOnce(new Error('boom'))
    const mock = makeMock({
      id: 'd1',
      channel: 'EMAIL',
      attempts: 4,
      event: {},
      targetSubscription: null,
    })
    await runDispatcherTick(asPrisma(mock), { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    expect(mock.notificationDelivery.update.mock.calls[0][0].data.status).toBe('FAILED')
  })

  it('deletes push subscription and marks FAILED on GoneSubscriptionError', async () => {
    lockMock.mockResolvedValueOnce(['d1'])
    sendPushMock.mockRejectedValueOnce(new GoneSubscriptionError('gone'))
    const mock = makeMock({
      id: 'd1',
      channel: 'WEB_PUSH',
      attempts: 0,
      targetSubscriptionId: 'sub1',
      event: {},
      targetSubscription: { id: 'sub1' },
    })
    await runDispatcherTick(asPrisma(mock), { workerId: 'w1', batchSize: 10, maxAttempts: 5 })
    expect(mock.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 'sub1' } })
    expect(mock.notificationDelivery.update.mock.calls[0][0].data.status).toBe('FAILED')
  })
})
