import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import { FavoriteService } from './favorite.service.js'
import { makeFakeDomain } from './__testutils__/fake-domain.js'

// PRISMA mock is still needed only for the list() method (direct Prisma read).
function makeMockPrisma() {
  const favFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const __mocks = { favFindMany }
  return {
    favoritePage: { findMany: favFindMany },
    __mocks,
  } as unknown as PrismaClient & { __mocks: typeof __mocks }
}

// DOMAIN mock covers add/remove/reorder via the favorites facade.
function makeMockDomain() {
  const add = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ userId: 'u1', pageId: 'p1', position: 0 }),
  )
  const remove = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const reorder = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true }))
  const __mocks = { add, remove, reorder }
  return Object.assign(
    makeFakeDomain({ favorites: { add, remove, reorder } as unknown as Domain['favorites'] }),
    { __mocks },
  )
}

describe('FavoriteService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let mockDomain: ReturnType<typeof makeMockDomain>
  let svc: FavoriteService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    mockDomain = makeMockDomain()
    svc = new FavoriteService(mockPrisma, mockDomain)
  })

  it('add delegates to domain.favorites.add with correct userId and pageId', async () => {
    const result = await svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
    expect(mockDomain.__mocks.add).toHaveBeenCalledWith('u1', { pageId: 'p1' })
    expect(result).toEqual({ ok: true })
  })

  it('remove delegates to domain.favorites.remove and returns { count }', async () => {
    const result = await svc.remove({ userId: 'u1', pageId: 'p1' })
    expect(mockDomain.__mocks.remove).toHaveBeenCalledWith('u1', { pageId: 'p1' })
    expect(result).toEqual({ count: 1 })
  })

  it('reorder delegates to domain.favorites.reorder with workspaceId and orderedIds', async () => {
    const result = await svc.reorder({ userId: 'u1', workspaceId: 'w1', orderedIds: ['p1', 'p2'] })
    expect(mockDomain.__mocks.reorder).toHaveBeenCalledWith('u1', {
      workspaceId: 'w1',
      orderedIds: ['p1', 'p2'],
    })
    expect(result).toEqual({ ok: true })
  })

  it('list uses direct Prisma favoritePage.findMany (does not touch domain facade)', async () => {
    mockPrisma.__mocks.favFindMany.mockResolvedValue([])
    await svc.list({ userId: 'u1' })
    expect(mockPrisma.__mocks.favFindMany).toHaveBeenCalled()
    expect(mockDomain.__mocks.add).not.toHaveBeenCalled()
  })
})
