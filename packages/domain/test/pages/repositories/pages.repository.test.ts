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
  const outboxCreateMany = vi.fn(async () => ({ count: 2 }))

  function makeRepo() {
    const uow = makeUow({
      page: { create: baseCreate, findMany: baseFindMany, update: baseUpdate },
      outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
    })
    return new PageRepository(uow)
  }

  beforeEach(() => vi.clearAllMocks())

  function makeProvision() {
    return {
      onKanban: vi.fn(async () => undefined),
      onDatabase: vi.fn(async () => undefined),
    }
  }

  it('creates the page and enqueues page.upserted', async () => {
    const repo = makeRepo()
    const result = await repo.createPageTx(
      'u1',
      { workspaceId: 'w1', parentId: null },
      makeProvision(),
    )
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
    // The integration fan-out rows (webhook + telegram) ride one createMany.
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.created',
            aggregateType: 'webhook_event',
            aggregateId: 'new-1',
          }),
          expect.objectContaining({
            eventType: 'page.created',
            aggregateType: 'telegram_event',
            aggregateId: 'new-1',
          }),
        ],
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
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null }, makeProvision())
    expect(baseUpdate).toHaveBeenCalledWith({ where: { id: 'new-1' }, data: { prevPageId: 's2' } })
  })

  it('does not link when there are no siblings', async () => {
    baseFindMany.mockResolvedValue([])
    const repo = makeRepo()
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null }, makeProvision())
    expect(baseUpdate).not.toHaveBeenCalled()
  })

  it('calls provision.onKanban when type is KANBAN', async () => {
    baseCreate.mockResolvedValue({ id: 'kb-1', type: 'KANBAN' })
    const repo = makeRepo()
    const provision = makeProvision()
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null, type: 'KANBAN' }, provision)
    expect(provision.onKanban).toHaveBeenCalledWith('kb-1')
    expect(provision.onDatabase).not.toHaveBeenCalled()
  })

  it('calls provision.onDatabase with the workspaceId when type is DATABASE', async () => {
    baseCreate.mockResolvedValue({ id: 'db-1', type: 'DATABASE', workspaceId: 'w1' })
    const repo = makeRepo()
    const provision = makeProvision()
    await repo.createPageTx(
      'u1',
      { workspaceId: 'w1', parentId: null, type: 'DATABASE' },
      provision,
    )
    expect(provision.onDatabase).toHaveBeenCalledWith('db-1', 'w1')
    expect(provision.onKanban).not.toHaveBeenCalled()
  })

  it('does NOT call any provisioning for TEXT pages', async () => {
    baseCreate.mockResolvedValue({ id: 'tx-1', type: 'TEXT' })
    const repo = makeRepo()
    const provision = makeProvision()
    await repo.createPageTx('u1', { workspaceId: 'w1', parentId: null, type: 'TEXT' }, provision)
    expect(provision.onKanban).not.toHaveBeenCalled()
    expect(provision.onDatabase).not.toHaveBeenCalled()
  })
})

// ── updatePageTx ──────────────────────────────────────────────────────────────

describe('PageRepository.updatePageTx — appearance writes + properties_updated emission', () => {
  beforeEach(() => vi.clearAllMocks())

  const FILE_URL = '/api/files/8a33ee5e-95f1-4b53-8d12-0d5dbb1c1a2f'

  const CURRENT_ROW = {
    title: 'T',
    icon: null,
    type: 'TEXT',
    coverUrl: null,
    coverPreset: null,
  }

  function makeUpdateUow(current: Record<string, unknown> = CURRENT_ROW) {
    const pageFindUnique = vi.fn(async () => current)
    const pageUpdate = vi.fn(async () => ({
      id: 'p1',
      title: 'T',
      icon: null,
      updatedAt: new Date(),
    }))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const uow = makeUow({
      page: { findUnique: pageFindUnique, update: pageUpdate },
      outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
    })
    return { uow, pageUpdate, outboxCreate, outboxCreateMany }
  }

  it('writes cover fields and emits changed: [coverUrl, coverPreset]', async () => {
    // Current row has a preset — replacing it with an uploaded cover really
    // changes both fields.
    const { uow, pageUpdate, outboxCreate, outboxCreateMany } = makeUpdateUow({
      ...CURRENT_ROW,
      coverPreset: 'sunset',
    })
    const repo = new PageRepository(uow)
    await repo.updatePageTx('u1', {
      id: 'p1',
      workspaceId: 'w1',
      coverUrl: FILE_URL,
      coverPreset: null,
    })
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({
          coverUrl: FILE_URL,
          coverPreset: null,
          updatedById: 'u1',
        }),
      }),
    )
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.properties_updated',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
            payload: expect.objectContaining({
              hints: { changed: ['coverUrl', 'coverPreset'] },
            }),
          }),
          expect.objectContaining({
            eventType: 'page.properties_updated',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
            payload: expect.objectContaining({
              hints: { changed: ['coverUrl', 'coverPreset'] },
            }),
          }),
        ],
      }),
    )
  })

  it('emits changed: [coverPreset] when only the preset is set', async () => {
    const { uow, pageUpdate, outboxCreateMany } = makeUpdateUow()
    const repo = new PageRepository(uow)
    await repo.updatePageTx('u1', { id: 'p1', workspaceId: 'w1', coverPreset: 'ocean' })
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverPreset: 'ocean' }),
      }),
    )
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['coverPreset'] } }),
          }),
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['coverPreset'] } }),
          }),
        ],
      }),
    )
  })

  it('keeps changed: [title] for a title-only update (no cover keys, no cover writes)', async () => {
    const { uow, pageUpdate, outboxCreateMany } = makeUpdateUow()
    const repo = new PageRepository(uow)
    await repo.updatePageTx('u1', { id: 'p1', workspaceId: 'w1', title: 'New' })
    const dataArg = (pageUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data
    expect('coverUrl' in dataArg).toBe(false)
    expect('coverPreset' in dataArg).toBe(false)
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['title'] } }),
          }),
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['title'] } }),
          }),
        ],
      }),
    )
  })

  it('a no-op clear (already-null cover fields) emits NO properties_updated rows', async () => {
    const { uow, outboxCreate, outboxCreateMany } = makeUpdateUow() // current covers both null
    const repo = new PageRepository(uow)
    await repo.updatePageTx('u1', {
      id: 'p1',
      workspaceId: 'w1',
      coverUrl: null,
      coverPreset: null,
    })
    // Indexing row still rides (the row was touched) — but no integration fan-out.
    expect(outboxCreate).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).not.toHaveBeenCalled()
  })

  it('filters unchanged fields: same-title write with a real icon change emits changed: [icon]', async () => {
    const { uow, outboxCreateMany } = makeUpdateUow() // current title 'T', icon null
    const repo = new PageRepository(uow)
    await repo.updatePageTx('u1', { id: 'p1', workspaceId: 'w1', title: 'T', icon: '🔥' })
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['icon'] } }),
          }),
          expect.objectContaining({
            payload: expect.objectContaining({ hints: { changed: ['icon'] } }),
          }),
        ],
      }),
    )
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
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const txFindFirst = vi.fn(async () => null) // no next sibling
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
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
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.created',
            aggregateType: 'webhook_event',
            aggregateId: 'copy-1',
          }),
          expect.objectContaining({
            eventType: 'page.created',
            aggregateType: 'telegram_event',
            aggregateId: 'copy-1',
          }),
        ],
      }),
    )
  })

  it('relinks the old next sibling: null → copy', async () => {
    const copyCreate = vi.fn(async () => ({ id: 'copy-1' }))
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const txFindFirst = vi.fn(async () => ({ id: 'next-1' })) // old next sibling
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )
    await repo.duplicatePageTx('u1', original as never)
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'next-1' }, data: { prevPageId: null } })
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: 'copy-1' },
    })
  })
})

// ── movePageTx ────────────────────────────────────────────────────────────────

describe('PageRepository.movePageTx — cycle-check + head-insert', () => {
  beforeEach(() => vi.clearAllMocks())

  const moveQueryRaw = vi.fn(async (query: { strings: readonly string[] }) =>
    query.strings.join(' ').includes('FROM workspaces') ? [{ id: 'w1' }] : [{ id: 'p1' }],
  )
  const moveFindMany = vi.fn(async () => [{ id: 'p1' }])

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
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        $queryRaw: moveQueryRaw,
        page: { findMany: moveFindMany, findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      } as never),
    )
    const result = await repo.movePageTx('u1', page as never, { pageId: 'p1', newParentId: 'par2' })
    expect(result).toEqual({ id: 'p1' })
    expect(pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'par2', prevPageId: null }),
      }),
    )
    // Three outbox rows per move: the indexing event (create) + the
    // webhook_event/telegram_event fan-out pair (one createMany).
    expect(outboxCreate).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
          }),
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
          }),
        ],
      }),
    )
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
        $queryRaw: moveQueryRaw,
        page: { findMany: moveFindMany, findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: vi.fn(), createMany: vi.fn() },
      } as never),
    )
    await expect(
      repo.movePageTx('u1', { ...page, prevPageId: null } as never, {
        pageId: 'p1',
        newParentId: 'child-of-p1',
      }),
    ).rejects.toBeInstanceOf(DomainError)
    // The cycle fires AFTER detach step 1 (nextSibling lookup) but BEFORE the update
    // — pageUpdate is only called for nextSibling detach, not for the move itself
    expect(pageUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }))
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
        $queryRaw: moveQueryRaw,
        page: { findMany: moveFindMany, findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: vi.fn(), createMany: vi.fn() },
      } as never),
    )
    await repo.movePageTx('u1', page as never, { pageId: 'p1', newParentId: 'par2' })
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'head-1' }, data: { prevPageId: 'p1' } })
  })

  it('locks the workspace and every affected page in sorted order before updates', async () => {
    const events: string[] = []
    const queryRaw = vi.fn(async (query: { strings: readonly string[] }) => {
      const sql = query.strings.join(' ')
      events.push(sql.includes('FROM workspaces') ? 'workspace-lock' : 'page-lock')
      return sql.includes('FROM workspaces')
        ? [{ id: 'w1' }]
        : [{ id: 'head-z' }, { id: 'next-a' }, { id: 'p1' }, { id: 'par2' }]
    })
    const findMany = vi.fn(async () => {
      events.push('discover-pages')
      return [{ id: 'head-z' }, { id: 'next-a' }, { id: 'p1' }, { id: 'par2' }]
    })
    const findFirst = vi.fn(async () => null)
    const update = vi.fn(async () => {
      events.push('update')
      return {}
    })
    const repo = new PageRepository(
      makeUow({
        $queryRaw: queryRaw,
        page: { findMany, findFirst, update },
        outboxEvent: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      } as never),
    )

    await repo.movePageTx('u1', page as never, { pageId: 'p1', newParentId: 'par2' })

    expect(events.slice(0, 4)).toEqual([
      'workspace-lock',
      'discover-pages',
      'page-lock',
      'update',
    ])
    const pageLock = queryRaw.mock.calls[1]?.[0] as { strings: readonly string[] }
    expect(pageLock.strings.join(' ')).toMatch(/ORDER BY id\s+FOR UPDATE/)
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
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const uow = makeUow({
      page: {
        findFirst: txFindFirst,
        update: txUpdate,
        updateMany: txUpdateMany,
        findMany: txFindMany,
      },
      outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
    })
    return { uow, txFindFirst, txFindMany, txUpdate, txUpdateMany, outboxCreate, outboxCreateMany }
  }

  it('soft-deletes the page and enqueues page.deleted', async () => {
    const { uow, txUpdate, outboxCreate, outboxCreateMany } = makeTrashUow()
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
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.deleted',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
          }),
          expect.objectContaining({
            eventType: 'page.deleted',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
          }),
        ],
      }),
    )
  })

  it('recursively soft-deletes descendants via BFS across multiple levels', async () => {
    const { uow, txFindMany, txUpdateMany } = makeTrashUow()
    txFindMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) // layer 1
      .mockResolvedValueOnce([{ id: 'gc1' }]) // layer 2
      .mockResolvedValueOnce([]) // stop
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
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const uow = makeUow({
      page: {
        findFirst: txFindFirst,
        update: txUpdate,
        updateMany: txUpdateMany,
        findMany: txFindMany,
      },
      outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
    })
    return { uow, txUpdate, txUpdateMany, outboxCreate, outboxCreateMany }
  }

  it('throws NOT_FOUND when page is not in trash', async () => {
    const txFindFirst = vi.fn(async () => ({ id: 'p1', deletedAt: null, parentId: null }))
    const { uow } = makeRestoreUow(
      txFindFirst,
      vi.fn(async () => []),
    )
    const repo = new PageRepository(uow)
    await expect(repo.restorePageTx('u1', { id: 'p1', workspaceId: 'w1' })).rejects.toBeInstanceOf(
      DomainError,
    )
  })

  it('restores the page and enqueues page.upserted', async () => {
    const txFindFirst = vi.fn(async () => ({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    }))
    const { uow, txUpdate, outboxCreate, outboxCreateMany } = makeRestoreUow(
      txFindFirst,
      vi.fn(async () => []),
    )
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
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.undeleted',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
          }),
          expect.objectContaining({
            eventType: 'page.undeleted',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
          }),
        ],
      }),
    )
  })

  it('falls back to root when parent is still deleted', async () => {
    const txFindFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'p1',
        workspaceId: 'w1',
        parentId: 'par1',
        deletedAt: new Date(),
      })
      .mockResolvedValueOnce(null) // parent check: par1 still deleted
    const { uow, txUpdate } = makeRestoreUow(
      txFindFirst,
      vi.fn(async () => []),
    )
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
    const txFindMany = vi
      .fn()
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

  it('deletes the page and enqueues page.deleted (indexing only, trashed-only lookup)', async () => {
    const txFindFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', prevPageId: null }))
    const txUpdate = vi.fn(async () => ({}))
    const txDelete = vi.fn(async () => ({}))
    const chatDeleteMany = vi.fn(async () => ({ count: 0 }))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 0 }))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: txUpdate, delete: txDelete },
        chat: { deleteMany: chatDeleteMany },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )
    const result = await repo.hardDeletePageTx({ id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    // Hard-delete only operates on TRASHED pages — the lookup carries the guard.
    expect(txFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p1', deletedAt: { not: null } }),
      }),
    )
    // The page's hidden INLINE_AI ephemeral chats (Phase 9D) and PAGE chats
    // (page chat panel) are pruned — deleted, not orphaned.
    expect(chatDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { kind: 'INLINE_AI', inlineAiPageId: 'p1' },
          { kind: 'PAGE', pageId: 'p1' },
        ],
      },
    })
    expect(txDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    // Indexing row ONLY — no webhook_event/telegram_event rows (the page is
    // gone by fan-out time; soft-delete already emitted page.deleted).
    expect(outboxCreate).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).not.toHaveBeenCalled()
    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'page.deleted',
          aggregateType: 'page',
          aggregateId: 'p1',
        }),
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
    await expect(repo.hardDeletePageTx({ id: 'p1', workspaceId: 'w1' })).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})

// ── emptyTrashTx ──────────────────────────────────────────────────────────────

describe('PageRepository.emptyTrashTx — per-page outbox', () => {
  it('deletes all trashed pages and enqueues page.deleted for each', async () => {
    const txFindMany = vi.fn(async () => [{ id: 't1' }, { id: 't2' }])
    const txDeleteMany = vi.fn(async () => ({ count: 2 }))
    const chatDeleteMany = vi.fn(async () => ({ count: 0 }))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 0 }))
    const repo = new PageRepository(
      makeUow({
        page: { findMany: txFindMany, deleteMany: txDeleteMany },
        chat: { deleteMany: chatDeleteMany },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )
    const result = await repo.emptyTrashTx({ workspaceId: 'w1' })
    expect(result).toEqual({ count: 2 })
    // The trashed pages' hidden INLINE_AI ephemeral chats (Phase 9D) and PAGE
    // chats (page chat panel) are pruned.
    expect(chatDeleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { kind: 'INLINE_AI', inlineAiPageId: { in: ['t1', 't2'] } },
          { kind: 'PAGE', pageId: { in: ['t1', 't2'] } },
        ],
      },
    })
    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', deletedAt: { not: null } },
    })
    // ONE indexing row per page — no webhook_event/telegram_event rows (the
    // pages are gone by fan-out time; soft-delete already emitted page.deleted).
    expect(outboxCreate).toHaveBeenCalledTimes(2)
    expect(outboxCreateMany).not.toHaveBeenCalled()
    for (const id of ['t1', 't2']) {
      expect(outboxCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: 'page.deleted',
            aggregateType: 'page',
            aggregateId: id,
          }),
        }),
      )
    }
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
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        page: { findFirst: txFindFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
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
    // Three outbox rows per reorder: the indexing event (create) + the
    // webhook_event/telegram_event fan-out pair (one createMany).
    expect(outboxCreate).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
          }),
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
          }),
        ],
      }),
    )
  })
})

// ── moveToCollectionTx ────────────────────────────────────────────────────────

describe('PageRepository.moveToCollectionTx — detach + splice', () => {
  beforeEach(() => vi.clearAllMocks())

  it('(a) positioned splice: detaches from old list and re-points the insert point', async () => {
    // Moved page p1 currently sits in collection A after 'a1'.
    const findUnique = vi.fn(async () => ({ prevPageId: 'a1', parentId: null }))
    // findFirst is consulted twice: the old next-sibling (by prevPageId 'p1')
    // and the insert-point page (by prevPageId 'b1' in the target collection).
    const findFirst = vi.fn(
      async (arg: { where?: { prevPageId?: string | null; collectionId?: string | null } }) => {
        if (arg?.where?.prevPageId === 'p1') return { id: 'a-next' } // old next sibling
        if (arg?.where?.prevPageId === 'b1') return { id: 'b-next' } // insert-point page
        return null
      },
    )
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        page: { findUnique, findFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )

    const result = await repo.moveToCollectionTx('u1', 'p1', 'colB', 'w1', {
      newParentId: null,
      newPrevPageId: 'b1',
    })
    expect(result).toEqual({ id: 'p1' })

    // Step 0: lift the moved page out (free its UNIQUE prev_page_id slot).
    expect(pageUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { prevPageId: null } })
    // Step 1: old next sibling adopts the moved page's old prev ('a1').
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'a-next' },
      data: { prevPageId: 'a1' },
    })
    // Step 2: the page currently at the insert point re-points to us.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'b-next' },
      data: { prevPageId: 'p1' },
    })
    // Final: moved page lands in colB at the requested position.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { collectionId: 'colB', parentId: null, prevPageId: 'b1', updatedById: 'u1' },
    })
  })

  it('(b) head insert (no position): moved page becomes the new head and re-points the old head', async () => {
    const findUnique = vi.fn(async () => ({ prevPageId: 'a1', parentId: null }))
    const findFirst = vi.fn(async (arg: { where?: { prevPageId?: string | null } }) => {
      if (arg?.where?.prevPageId === 'p1') return null // no old next sibling
      if (arg?.where?.prevPageId === null) return { id: 'head-1' } // current head of target
      return null
    })
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        page: { findUnique, findFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )

    await repo.moveToCollectionTx('u1', 'p1', 'colB', 'w1') // no position arg

    // The current head of the target collection re-points after us.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'head-1' },
      data: { prevPageId: 'p1' },
    })
    // Final: moved page becomes the head (prevPageId null) of colB.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { collectionId: 'colB', parentId: null, prevPageId: null, updatedById: 'u1' },
    })
  })

  it('(c) emits page.upserted + page.moved integration fan-out with scope:collection', async () => {
    const findUnique = vi.fn(async () => ({ prevPageId: null, parentId: null }))
    const findFirst = vi.fn(async () => null)
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        page: { findUnique, findFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )

    await repo.moveToCollectionTx('u1', 'p1', 'colB', 'w1')

    expect(outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: 'p1',
          workspaceId: 'w1',
        }),
      }),
    )
    expect(outboxCreateMany).toHaveBeenCalledTimes(1)
    expect(outboxCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'webhook_event',
            aggregateId: 'p1',
            payload: expect.objectContaining({ hints: { scope: 'collection' } }),
          }),
          expect.objectContaining({
            eventType: 'page.moved',
            aggregateType: 'telegram_event',
            aggregateId: 'p1',
            payload: expect.objectContaining({ hints: { scope: 'collection' } }),
          }),
        ],
      }),
    )
  })

  it('(d) no position: preserves the current parentId (does not orphan to root)', async () => {
    // A nested page p1 currently sits under parent 'par1', after sibling 'x'.
    const findUnique = vi.fn(async () => ({ prevPageId: 'x', parentId: 'par1' }))
    // Head-insert lookup must scope by the PRESERVED parent ('par1'), not null.
    const findFirst = vi.fn(
      async (arg: { where?: { prevPageId?: string | null; parentId?: string | null } }) => {
        if (arg?.where?.prevPageId === 'p1') return null // no old next sibling
        if (arg?.where?.prevPageId === null && arg?.where?.parentId === 'par1') {
          return { id: 'head-1' } // current head of (colB, par1)
        }
        return null
      },
    )
    const pageUpdate = vi.fn(async () => ({}))
    const outboxCreate = vi.fn(async () => ({}))
    const outboxCreateMany = vi.fn(async () => ({ count: 2 }))
    const repo = new PageRepository(
      makeUow({
        page: { findUnique, findFirst, update: pageUpdate },
        outboxEvent: { create: outboxCreate, createMany: outboxCreateMany },
      }),
    )

    await repo.moveToCollectionTx('u1', 'p1', 'colB', 'w1') // no position arg

    // Head-insert lookup scoped by the preserved parent.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ parentId: 'par1', prevPageId: null }),
      }),
    )
    // Current head of (colB, par1) re-points after us.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'head-1' },
      data: { prevPageId: 'p1' },
    })
    // Final: parentId PRESERVED ('par1'), collection changed, head of its list.
    expect(pageUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { collectionId: 'colB', parentId: 'par1', prevPageId: null, updatedById: 'u1' },
    })
  })
})
