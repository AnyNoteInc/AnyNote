import { describe, it, expect, vi } from 'vitest'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { FavoriteRepository } from '../../../src/favorites/repositories/favorites.repository.ts'

function makeUow(delegates: Record<string, Record<string, ReturnType<typeof vi.fn>>>) {
  const client = delegates as never
  const uow: UnitOfWork = {
    client: () => client,
    transaction: async (fn) => fn(),
  }
  return uow
}

describe('FavoriteRepository.findAccessiblePage', () => {
  it('maps the row to { id, workspaceId }', async () => {
    const findFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', title: 'X', type: 'TEXT' }))
    const uow = makeUow({ page: { findFirst } })
    const repo = new FavoriteRepository(uow)
    const result = await repo.findAccessiblePage('u1', 'p1')
    expect(result).toEqual({ id: 'p1', workspaceId: 'w1' })
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', workspace: { members: { some: { userId: 'u1' } } } },
      select: { id: true, workspaceId: true },
    })
  })

  it('returns null when the page is not found or inaccessible', async () => {
    const findFirst = vi.fn(async () => null)
    const uow = makeUow({ page: { findFirst } })
    const repo = new FavoriteRepository(uow)
    const result = await repo.findAccessiblePage('u1', 'p1')
    expect(result).toBeNull()
  })
})

describe('FavoriteRepository.maxFavoritePosition', () => {
  it('returns null when there are no favorites', async () => {
    const aggregate = vi.fn(async () => ({ _max: { position: null } }))
    const uow = makeUow({ favoritePage: { aggregate } })
    const repo = new FavoriteRepository(uow)
    expect(await repo.maxFavoritePosition('u1')).toBeNull()
  })

  it('returns the max position when favorites exist', async () => {
    const aggregate = vi.fn(async () => ({ _max: { position: 3 } }))
    const uow = makeUow({ favoritePage: { aggregate } })
    const repo = new FavoriteRepository(uow)
    expect(await repo.maxFavoritePosition('u1')).toBe(3)
  })
})

describe('FavoriteRepository.upsertFavorite', () => {
  it('maps the upserted row to a FavoritePageDto', async () => {
    const upsert = vi.fn(async () => ({ userId: 'u1', pageId: 'p1', position: 2 }))
    const uow = makeUow({ favoritePage: { upsert } })
    const repo = new FavoriteRepository(uow)
    const dto = await repo.upsertFavorite('u1', 'p1', 2)
    expect(dto).toEqual({ userId: 'u1', pageId: 'p1', position: 2 })
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_pageId: { userId: 'u1', pageId: 'p1' } },
      create: { userId: 'u1', pageId: 'p1', position: 2 },
      update: {},
    })
  })
})

describe('FavoriteRepository.removeFavorite', () => {
  it('calls deleteMany and returns the count', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }))
    const uow = makeUow({ favoritePage: { deleteMany } })
    const repo = new FavoriteRepository(uow)
    const result = await repo.removeFavorite('u1', 'p1')
    expect(result).toEqual({ count: 1 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', pageId: 'p1' } })
  })
})

describe('FavoriteRepository.reorderFavorites', () => {
  it('calls updateMany once per id with the correct 0-based index', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const uow = makeUow({ favoritePage: { updateMany } })
    const repo = new FavoriteRepository(uow)
    await repo.reorderFavorites('u1', 'w1', ['p1', 'p2'])
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'u1', pageId: 'p1', page: { workspaceId: 'w1' } },
      data: { position: 0 },
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'u1', pageId: 'p2', page: { workspaceId: 'w1' } },
      data: { position: 1 },
    })
  })
})
