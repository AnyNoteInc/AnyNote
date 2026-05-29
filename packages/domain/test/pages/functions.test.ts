import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { createPage, renamePage, updatePage, duplicatePage, movePage, reorderPage, softDeletePage, restorePage } from '../../src/pages/functions.ts'

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

function makeRenamePrisma(page: unknown = { id: 'p1', workspaceId: 'w1', createdById: 'u1' }) {
  const pageUpdate = vi.fn(async () => ({ id: 'p1', title: 'New', icon: null, updatedAt: new Date() }))
  const outboxCreate = vi.fn(async () => ({}))
  const pageFindFirst = vi.fn(async () => page)
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  const tx = { page: { update: pageUpdate }, outboxEvent: { create: outboxCreate } }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageUpdate, outboxCreate, pageFindFirst, memberFindUnique, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      pageFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain renamePage / updatePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renamePage updates title + updatedById and enqueues page.upserted', async () => {
    const prisma = makeRenamePrisma()
    const result = await renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New' })
    expect(result).toEqual(expect.objectContaining({ id: 'p1' }))
    const [, args] = prisma.__mocks.pageUpdate.mock.calls[0] ?? []
    void args
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ title: 'New', updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('renamePage sets icon only when provided', async () => {
    const prisma = makeRenamePrisma()
    await renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New', icon: null })
    const call = prisma.__mocks.pageUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toHaveProperty('icon', null)
  })

  it('renamePage throws FORBIDDEN when actor is neither creator nor OWNER', async () => {
    const prisma = makeRenamePrisma({ id: 'p1', workspaceId: 'w1', createdById: 'someone-else' })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('updatePage sets title/icon/type only when provided', async () => {
    const prisma = makeRenamePrisma()
    await updatePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', type: 'KANBAN' })
    const call = prisma.__mocks.pageUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ type: 'KANBAN', updatedById: 'u1' })
    expect(call.data).not.toHaveProperty('title')
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })
})

function makeDuplicatePrisma(original: Record<string, unknown>) {
  const copyCreate = vi.fn(async () => ({ id: 'copy-1' }))
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const txFindFirst = vi.fn(async () => null) // old next sibling lookup (none by default)
  // outer page.findFirst is assertPageAccess
  const accessFindFirst = vi.fn(async () => original)
  const tx = {
    page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: accessFindFirst },
    $transaction,
    __mocks: { copyCreate, pageUpdate, outboxCreate, txFindFirst, accessFindFirst, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      copyCreate: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      accessFindFirst: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain duplicatePage', () => {
  beforeEach(() => vi.clearAllMocks())

  const original = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    type: 'TEXT',
    title: 'Doc',
    icon: null,
    content: { type: 'doc' },
    contentYjs: new Uint8Array([1, 2, 3]),
    createdById: 'u1',
  }

  it('creates a copy after the original with "(копия)" suffix and copied content', async () => {
    const prisma = makeDuplicatePrisma(original)
    const result = await duplicatePage(prisma, 'u1', { pageId: 'p1' })
    expect(result).toEqual({ id: 'copy-1' })
    const call = prisma.__mocks.copyCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      workspaceId: 'w1',
      parentId: null,
      type: 'TEXT',
      title: 'Doc (копия)',
      prevPageId: 'p1',
      createdById: 'u1',
      updatedById: 'u1',
    })
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'copy-1' }),
      }),
    )
  })

  it('relinks the old next sibling to point at the copy', async () => {
    const prisma = makeDuplicatePrisma(original)
    prisma.__mocks.txFindFirst.mockResolvedValue({ id: 'next-1' })
    await duplicatePage(prisma, 'u1', { pageId: 'p1' })
    // detach old next to null, then reattach to copy
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: null },
    })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: 'copy-1' },
    })
  })

  it('throws NOT_FOUND when the source page is inaccessible', async () => {
    const prisma = makeDuplicatePrisma(original)
    prisma.__mocks.accessFindFirst.mockResolvedValue(null)
    await expect(duplicatePage(prisma, 'u1', { pageId: 'p1' })).rejects.toBeInstanceOf(DomainError)
  })
})

function makeMovePrisma(page: Record<string, unknown>) {
  const accessFindFirst = vi.fn(async () => page)
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  // tx.page.findFirst is used for: next sibling, ancestor walk, existingFirst
  const txFindFirst = vi.fn(async () => null)
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findFirst: txFindFirst, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: accessFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { accessFindFirst, memberFindUnique, txFindFirst, pageUpdate, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      accessFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain movePage', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, createdById: 'u1' }

  it('moves to a new parent and enqueues page.upserted', async () => {
    const prisma = makeMovePrisma(page)
    const result = await movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'parent-2', prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('repoints old next sibling to old prev on detach (exact pointer update)', async () => {
    const prisma = makeMovePrisma({ ...page, prevPageId: 'prev-0' })
    // old next sibling exists → should be repointed to page.prevPageId ('prev-0')
    prisma.__mocks.txFindFirst.mockImplementationOnce(async () => ({ id: 'next-1' })) // next sibling lookup
    // ancestor walk returns null (no cycle)
    prisma.__mocks.txFindFirst.mockImplementation(async () => null)
    await movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2' })
    // detach: set next-sibling.prevPageId = null first
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: null },
    })
    // reattach: set next-sibling.prevPageId = old page.prevPageId ('prev-0')
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: 'prev-0' },
    })
  })

  it('throws BAD_REQUEST when moving into own descendant (ancestor walk hits pageId)', async () => {
    const prisma = makeMovePrisma(page)
    // ancestor walk: newParentId 'child-of-p1' → its parent is 'p1' → cycle
    prisma.__mocks.txFindFirst.mockImplementation(async (arg: { where?: { id?: string } }) => {
      if (arg?.where?.id === 'child-of-p1') return { parentId: 'p1' }
      return null
    })
    await expect(
      movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'child-of-p1' }),
    ).rejects.toBeInstanceOf(DomainError)
    // tree-integrity: the cycle check throws before any pointer/outbox write
    expect(prisma.__mocks.pageUpdate).not.toHaveBeenCalled()
    expect(prisma.__mocks.outboxCreate).not.toHaveBeenCalled()
  })

  it('pushes the new parent existing head behind the moved page', async () => {
    const prisma = makeMovePrisma(page)
    // next-sibling + ancestor-walk lookups → null; existingFirst (head of new parent) → head-1
    prisma.__mocks.txFindFirst.mockImplementation(
      async (arg: { where?: { parentId?: string; prevPageId?: string | null } }) => {
        if (arg?.where?.parentId === 'parent-2' && arg?.where?.prevPageId === null) {
          return { id: 'head-1' }
        }
        return null
      },
    )
    await movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'head-1' },
      data: { prevPageId: 'p1' },
    })
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const prisma = makeMovePrisma({ ...page, createdById: 'other' })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      movePage(prisma, 'u1', { pageId: 'p1', newParentId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

function makeReorderPrisma(page: Record<string, unknown> | null) {
  const pageFindFirst = vi.fn(async () => page) // both the load AND the cycle BFS findMany sibling
  const pageFindMany = vi.fn(async () => [] as { id: string }[])
  const txFindFirst = vi.fn(async () => null)
  const txFindMany = vi.fn(async () => [] as { id: string }[])
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const memberFindUnique = vi.fn(async () => ({ role: 'EDITOR' as const }))
  const tx = {
    page: { findFirst: txFindFirst, findMany: txFindMany, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: pageFindFirst, findMany: pageFindMany },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageFindFirst, pageFindMany, txFindFirst, txFindMany, pageUpdate, outboxCreate, memberFindUnique, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      pageFindFirst: ReturnType<typeof vi.fn>
      pageFindMany: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      txFindMany: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain reorderPage', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null }

  it('throws BAD_REQUEST when newPrevPageId === pageId (self-reference)', async () => {
    const prisma = makeReorderPrisma(page)
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: null, newPrevPageId: 'p1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('throws NOT_FOUND when the page does not exist', async () => {
    const prisma = makeReorderPrisma(null)
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: null, newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('short-circuits (no transaction) when parent + prev are unchanged', async () => {
    const prisma = makeReorderPrisma(page)
    const result = await reorderPage(prisma, 'u1', {
      pageId: 'p1',
      newParentId: null,
      newPrevPageId: null,
    })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.$transaction).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST when newParentId is a descendant (BFS finds it)', async () => {
    const prisma = makeReorderPrisma(page)
    // first BFS layer: children of p1 include 'desc-1'
    prisma.__mocks.pageFindMany.mockResolvedValueOnce([{ id: 'desc-1' }])
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: 'desc-1', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('performs the 3-step relink and enqueues page.upserted when position changes', async () => {
    const prisma = makeReorderPrisma(page)
    const result = await reorderPage(prisma, 'u1', {
      pageId: 'p1',
      newParentId: 'parent-2',
      newPrevPageId: null,
    })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'parent-2', prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor is not a workspace member', async () => {
    const prisma = makeReorderPrisma(page)
    prisma.__mocks.pageFindFirst.mockResolvedValue(page) // page exists
    prisma.__mocks.memberFindUnique.mockResolvedValue(null) // not a member
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

function makeTrashPrisma(opts: {
  ownershipPage?: Record<string, unknown> | null
  txPage?: Record<string, unknown> | null
  parentPage?: Record<string, unknown> | null
} = {}) {
  const ownershipFindFirst = vi.fn(async () =>
    opts.ownershipPage === undefined
      ? { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, deletedAt: null, createdById: 'u1' }
      : opts.ownershipPage,
  )
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  // tx.page.findFirst: nextSibling / the restore re-find / parent check / existingFirst
  const txFindFirst = vi.fn(async () => null)
  const txFindMany = vi.fn(async () => [] as { id: string }[]) // descendant BFS: empty
  const txUpdate = vi.fn(async () => ({}))
  const txUpdateMany = vi.fn(async () => ({ count: 0 }))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findFirst: txFindFirst, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: ownershipFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { ownershipFindFirst, memberFindUnique, txFindFirst, txFindMany, txUpdate, txUpdateMany, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      ownershipFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      txFindMany: ReturnType<typeof vi.fn>
      txUpdate: ReturnType<typeof vi.fn>
      txUpdateMany: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain softDeletePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('soft-deletes the page (sets deletedAt) and enqueues page.deleted', async () => {
    const prisma = makeTrashPrisma()
    const result = await softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.deleted', aggregateId: 'p1' }),
      }),
    )
  })

  it('recursively soft-deletes descendants via BFS across MULTIPLE levels', async () => {
    const prisma = makeTrashPrisma()
    prisma.__mocks.txFindMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) // layer 1: direct children
      .mockResolvedValueOnce([{ id: 'gc1' }]) // layer 2: grandchild — proves the queue advances
      .mockResolvedValueOnce([]) // layer 3 empty → stop
    await softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(prisma.__mocks.txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c1', 'c2'] } } }),
    )
    // deep recursion: the grandchild layer is also soft-deleted (parentIds = childIds advanced)
    expect(prisma.__mocks.txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['gc1'] } } }),
    )
    expect(prisma.__mocks.txUpdateMany).toHaveBeenCalledTimes(2)
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const prisma = makeTrashPrisma({
      ownershipPage: { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, createdById: 'other' },
    })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('domain restorePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NOT_FOUND when the page is not in trash (deletedAt null)', async () => {
    const prisma = makeTrashPrisma()
    // tx re-find returns a non-deleted page → NOT_FOUND
    prisma.__mocks.txFindFirst.mockResolvedValueOnce({ id: 'p1', workspaceId: 'w1', parentId: null, deletedAt: null })
    await expect(
      restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('restores a trashed page and enqueues page.upserted', async () => {
    const prisma = makeTrashPrisma()
    // tx re-find returns a deleted page (in trash)
    prisma.__mocks.txFindFirst.mockResolvedValueOnce({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    })
    const result = await restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: null, prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
  })

  it('restores deleted descendants via BFS (inverted filter clears deletedAt)', async () => {
    const prisma = makeTrashPrisma()
    prisma.__mocks.txFindFirst.mockResolvedValueOnce({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    }) // re-find: page is in trash
    prisma.__mocks.txFindMany
      .mockResolvedValueOnce([{ id: 'dc1' }]) // layer 1: a deleted child
      .mockResolvedValueOnce([]) // stop
    await restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    // the cascade clears deletedAt on descendants (the delete↔restore filter inversion)
    expect(prisma.__mocks.txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['dc1'] } },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    )
  })

  it('moves the restored page to root when its parent is still deleted', async () => {
    const prisma = makeTrashPrisma()
    prisma.__mocks.txFindFirst
      .mockResolvedValueOnce({ id: 'p1', workspaceId: 'w1', parentId: 'par1', deletedAt: new Date() }) // re-find
      .mockResolvedValueOnce(null) // parent-check: par1 still deleted → fall back to root
    await restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(prisma.__mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: null, parentId: null }),
      }),
    )
  })
})
