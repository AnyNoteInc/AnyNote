import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { FavoriteService } from './favorite.service.js'

describe('FavoriteService', () => {
  const favFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favAggregate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favUpsert = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favDeleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    favoritePage: { findMany: favFindMany, aggregate: favAggregate, upsert: favUpsert, deleteMany: favDeleteMany },
    page: { findUnique: pageFindUnique },
  } as unknown as PrismaClient
  let svc: FavoriteService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new FavoriteService(prisma)
  })

  it('lists favorites ordered by position', async () => {
    favFindMany.mockResolvedValue([
      { page: { id: 'p1', title: 'A', type: 'TEXT', icon: null, workspaceId: 'w1' } },
    ])
    const out = await svc.list({ userId: 'u1' })
    expect(out).toEqual([{ pageId: 'p1', title: 'A', type: 'TEXT', icon: null, workspaceId: 'w1' }])
  })

  it('add verifies the page is in the workspace and upserts at next position', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    favAggregate.mockResolvedValue({ _max: { position: 4 } })
    favUpsert.mockResolvedValue({})
    await svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
    expect(favUpsert).toHaveBeenCalledWith({
      where: { userId_pageId: { userId: 'u1', pageId: 'p1' } },
      create: { userId: 'u1', pageId: 'p1', position: 5 },
      update: {},
    })
  })

  it('add rejects a page from another workspace', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w-other' })
    await expect(svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })).rejects.toBeInstanceOf(PageNotFoundError)
  })

  it('remove deletes the favorite', async () => {
    favDeleteMany.mockResolvedValue({ count: 1 })
    const out = await svc.remove({ userId: 'u1', pageId: 'p1' })
    expect(out.count).toBe(1)
    expect(favDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', pageId: 'p1' } })
  })
})
