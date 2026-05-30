import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { Domain } from '@repo/domain'

import { NotificationService } from './notification.service.js'
import { makeFakeDomain } from './__testutils__/fake-domain.js'

function makeMockPrisma() {
  const findMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const __mocks = { findMany }
  return {
    notificationInApp: { findMany },
    __mocks,
  } as unknown as PrismaClient & { __mocks: typeof __mocks }
}

function makeMockDomain() {
  const markRead = jest.fn<(...a: unknown[]) => Promise<{ updated: number }>>(
    async () => ({ updated: 0 }),
  )
  const markAllRead = jest.fn<(...a: unknown[]) => Promise<{ updated: number }>>(
    async () => ({ updated: 0 }),
  )
  return Object.assign(
    makeFakeDomain({
      notifications: { markRead, markAllRead } as unknown as Domain['notifications'],
    }),
    { __mocks: { markRead, markAllRead } },
  )
}

describe('NotificationService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let mockDomain: ReturnType<typeof makeMockDomain>
  let svc: NotificationService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    mockDomain = makeMockDomain()
    // Construct directly, bypassing NestJS DI — mirrors the SP1 pattern
    svc = new (NotificationService as new (prisma: PrismaClient, domain: unknown) => NotificationService)(
      mockPrisma,
      mockDomain,
    )
  })

  it('markRead(ids) delegates to domain.notifications.markRead and returns { count }', async () => {
    mockDomain.__mocks.markRead.mockResolvedValue({ updated: 2 })
    const result = await svc.markRead({ userId: 'u1', ids: ['id1', 'id2'] })
    expect(mockDomain.__mocks.markRead).toHaveBeenCalledWith('u1', { ids: ['id1', 'id2'] })
    expect(result).toEqual({ count: 2 })
  })

  it('markRead(all:true) delegates to domain.notifications.markAllRead and returns { count }', async () => {
    mockDomain.__mocks.markAllRead.mockResolvedValue({ updated: 5 })
    const result = await svc.markRead({ userId: 'u1', all: true })
    expect(mockDomain.__mocks.markAllRead).toHaveBeenCalledWith('u1')
    expect(result).toEqual({ count: 5 })
  })

  it('list uses direct Prisma findMany', async () => {
    mockPrisma.__mocks.findMany.mockResolvedValue([])
    await svc.list({ userId: 'u1', unreadOnly: true, limit: 10 })
    expect(mockPrisma.__mocks.findMany).toHaveBeenCalled()
    expect(mockDomain.__mocks.markRead).not.toHaveBeenCalled()
    expect(mockDomain.__mocks.markAllRead).not.toHaveBeenCalled()
  })
})
