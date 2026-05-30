import { beforeEach, describe, expect, it, vi } from 'vitest'

const planMocks = vi.hoisted(() => ({
  requireWritableWorkspace: vi.fn(async () => undefined),
}))

const accessMocks = vi.hoisted(() => ({
  assertWorkspaceMember: vi.fn(async () => ({ role: 'MEMBER' })),
  assertPageAccess: vi.fn(async () => undefined),
  assertPageOwnership: vi.fn(async () => undefined),
}))

// Favorite writes now delegate to the @repo/domain createDomain singleton (../src/domain).
// Positioning/reorder logic is unit-tested in @repo/domain; here we assert the wiring.
const favoritesMock = vi.hoisted(() => ({
  add: vi.fn(async () => ({ userId: '', pageId: '', position: 0 })),
  reorder: vi.fn(async () => ({ ok: true as const })),
}))

// Page writes delegate to the domain.pages facade; internal linked-list logic is
// covered by @repo/domain pages tests. Here we assert delegation and guard calls only.
const pagesMock = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: '66666666-6666-6666-6666-666666666666' })),
  rename: vi.fn(async () => ({ id: '', title: null, icon: null, updatedAt: new Date() })),
  update: vi.fn(async () => ({ id: '', title: null, icon: null, updatedAt: new Date() })),
  softDelete: vi.fn(async () => ({ id: '' })),
  restore: vi.fn(async () => ({ id: '' })),
  hardDelete: vi.fn(async () => ({ id: '' })),
  emptyTrash: vi.fn(async () => ({ count: 0 })),
  move: vi.fn(async () => ({ id: '' })),
  duplicate: vi.fn(async () => ({ id: '' })),
  reorder: vi.fn(async () => ({ id: '' })),
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
vi.mock('../src/domain', () => ({
  domain: {
    favorites: { add: favoritesMock.add, reorder: favoritesMock.reorder },
    pages: pagesMock,
  },
}))

import type { PrismaClient } from '@repo/db'
import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

const WS_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const PAGE_A = '33333333-3333-3333-3333-333333333333'
const PAGE_B = '44444444-4444-4444-4444-444444444444'
const PAGE_C = '55555555-5555-5555-5555-555555555555'

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

describe('page.addFavorite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks writable workspace, then delegates to domain.favorites.add', async () => {
    accessMocks.assertPageAccess.mockResolvedValue({ id: PAGE_A, workspaceId: WS_ID, createdById: USER_ID })
    const prisma = { page: { findFirst: vi.fn(async () => ({ id: PAGE_A, workspaceId: WS_ID })) } }

    await caller(ctx(prisma)).addFavorite({ pageId: PAGE_A })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WS_ID)
    expect(favoritesMock.add).toHaveBeenCalledWith(USER_ID, { pageId: PAGE_A })
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

describe('page.create — delegation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('checks workspace membership + writable, then delegates to domain.pages.create', async () => {
    // assertWorkspaceMember is a mock; prisma only needs workspaceMember for it
    const prisma = {}

    await caller(ctx(prisma)).create({ workspaceId: WS_ID, parentId: null })

    expect(accessMocks.assertWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: USER_ID }) }),
      WS_ID,
    )
    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WS_ID)
    expect(pagesMock.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ workspaceId: WS_ID, parentId: null }),
    )
  })
})

// ── Tests: page.reorder ──────────────────────────────────────────────────────

describe('page.reorder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('looks up the page workspaceId, calls requireWritableWorkspace, then delegates to domain.pages.reorder', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn(async () => ({ workspaceId: WS_ID, deletedAt: null })),
      },
    }

    await caller(ctx(prisma)).reorder({
      pageId: PAGE_B,
      newParentId: null,
      newPrevPageId: PAGE_C,
    })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WS_ID)
    expect(pagesMock.reorder).toHaveBeenCalledWith(
      USER_ID,
      { pageId: PAGE_B, newParentId: null, newPrevPageId: PAGE_C },
    )
  })

  it('skips requireWritableWorkspace when the page is not found', async () => {
    // tRPC reorder: if page lookup returns null, requireWritableWorkspace is skipped
    const prisma = {
      page: { findFirst: vi.fn(async () => null) },
    }

    await caller(ctx(prisma)).reorder({
      pageId: PAGE_B,
      newParentId: null,
      newPrevPageId: null,
    })

    expect(planMocks.requireWritableWorkspace).not.toHaveBeenCalled()
    expect(pagesMock.reorder).toHaveBeenCalledWith(
      USER_ID,
      { pageId: PAGE_B, newParentId: null, newPrevPageId: null },
    )
  })
})

// ── Tests: page.reorderFavorites ─────────────────────────────────────────────

describe('page.reorderFavorites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('asserts workspace membership, then delegates to domain.favorites.reorder', async () => {
    const orderedIds = [PAGE_C, PAGE_A, PAGE_B]
    await caller(ctx({})).reorderFavorites({ workspaceId: WS_ID, orderedIds })

    expect(accessMocks.assertWorkspaceMember).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: USER_ID }) }),
      WS_ID,
    )
    expect(favoritesMock.reorder).toHaveBeenCalledWith(USER_ID, { workspaceId: WS_ID, orderedIds })
  })

  it('rejects non-member', async () => {
    accessMocks.assertWorkspaceMember.mockRejectedValueOnce(
      new Error('Not a workspace member'),
    )
    const prisma = { favoritePage: { updateMany: vi.fn() } }
    await expect(
      caller(ctx(prisma)).reorderFavorites({ workspaceId: WS_ID, orderedIds: [PAGE_A] }),
    ).rejects.toThrow()
  })
})
