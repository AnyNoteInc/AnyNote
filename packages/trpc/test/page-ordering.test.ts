import { beforeEach, describe, expect, it, vi } from 'vitest'

const planMocks = vi.hoisted(() => ({
  requireWritableWorkspace: vi.fn(async () => undefined),
}))

const accessMocks = vi.hoisted(() => ({
  assertWorkspaceMember: vi.fn(async () => ({ role: 'MEMBER' })),
  assertPageAccess: vi.fn(async () => undefined),
  assertPageOwnership: vi.fn(async () => undefined),
}))

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('../src/helpers/plan', () => ({
  requireWritableWorkspace: planMocks.requireWritableWorkspace,
}))
vi.mock('../src/helpers/page-access', () => ({
  assertWorkspaceMember: accessMocks.assertWorkspaceMember,
  assertPageAccess: accessMocks.assertPageAccess,
  assertPageOwnership: accessMocks.assertPageOwnership,
}))

import type { PrismaClient } from '@repo/db'
import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

const WS_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const PAGE_A = '33333333-3333-3333-3333-333333333333'
const PAGE_B = '44444444-4444-4444-4444-444444444444'
const PAGE_NEW = '66666666-6666-6666-6666-666666666666'

function ctx(prisma: unknown) {
  return {
    prisma: prisma as PrismaClient,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

const caller = createCallerFactory(pageRouter)

// ── Tests: addFavorite position ──────────────────────────────────────────────

describe('page.addFavorite — appends at tail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets position = 0 when user has no existing favorites', async () => {
    accessMocks.assertPageAccess.mockResolvedValue({ id: PAGE_A, workspaceId: WS_ID, createdById: USER_ID })
    const upsert = vi.fn(async () => ({}))
    const txFavorite = {
      aggregate: vi.fn(async () => ({ _max: { position: null } })),
      upsert,
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ favoritePage: txFavorite }),
      ),
    }

    await caller(ctx(prisma)).addFavorite({ pageId: PAGE_A })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 0 }) }),
    )
  })

  it('sets position = max + 1 when favorites already exist', async () => {
    accessMocks.assertPageAccess.mockResolvedValue({ id: PAGE_A, workspaceId: WS_ID, createdById: USER_ID })
    const upsert = vi.fn(async () => ({}))
    const txFavorite = {
      aggregate: vi.fn(async () => ({ _max: { position: 4 } })),
      upsert,
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ favoritePage: txFavorite }),
      ),
    }

    await caller(ctx(prisma)).addFavorite({ pageId: PAGE_A })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 5 }) }),
    )
  })
})

// ── Tests: listFavorites order ───────────────────────────────────────────────

describe('page.listFavorites — ordered by position ASC', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes orderBy position asc to prisma', async () => {
    const findMany = vi.fn(async () => [])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      favoritePage: { findMany },
    }

    await caller(ctx(prisma)).listFavorites({ workspaceId: WS_ID })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { position: 'asc' } }),
    )
  })
})

describe('page.create — tail insert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets prevPageId = null when no siblings exist (first page)', async () => {
    const txPage = {
      create: vi.fn(async () => ({ id: PAGE_NEW, workspaceId: WS_ID, parentId: null, type: 'TEXT' })),
      findMany: vi.fn(async () => []), // no siblings
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          page: txPage,
          outboxEvent: { create: vi.fn(async () => ({})) },
          kanbanColumn: { createMany: vi.fn(async () => ({})) },
        }),
      ),
    }

    await caller(ctx(prisma)).create({ workspaceId: WS_ID, parentId: null })

    // Created with prevPageId: null (no siblings)
    expect(txPage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ prevPageId: null }) }),
    )
    // update should not be called when there are no siblings
    expect(txPage.update).not.toHaveBeenCalled()
  })

  it('sets new page prevPageId = tail sibling id when siblings exist', async () => {
    // Siblings: A (prevPageId=null) → B (prevPageId=A) — tail is B (not referenced as prevPageId by anyone)
    const siblings = [
      { id: PAGE_A, prevPageId: null },
      { id: PAGE_B, prevPageId: PAGE_A },
    ]
    const txPage = {
      create: vi.fn(async () => ({ id: PAGE_NEW, workspaceId: WS_ID, parentId: null, type: 'TEXT' })),
      findMany: vi.fn(async () => siblings),
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          page: txPage,
          outboxEvent: { create: vi.fn(async () => ({})) },
          kanbanColumn: { createMany: vi.fn(async () => ({})) },
        }),
      ),
    }

    await caller(ctx(prisma)).create({ workspaceId: WS_ID, parentId: null })

    // new page should get prevPageId = PAGE_B (the tail — not referenced as prevPageId by siblings)
    expect(txPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE_NEW },
        data: { prevPageId: PAGE_B },
      }),
    )
  })
})
