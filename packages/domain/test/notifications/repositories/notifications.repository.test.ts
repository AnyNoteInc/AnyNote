import { describe, it, expect, vi } from 'vitest'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { NotificationRepository } from '../../../src/notifications/repositories/notifications.repository.ts'

function makeUow(delegates: Record<string, Record<string, ReturnType<typeof vi.fn>>>) {
  const client = delegates as never
  const uow: UnitOfWork = {
    client: () => client,
    transaction: async (fn) => fn(),
  }
  return uow
}

describe('NotificationRepository.markRead', () => {
  it('calls updateMany with ids filter and readAt, returns { updated }', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }))
    const uow = makeUow({ notificationInApp: { updateMany } })
    const repo = new NotificationRepository(uow)
    const result = await repo.markRead('u1', ['id1', 'id2'])
    expect(result).toEqual({ updated: 2 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['id1', 'id2'] }, readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })
})

describe('NotificationRepository.markAllRead', () => {
  it('calls updateMany without id filter, returns { updated }', async () => {
    const updateMany = vi.fn(async () => ({ count: 5 }))
    const uow = makeUow({ notificationInApp: { updateMany } })
    const repo = new NotificationRepository(uow)
    const result = await repo.markAllRead('u1')
    expect(result).toEqual({ updated: 5 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })
})

describe('NotificationRepository.deleteAll', () => {
  it('calls deleteMany and returns { deleted }', async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }))
    const uow = makeUow({ notificationInApp: { deleteMany } })
    const repo = new NotificationRepository(uow)
    const result = await repo.deleteAll('u1')
    expect(result).toEqual({ deleted: 3 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })
})
