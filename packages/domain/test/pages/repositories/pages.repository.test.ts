import { describe, it, expect, vi, beforeEach } from 'vitest'

import { DomainError } from '../../../src/shared/errors.ts'
import { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import { makeDelegateUow as makeUow } from '../../helpers.ts'

// ── findAccessiblePage ────────────────────────────────────────────────────────

describe('PageRepository.findAccessiblePage', () => {
  it('maps the row to a full PageRowDto', async () => {
    const row = {
      id: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
      parentId: null,
      collectionId: null,
      prevPageId: null,
      title: 'Hello',
      icon: null,
      type: 'TEXT',
      content: null,
      contentYjs: null,
      archivedAt: null,
      deletedAt: null,
    }
    const findFirst = vi.fn(async () => row)
    const uow = makeUow({ page: { findFirst } })
    const repo = new PageRepository(uow)
    const result = await repo.findAccessiblePage('u1', 'p1')
    expect(result).toEqual(row)
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'p1',
          workspace: { members: { some: { userId: 'u1' } } },
        }),
      }),
    )
  })

  it('returns null when inaccessible', async () => {
    const findFirst = vi.fn(async () => null)
    const repo = new PageRepository(makeUow({ page: { findFirst } }))
    expect(await repo.findAccessiblePage('u1', 'p1')).toBeNull()
  })
})

// ── createPageTx ─────────────────────────────────────────────────────────────

describe('PageRepository.createPageTx — tail-insert + outbox', () => {
  const baseCreate = vi.fn(async () => ({ id: 'new-1', type: 'TEXT' }))
  const baseFindMany = vi.fn(async () => [] as { id: string; prevPageId: string | null }[])
  const baseUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))

  function makeRepo() {
    const uow = makeUow({
      page: { create: baseCreate, findMany: baseFindMany, update: baseUpdate },
      outboxEvent: { create: outboxCreate },
    })
    return new PageRepository(uow)
  }

  beforeEach(() => vi.clearAllMocks())

  it('creates the page and enqueues page.upserted', async () => {
    const repo = makeRepo()
    const onKanban = vi.fn(async () => undefined)
    const result = await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null }, onKanban)
    expect(result).toEqual({ id: 'new-1' })
    expect(baseCreate).toHaveBeenCalledOnce()
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateId: 'new-1',
          workspaceId: 'w1',
        }),
      }),
    )
  })

  it('links new page to the tail sibling', async () => {
    baseCreate.mockResolvedValue({ id: 'new-1', type: 'TEXT' })
    baseFindMany.mockResolvedValue([
      { id: 's1', prevPageId: null },
      { id: 's2', prevPageId: 's1' },
    ])
    const repo = makeRepo()
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null }, vi.fn())
    expect(baseUpdate).toHaveBeenCalledWith({ where: { id: 'new-1' }, data: { prevPageId: 's2' } })
  })

  it('does not link when there are no siblings', async () => {
    baseFindMany.mockResolvedValue([])
    const repo = makeRepo()
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null }, vi.fn())
    expect(baseUpdate).not.toHaveBeenCalled()
  })

  it('calls onKanban when type is KANBAN', async () => {
    baseCreate.mockResolvedValue({ id: 'kb-1', type: 'KANBAN' })
    const repo = makeRepo()
    const onKanban = vi.fn(async () => undefined)
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null, type: 'KANBAN' }, onKanban)
    expect(onKanban).toHaveBeenCalledWith('kb-1')
  })

  it('does NOT call onKanban for TEXT pages', async () => {
    baseCreate.mockResolvedValue({ id: 'tx-1', type: 'TEXT' })
    const repo = makeRepo()
    const onKanban = vi.fn(async () => undefined)
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null, type: 'TEXT' }, onKanban)
    expect(onKanban).not.toHaveBeenCalled()
  })
})

// ── duplicatePageTx ───────────────────────────────────────────────────────────

describe('PageRepository.duplicatePageTx — sibling re-link + (копия)', () => {
  beforeEach(() => vi.clearAllMocks())

  const original = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    prevPageId: null,
    type: 'TEXT' as const,
    title: 'Doc',
    icon: null,
    content: { type: 'doc' } as unknown,
    contentYjs: Buffer.from([1, 2, 3]),
    createdById: 'u1',
    deletedAt: null,
  }

  it('creates copy with "(копия)" suffix and sets prevPageId to original', async () => {
    const copyCreate = vi.fn(async () => ({ id: 'copy-1' }))
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const txFindFirst = vi.fn(async () => null) // no next sibling
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
        outboxEvent: { create: outboxCreate },
      }),
    )
    const result = await repo.duplicatePageTx('u1', original as never)
    expect(result).toEqual({ id: 'copy-1' })
    const call = copyCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      title: 'Doc (копия)',
      prevPageId: 'p1',
      workspaceId: 'w1',
      createdById: 'u1',
    })
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'copy-1' }),
      }),
    )
  })

  it('relinks the old next sibling: null → copy', async () => {
    const copyCreate = vi.fn(async () => ({ id: 'copy-1' }))
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const txFindFirst = vi.fn(async () => ({ id: 'next-1' })) // old next sibling
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
        outboxEvent: { create: outboxCreate },
      }),
    )
    await repo.duplicatePageTx('u1', original as never)
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'next-1' }, data: { prevPageId: null } })
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'next-1' }, data: { prevPageId: 'copy-1' } })
  })
})

// ── movePageTx ────────────────────────────────────────────────────────────────

describe('PageRepository.movePageTx — cycle-check + head-insert', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    prevPageId: null,
    type: 'TEXT' as const,
    title: null,
    icon: null,
    content: null,
    contentYjs: null,
    createdById: 'u1',
    deletedAt: null,
  }

  it('moves page and enqueues page.upserted', async () => {
    const txFindFirst = vi.fn(async () => null) // no next sibling, no ancestor, no existingFirst
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate },
      }),
    )
    const result = await repo.movePageTx('u1', page as never, { pageId: 'p1', newParentId: 'par2' })
    expect(result).toEqual({ id: 'p1' })
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'par2', prevPageId: null }),
      }),
    )
    expect(outboxCreate).toHaveBeenCalledOnce()
  })

  it('throws BAD_REQUEST when moving into own descendant', async () => {
    // ancestor walk: newParentId 'child-of-p1' → its parentId is 'p1' → cycle
    const txFindFirst = vi.fn(async (arg: { where?: { id?: string } }) => {
      if (arg?.where?.id === 'child-of-p1') return { parentId: 'p1' }
      return null
    })
    const pageUpdate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: vi.fn() },
      }),
    )
    await expect(
      repo.movePageTx('u1', { ...page, prevPageId: null } as never, {
        pageId: 'p1',
        newParentId: 'child-of-p1',
      }),
    ).rejects.toBeInstanceOf(DomainError)
    // The cycle fires AFTER detach step 1 (nextSibling lookup) but BEFORE the update
    // — pageUpdate is only called for nextSibling detach, not for the move itself
    expect(pageUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' } }),
    )
  })

  it('inserts moved page at head of new parent list', async () => {
    const txFindFirst = vi.fn(
      async (arg: { where?: { parentId?: string; prevPageId?: string | null } }) => {
        if (arg?.where?.parentId === 'par2' && arg?.where?.prevPageId === null) {
          return { id: 'head-1' }
        }
        return null
      },
    )
    const pageUpdate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: vi.fn() },
      }),
    )
    await repo.movePageTx('u1', page as never, { pageId: 'p1', newParentId: 'par2' })
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'head-1' }, data: { prevPageId: 'p1' } })
  })
})

// ── softDeletePageTx ──────────────────────────────────────────────────────────

describe('PageRepository.softDeletePageTx — recursive BFS soft-delete', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    prevPageId: null,
    type: 'TEXT' as const,
    title: null,
    icon: null,
    content: null,
    contentYjs: null,
    createdById: 'u1',
    deletedAt: null,
  }

  function makeTrashUow() {
    const txFindFirst = vi.fn(async () => null)
    const txFindMany = vi.fn(async () => [] as { id: string }[])
    const txUpdate = vi.fn(async () => ({}))
    const txUpdateMany = vi.fn(async () => ({ count: 0 }))
    const outboxCreate = vi.fn(async () => ({}))
    const uow = makeUow({
      page: { findFirst: txFindFirst, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany },
      outboxEvent: { create: outboxCreate },
    })
    return { uow, txFindFirst, txFindMany, txUpdate, txUpdateMany, outboxCreate }
  }

  it('soft-deletes the page and enqueues page.deleted', async () => {
    const { uow, txUpdate, outboxCreate } = makeTrashUow()
    const repo = new PageRepository(uow)
    const result = await repo.softDeletePageTx('u1', page as never, { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.deleted', aggregateId: 'p1' }),
      }),
    )
  })

  it('recursively soft-deletes descendants via BFS across multiple levels', async () => {
    const { uow, txFindMany, txUpdateMany } = makeTrashUow()
    txFindMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) // layer 1
      .mockResolvedValueOnce([{ id: 'gc1' }])              // layer 2
      .mockResolvedValueOnce([])                            // stop
    const repo = new PageRepository(uow)
    await repo.softDeletePageTx('u1', page as never, { id: 'p1', workspaceId: 'w1' })
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c1', 'c2'] } } }),
    )
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['gc1'] } } }),
    )
    expect(txUpdateMany).toHaveBeenCalledTimes(2)
  })
})

// ── restorePageTx ─────────────────────────────────────────────────────────────

describe('PageRepository.restorePageTx — in-tx notFound + recursive restore', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeRestoreUow(
    txFindFirst: ReturnType<typeof vi.fn>,
    txFindMany: ReturnType<typeof vi.fn>,
  ) {
    const txUpdate = vi.fn(async () => ({}))
    const txUpdateMany = vi.fn(async () => ({ count: 0 }))
    const outboxCreate = vi.fn(async () => ({}))
    const uow = makeUow({
      page: { findFirst: txFindFirst, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany },
      outboxEvent: { create: outboxCreate },
    })
    return { uow, txUpdate, txUpdateMany, outboxCreate }
  }

  it('throws NOT_FOUND when page is not in trash', async () => {
    const txFindFirst = vi.fn(async () => ({ id: 'p1', deletedAt: null, parentId: null }))
    const { uow } = makeRestoreUow(txFindFirst, vi.fn(async () => []))
    const repo = new PageRepository(uow)
    await expect(
      repo.restorePageTx('u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('restores the page and enqueues page.upserted', async () => {
    const txFindFirst = vi.fn(async () => ({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    }))
    const { uow, txUpdate, outboxCreate } = makeRestoreUow(txFindFirst, vi.fn(async () => []))
    const repo = new PageRepository(uow)
    const result = await repo.restorePageTx('u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: null, prevPageId: null }),
      }),
    )
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
  })

  it('falls back to root when parent is still deleted', async () => {
    const txFindFirst = vi.fn()
      .mockResolvedValueOnce({ id: 'p1', workspaceId: 'w1', parentId: 'par1', deletedAt: new Date() })
      .mockResolvedValueOnce(null) // parent check: par1 still deleted
    const { uow, txUpdate } = makeRestoreUow(txFindFirst, vi.fn(async () => []))
    const repo = new PageRepository(uow)
    await repo.restorePageTx('u1', { id: 'p1', workspaceId: 'w1' })
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: null, parentId: null }),
      }),
    )
  })

  it('recursively restores deleted descendants via BFS', async () => {
    const txFindFirst = vi.fn(async () => ({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    }))
    const txFindMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'dc1' }])
      .mockResolvedValueOnce([])
    const { uow, txUpdateMany } = makeRestoreUow(txFindFirst, txFindMany)
    const repo = new PageRepository(uow)
    await repo.restorePageTx('u1', { id: 'p1', workspaceId: 'w1' })
    expect(txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['dc1'] } },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    )
  })
})

// ── hardDeletePageTx ──────────────────────────────────────────────────────────

describe('PageRepository.hardDeletePageTx — in-tx notFound + cascade', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the page and enqueues page.deleted', async () => {
    const txFindFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', prevPageId: null }))
    const txUpdate = vi.fn(async () => ({}))
    const txDelete = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: txUpdate, delete: txDelete },
        outboxEvent: { create: outboxCreate },
      }),
    )
    const result = await repo.hardDeletePageTx({ id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.deleted', aggregateId: 'p1' }),
      }),
    )
  })

  it('throws NOT_FOUND when page does not exist', async () => {
    const txFindFirst = vi.fn(async () => null)
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: vi.fn(), delete: vi.fn() },
        outboxEvent: { create: vi.fn() },
      }),
    )
    await expect(repo.hardDeletePageTx({ id: 'p1', workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
  })
})

// ── emptyTrashTx ──────────────────────────────────────────────────────────────

describe('PageRepository.emptyTrashTx — per-page outbox', () => {
  it('deletes all trashed pages and enqueues page.deleted for each', async () => {
    const txFindMany = vi.fn(async () => [{ id: 't1' }, { id: 't2' }])
    const txDeleteMany = vi.fn(async () => ({ count: 2 }))
    const outboxCreate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findMany: txFindMany, deleteMany: txDeleteMany },
        outboxEvent: { create: outboxCreate },
      }),
    )
    const result = await repo.emptyTrashTx({ workspaceId: 'w1' })
    expect(result).toEqual({ count: 2 })
    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', deletedAt: { not: null } },
    })
    expect(outboxCreate).toHaveBeenCalledTimes(2)
  })
})

// ── reorderPageTx ─────────────────────────────────────────────────────────────

describe('PageRepository.reorderPageTx — 3-step linked-list relink', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    prevPageId: null,
    type: 'TEXT' as const,
    title: null,
    icon: null,
    content: null,
    contentYjs: null,
    createdById: 'u1',
    deletedAt: null,
  }

  it('runs the 3-step relink and enqueues page.upserted', async () => {
    const txFindFirst = vi.fn(async () => null)
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate },
      }),
    )
    const result = await repo.reorderPageTx('u1', page as never, {
      pageId: 'p1',
      newParentId: 'par2',
      newPrevPageId: null,
    })
    expect(result).toEqual({ id: 'p1' })
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'par2', prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(outboxCreate).toHaveBeenCalledOnce()
  })
})
