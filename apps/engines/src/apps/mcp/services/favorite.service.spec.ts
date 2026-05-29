import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient.
import { FavoriteService } from './favorite.service.js'

function makeMockPrisma() {
  const deleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const aggregate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ _max: { position: null } }))
  const upsert = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ userId: 'u1', pageId: 'p1', position: 0 }))
  const favFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const favUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }),
  )
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ workspaceId: 'w1', userId: 'u1', role: 'EDITOR' }),
  )
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(async (fns: unknown) => {
    if (Array.isArray(fns)) return Promise.all(fns as Promise<unknown>[])
    if (typeof fns === 'function')
      return (fns as (tx: unknown) => unknown)({
        favoritePage: { aggregate, upsert, deleteMany, updateMany: favUpdateMany },
        workspaceMember: { findUnique: memberFindUnique },
      })
    return fns
  })
  const __mocks = { deleteMany, aggregate, upsert, favFindMany, favUpdateMany, pageFindFirst, memberFindUnique, $transaction }
  return {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    favoritePage: { aggregate, upsert, deleteMany, findMany: favFindMany, updateMany: favUpdateMany },
    $transaction,
    __mocks,
  } as unknown as PrismaClient & { __mocks: typeof __mocks }
}

describe('FavoriteService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let svc: FavoriteService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    svc = new FavoriteService(mockPrisma)
  })

  it('add calls domain.addFavorite (page.findFirst + $transaction + favoritePage.upsert)', async () => {
    await svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
    expect(mockPrisma.__mocks.pageFindFirst).toHaveBeenCalled()
    expect(mockPrisma.__mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'u1', pageId: 'p1' }) }),
    )
  })

  it('remove calls favoritePage.deleteMany and returns { count: 1 }', async () => {
    const result = await svc.remove({ userId: 'u1', pageId: 'p1' })
    expect(mockPrisma.__mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', pageId: 'p1' },
    })
    expect(result).toEqual({ count: 1 })
  })

  it('reorder calls $transaction for updateMany batch', async () => {
    await svc.reorder({ userId: 'u1', workspaceId: 'w1', orderedIds: ['p1', 'p2'] })
    expect(mockPrisma.__mocks.$transaction).toHaveBeenCalled()
  })

  it('list uses direct Prisma favoritePage.findMany (does not touch page.findFirst)', async () => {
    mockPrisma.__mocks.favFindMany.mockResolvedValue([])
    await svc.list({ userId: 'u1' })
    expect(mockPrisma.__mocks.favFindMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.pageFindFirst).not.toHaveBeenCalled()
  })
})
