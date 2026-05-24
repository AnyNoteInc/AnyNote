import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const PAGE_ID = '33333333-3333-3333-3333-333333333333'
const SHARE_ID = '44444444-4444-4444-4444-444444444444'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

const caller = createCallerFactory(pageShareRouter)

const ownedPage = { id: PAGE_ID, workspaceId: 'w1', createdById: USER_ID }
const userRow = { id: USER_ID, firstName: 'A', lastName: 'B', email: 'a@b.c', image: null }

describe('page.share.get (read-only) + ensure (lazy create)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('get returns canManage + existing share without creating', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: SHARE_ID, shareId: 'a'.repeat(64), access: 'RESTRICTED', linkRole: 'READER', users: [],
        })),
        create: vi.fn(),
      },
      user: { findUnique: vi.fn(async () => userRow) },
    } as never

    const res = await caller(ctx(prisma)).get({ pageId: PAGE_ID })
    expect(prisma.pageShare.create).not.toHaveBeenCalled()
    expect(res.canManage).toBe(true)
    expect(res.share?.shareId).toHaveLength(64)
  })

  it('get returns share: null when none exists (no creation on read)', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: { findUnique: vi.fn(async () => null), create: vi.fn() },
      user: { findUnique: vi.fn(async () => userRow) },
    } as never
    const res = await caller(ctx(prisma)).get({ pageId: PAGE_ID })
    expect(res.share).toBeNull()
    expect(prisma.pageShare.create).not.toHaveBeenCalled()
  })

  it('get forbids a non-owner non-admin member', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ({ ...ownedPage, createdById: 'someone-else' })) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'EDITOR' })) },
    } as never
    await expect(caller(ctx(prisma)).get({ pageId: PAGE_ID })).rejects.toThrow(/Недостаточно прав/)
  })

  it('ensure lazily creates a 64-char shareId', async () => {
    const created = { id: SHARE_ID, shareId: 'b'.repeat(64), access: 'RESTRICTED', linkRole: 'READER', users: [] }
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: { findUnique: vi.fn(async () => null), create: vi.fn(async () => created) },
    } as never
    const res = await caller(ctx(prisma)).ensure({ pageId: PAGE_ID })
    expect(prisma.pageShare.create).toHaveBeenCalledOnce()
    expect(prisma.pageShare.create.mock.calls[0][0].data.shareId).toHaveLength(64)
    expect(res.shareId).toHaveLength(64)
  })
})

describe('page.share mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  function manageablePrisma(extra: Record<string, unknown>) {
    return {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      ...extra,
    } as never
  }

  it('setAccess updates access + linkRole', async () => {
    const prisma = manageablePrisma({
      pageShare: {
        update: vi.fn(async () => ({ id: SHARE_ID, access: 'PUBLIC', linkRole: 'EDITOR' })),
      },
    })
    const res = await caller(ctx(prisma)).setAccess({ pageId: PAGE_ID, access: 'PUBLIC', linkRole: 'EDITOR' })
    expect(res.access).toBe('PUBLIC')
    expect(prisma.pageShare.update).toHaveBeenCalledWith({
      where: { pageId: PAGE_ID },
      data: { access: 'PUBLIC', linkRole: 'EDITOR' },
      select: { id: true, access: true, linkRole: true },
    })
  })

  it('addUser rejects an existing workspace member', async () => {
    const prisma = manageablePrisma({
      pageShare: { findUnique: vi.fn(async () => ({ id: SHARE_ID })) },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: 'OWNER' }) // assertCanManageShare
          .mockResolvedValueOnce({ role: 'VIEWER' }), // target already a member
      },
    })
    await expect(
      caller(ctx(prisma)).addUser({ pageId: PAGE_ID, userId: '55555555-5555-5555-5555-555555555555', role: 'READER' }),
    ).rejects.toThrow(/уже имеет доступ/)
  })

  it('removeUser deletes the grant', async () => {
    const prisma = manageablePrisma({
      pageShare: { findUnique: vi.fn(async () => ({ id: SHARE_ID })) },
      pageShareUser: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    })
    await caller(ctx(prisma)).removeUser({ pageId: PAGE_ID, userId: '55555555-5555-5555-5555-555555555555' })
    expect(prisma.pageShareUser.deleteMany).toHaveBeenCalledWith({
      where: { pageShareId: SHARE_ID, userId: '55555555-5555-5555-5555-555555555555' },
    })
  })
})
