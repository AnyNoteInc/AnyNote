import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally and build a
// hand-mocked PrismaClient. The REAL @repo/domain functions run against the mock prisma,
// so we assert on mocked prisma calls + returned values directly.
import { NotificationService } from './notification.service.js'

function makeMockPrisma() {
  const updateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const deleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const findMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const __mocks = { updateMany, deleteMany, findMany }
  return {
    notificationInApp: { updateMany, deleteMany, findMany },
    __mocks,
  } as unknown as PrismaClient & { __mocks: typeof __mocks }
}

describe('NotificationService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let svc: NotificationService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    svc = new NotificationService(mockPrisma)
  })

  it('markRead(ids) calls notificationInApp.updateMany with ids filter and returns { count }', async () => {
    mockPrisma.__mocks.updateMany.mockResolvedValue({ count: 2 })
    const result = await svc.markRead({ userId: 'u1', ids: ['id1', 'id2'] })
    expect(mockPrisma.__mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', id: { in: ['id1', 'id2'] } }),
      }),
    )
    expect(result).toEqual({ count: 2 })
  })

  it('markRead(all:true) calls notificationInApp.updateMany without id filter and returns { count }', async () => {
    mockPrisma.__mocks.updateMany.mockResolvedValue({ count: 5 })
    const result = await svc.markRead({ userId: 'u1', all: true })
    const [[call]] = mockPrisma.__mocks.updateMany.mock.calls as [[{ where: Record<string, unknown> }]]
    expect(call.where).not.toHaveProperty('id')
    expect(call.where).toMatchObject({ userId: 'u1', readAt: null })
    expect(result).toEqual({ count: 5 })
  })

  it('list uses direct Prisma findMany', async () => {
    mockPrisma.__mocks.findMany.mockResolvedValue([])
    await svc.list({ userId: 'u1', unreadOnly: true, limit: 10 })
    expect(mockPrisma.__mocks.findMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.updateMany).not.toHaveBeenCalled()
  })
})
