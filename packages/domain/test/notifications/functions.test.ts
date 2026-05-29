import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { deleteAll, markAllRead, markRead } from '../../src/notifications/functions.ts'

describe('domain notifications', () => {
  const updateMany = vi.fn()
  const deleteMany = vi.fn()
  const prisma = {
    notificationInApp: { updateMany, deleteMany },
  } as unknown as PrismaClient

  beforeEach(() => vi.clearAllMocks())

  it('markRead calls updateMany with ids filter and readAt', async () => {
    updateMany.mockResolvedValue({ count: 2 })
    const result = await markRead(prisma, 'u1', { ids: ['id1', 'id2'] })
    expect(result).toEqual({ updated: 2 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['id1', 'id2'] }, readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('markAllRead calls updateMany without id filter', async () => {
    updateMany.mockResolvedValue({ count: 5 })
    const result = await markAllRead(prisma, 'u1')
    expect(result).toEqual({ updated: 5 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('deleteAll calls deleteMany and returns deleted count', async () => {
    deleteMany.mockResolvedValue({ count: 3 })
    const result = await deleteAll(prisma, 'u1')
    expect(result).toEqual({ deleted: 3 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })

  it('markRead throws for empty ids array', async () => {
    await expect(markRead(prisma, 'u1', { ids: [] })).rejects.toThrow()
  })
})
