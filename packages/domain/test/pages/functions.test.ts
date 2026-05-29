import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { createPage } from '../../src/pages/functions.ts'

type TxMocks = {
  pageCreate: ReturnType<typeof vi.fn>
  pageFindMany: ReturnType<typeof vi.fn>
  pageUpdate: ReturnType<typeof vi.fn>
  outboxCreate: ReturnType<typeof vi.fn>
  kanbanColumnCreateMany: ReturnType<typeof vi.fn>
  kanbanTypeCreateMany: ReturnType<typeof vi.fn>
  kanbanPriorityCreateMany: ReturnType<typeof vi.fn>
}

function makePrisma(opts: { parent?: unknown } = {}) {
  const pageCreate = vi.fn(async () => ({ id: 'new-1', type: 'TEXT' }))
  const pageFindMany = vi.fn(async () => [] as { id: string; prevPageId: string | null }[])
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const kanbanColumnCreateMany = vi.fn(async () => ({ count: 3 }))
  const kanbanTypeCreateMany = vi.fn(async () => ({ count: 2 }))
  const kanbanPriorityCreateMany = vi.fn(async () => ({ count: 4 }))
  // outer prisma.page.findFirst is the parent lookup
  const pageFindFirst = vi.fn(async () => (opts.parent === undefined ? { id: 'parent-1' } : opts.parent))
  const tx = {
    page: { create: pageCreate, findMany: pageFindMany, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
    kanbanColumn: { createMany: kanbanColumnCreateMany },
    kanbanType: { createMany: kanbanTypeCreateMany },
    kanbanPriority: { createMany: kanbanPriorityCreateMany },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  const mocks: TxMocks = {
    pageCreate,
    pageFindMany,
    pageUpdate,
    outboxCreate,
    kanbanColumnCreateMany,
    kanbanTypeCreateMany,
    kanbanPriorityCreateMany,
  }
  return {
    page: { findFirst: pageFindFirst },
    $transaction,
    __mocks: { ...mocks, pageFindFirst, $transaction },
  } as unknown as PrismaClient & { __mocks: TxMocks & { pageFindFirst: ReturnType<typeof vi.fn>; $transaction: ReturnType<typeof vi.fn> } }
}

describe('domain createPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a page and enqueues page.upserted', async () => {
    const prisma = makePrisma()
    const result = await createPage(prisma, 'u1', {
      workspaceId: 'w1',
      parentId: null,
      title: 'Hello',
    })
    expect(result).toEqual({ id: 'new-1' })
    expect(prisma.__mocks.pageCreate).toHaveBeenCalledOnce()
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: 'new-1',
          workspaceId: 'w1',
        }),
      }),
    )
  })

  it('links the new page to the tail sibling (the one no sibling points at)', async () => {
    const prisma = makePrisma()
    // siblings: s1 is head (prevPageId null), s2 follows s1 → tail is s2
    prisma.__mocks.pageFindMany.mockResolvedValue([
      { id: 's1', prevPageId: null },
      { id: 's2', prevPageId: 's1' },
    ])
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'new-1' },
      data: { prevPageId: 's2' },
    })
  })

  it('does not link when there are no siblings (page is the head)', async () => {
    const prisma = makePrisma()
    prisma.__mocks.pageFindMany.mockResolvedValue([])
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T' })
    expect(prisma.__mocks.pageUpdate).not.toHaveBeenCalled()
  })

  it('seeds kanban defaults when type is KANBAN', async () => {
    const prisma = makePrisma()
    prisma.__mocks.pageCreate.mockResolvedValue({ id: 'kb-1', type: 'KANBAN' })
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'Board', type: 'KANBAN' })
    expect(prisma.__mocks.kanbanColumnCreateMany).toHaveBeenCalledOnce()
    expect(prisma.__mocks.kanbanTypeCreateMany).toHaveBeenCalledOnce()
    expect(prisma.__mocks.kanbanPriorityCreateMany).toHaveBeenCalledOnce()
  })

  it('does not seed kanban defaults for a TEXT page', async () => {
    const prisma = makePrisma()
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T', type: 'TEXT' })
    expect(prisma.__mocks.kanbanColumnCreateMany).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when parentId is given but the parent is missing', async () => {
    const prisma = makePrisma({ parent: null })
    await expect(
      createPage(prisma, 'u1', { workspaceId: 'w1', parentId: 'missing', title: 'T' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(prisma.__mocks.pageCreate).not.toHaveBeenCalled()
  })
})
