import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { NotificationService } from './notification.service.js'

describe('NotificationService', () => {
  const findMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const updateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { notificationInApp: { findMany, updateMany } } as unknown as PrismaClient
  let svc: NotificationService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new NotificationService(prisma)
  })

  it('lists unread by default and maps event fields', async () => {
    findMany.mockResolvedValue([
      {
        id: 'n1',
        readAt: null,
        createdAt: new Date('2026-05-28T00:00:00Z'),
        event: { type: 'REMINDER_DUE', category: 'SERVICE', resourceUrl: '/p/1' },
      },
    ])
    const out = await svc.list({ userId: 'u1', unreadOnly: true, limit: 50 })
    expect(out).toEqual([
      { id: 'n1', type: 'REMINDER_DUE', category: 'SERVICE', resourceUrl: '/p/1', read: false, createdAt: new Date('2026-05-28T00:00:00Z') },
    ])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', readAt: null } }))
  })

  it('markRead(all) clears all unread for the user', async () => {
    updateMany.mockResolvedValue({ count: 4 })
    const out = await svc.markRead({ userId: 'u1', all: true })
    expect(out.count).toBe(4)
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('markRead(ids) clears only the given ids', async () => {
    updateMany.mockResolvedValue({ count: 1 })
    await svc.markRead({ userId: 'u1', ids: ['n1'] })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null, id: { in: ['n1'] } },
      data: { readAt: expect.any(Date) },
    })
  })
})
