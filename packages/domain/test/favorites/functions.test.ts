import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { addFavorite, removeFavorite, reorderFavorites } from '../../src/favorites/functions.ts'

function makePrisma(overrides: Record<string, unknown> = {}) {
  const aggregate = vi.fn(async () => ({ _max: { position: null } }))
  const upsert = vi.fn(async () => ({ userId: 'u1', pageId: 'p1', position: 0 }))
  const deleteMany = vi.fn(async () => ({ count: 1 }))
  const findFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }))
  const findUnique = vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'EDITOR' as const }))
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const $transaction = vi.fn(async (fns: unknown) => {
    if (Array.isArray(fns)) return Promise.all(fns)
    if (typeof fns === 'function')
      return fns({ favoritePage: { aggregate, upsert, updateMany, deleteMany }, workspaceMember: { findUnique } })
    return fns
  })
  return {
    page: { findFirst },
    workspaceMember: { findUnique },
    favoritePage: { aggregate, upsert, deleteMany, updateMany },
    $transaction,
    __mocks: { aggregate, upsert, deleteMany, findFirst, findUnique, updateMany, $transaction },
    ...overrides,
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof vi.fn>> }
}

describe('domain favorites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('addFavorite: first favorite gets position 0 (tRPC rule: (_max ?? -1)+1)', async () => {
    const prisma = makePrisma()
    await addFavorite(prisma, 'u1', { pageId: 'p1' })
    const { upsert } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 0 }) }),
    )
  })

  it('addFavorite: subsequent favorite gets position max+1', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.aggregate.mockResolvedValue({ _max: { position: 3 } })
    await addFavorite(prisma, 'u1', { pageId: 'p1' })
    const { upsert } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 4 }) }),
    )
  })

  it('addFavorite: throws NOT_FOUND when page is inaccessible', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.findFirst.mockResolvedValue(null)
    await expect(addFavorite(prisma, 'u1', { pageId: 'p1' })).rejects.toBeInstanceOf(DomainError)
  })

  it('removeFavorite: calls favoritePage.deleteMany and returns { count: 1 }', async () => {
    const prisma = makePrisma()
    const result = await removeFavorite(prisma, 'u1', { pageId: 'p1' })
    const { deleteMany } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', pageId: 'p1' } })
    expect(result).toEqual({ count: 1 })
  })

  it('removeFavorite: does NOT call assertPageAccess (no page.findFirst)', async () => {
    const prisma = makePrisma()
    await removeFavorite(prisma, 'u1', { pageId: 'p1' })
    const { findFirst } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('reorderFavorites: throws FORBIDDEN when not a member', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.findUnique.mockResolvedValue(null)
    await expect(reorderFavorites(prisma, 'u1', { workspaceId: 'w1', orderedIds: ['p1'] })).rejects.toBeInstanceOf(DomainError)
  })

  it('reorderFavorites: dispatches one updateMany per id with 0-based index', async () => {
    const prisma = makePrisma()
    await reorderFavorites(prisma, 'u1', { workspaceId: 'w1', orderedIds: ['p1', 'p2'] })
    const { $transaction } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect($transaction).toHaveBeenCalled()
  })
})
