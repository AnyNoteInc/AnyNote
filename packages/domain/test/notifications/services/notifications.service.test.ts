import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { NotificationRepository } from '../../../src/notifications/repositories/notifications.repository.ts'
import { NotificationService } from '../../../src/notifications/services/notifications.service.ts'

function makeRepo(
  overrides: Partial<Record<keyof NotificationRepository, ReturnType<typeof vi.fn>>> = {},
) {
  return {
    markRead: vi.fn(async () => ({ updated: 1 })),
    markAllRead: vi.fn(async () => ({ updated: 2 })),
    deleteAll: vi.fn(async () => ({ deleted: 3 })),
    ...overrides,
  } as unknown as NotificationRepository
}

describe('NotificationService.markRead', () => {
  it('throws BAD_REQUEST (400) when ids is empty', async () => {
    const svc = new NotificationService(makeRepo())
    await expect(svc.markRead('u1', { ids: [] })).rejects.toMatchObject({
      httpStatus: 400,
      message: 'ids must not be empty',
    })
    await expect(svc.markRead('u1', { ids: [] })).rejects.toSatisfy(isDomainError)
  })

  it('delegates to repo.markRead and returns MarkReadResultDto', async () => {
    const repo = makeRepo({ markRead: vi.fn(async () => ({ updated: 3 })) })
    const svc = new NotificationService(repo)
    const result = await svc.markRead('u1', { ids: ['id1', 'id2'] })
    expect(result).toEqual({ updated: 3 })
    expect(repo.markRead).toHaveBeenCalledWith('u1', ['id1', 'id2'])
  })
})

describe('NotificationService.markAllRead', () => {
  it('delegates to repo.markAllRead and returns MarkReadResultDto', async () => {
    const repo = makeRepo()
    const svc = new NotificationService(repo)
    const result = await svc.markAllRead('u1')
    expect(result).toEqual({ updated: 2 })
    expect(repo.markAllRead).toHaveBeenCalledWith('u1')
  })
})

describe('NotificationService.deleteAll', () => {
  it('delegates to repo.deleteAll and returns DeleteResultDto', async () => {
    const repo = makeRepo()
    const svc = new NotificationService(repo)
    const result = await svc.deleteAll('u1')
    expect(result).toEqual({ deleted: 3 })
    expect(repo.deleteAll).toHaveBeenCalledWith('u1')
  })
})
