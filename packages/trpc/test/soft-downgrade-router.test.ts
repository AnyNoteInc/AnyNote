import { beforeEach, describe, expect, it, vi } from 'vitest'

const planMocks = vi.hoisted(() => ({
  requireWritableWorkspace: vi.fn(async () => undefined),
  getActivePlanForUser: vi.fn(),
}))

// Favorite writes delegate to the @repo/domain createDomain singleton (../src/domain).
const favoritesMock = vi.hoisted(() => ({
  add: vi.fn(async () => ({ userId: '', pageId: '', position: 0 })),
}))

// Page writes delegate to the domain.pages facade.
const pagesMock = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: '33333333-3333-3333-3333-333333333333' })),
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

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return {
    ...actual,
    prisma: {},
    enqueueOutboxEvent: vi.fn(async () => undefined),
  }
})

vi.mock('../src/helpers/plan', () => ({
  requireWritableWorkspace: planMocks.requireWritableWorkspace,
  getActivePlanForUser: planMocks.getActivePlanForUser,
  getWorkspaceFeatures: vi.fn(),
  getAvailableAiModels: vi.fn(async () => []),
}))
vi.mock('../src/domain', () => ({
  domain: {
    favorites: { add: favoritesMock.add },
    pages: pagesMock,
  },
}))

import type { PrismaClient } from '@repo/db'
import { PageType } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
const PAGE_ID = '33333333-3333-3333-3333-333333333333'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('soft-downgrade router guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    planMocks.requireWritableWorkspace.mockResolvedValue(undefined)
  })

  it('checks writable workspace before page.create writes', async () => {
    // assertWorkspaceMember is mocked; prisma needs workspaceMember for it (mock handles it)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(pageRouter)(baseContext(prisma))
    await caller.create({ workspaceId: WORKSPACE_ID, parentId: null, type: PageType.TEXT })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(pagesMock.create).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    )
  })

  it('stops page.create before writes when workspace is over plan limit', async () => {
    planMocks.requireWritableWorkspace.mockRejectedValueOnce(new Error('WORKSPACE_OVER_PLAN_LIMIT'))
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(pageRouter)(baseContext(prisma))
    await expect(
      caller.create({ workspaceId: WORKSPACE_ID, parentId: null, type: PageType.TEXT }),
    ).rejects.toThrow(/WORKSPACE_OVER_PLAN_LIMIT/)

    expect(pagesMock.create).not.toHaveBeenCalled()
  })

  it('checks writable workspace before favorite writes by page id', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn(async () => ({ id: PAGE_ID, workspaceId: WORKSPACE_ID })),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(pageRouter)(baseContext(prisma))
    await caller.addFavorite({ pageId: PAGE_ID })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(favoritesMock.add).toHaveBeenCalledWith(USER_ID, { pageId: PAGE_ID })
  })

  it('checks writable workspace before workspace.rename writes', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      workspace: { update: vi.fn(async () => ({ id: WORKSPACE_ID, name: 'Renamed' })) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(workspaceRouter)(baseContext(prisma))
    await caller.rename({ id: WORKSPACE_ID, name: 'Renamed' })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(prisma.workspace.update).toHaveBeenCalled()
  })

  it('saves the selected icon when renaming a page', async () => {
    pagesMock.rename.mockResolvedValueOnce({
      id: PAGE_ID,
      title: 'Renamed',
      icon: '🚀',
      updatedAt: new Date('2026-05-23T00:00:00Z'),
    })
    const prisma = {} as unknown as PrismaClient

    const caller = createCallerFactory(pageRouter)(baseContext(prisma))
    await caller.rename({ id: PAGE_ID, workspaceId: WORKSPACE_ID, title: 'Renamed', icon: '🚀' })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(pagesMock.rename).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ id: PAGE_ID, title: 'Renamed', icon: '🚀' }),
    )
  })

  it('blocks member invite on Personal plan', async () => {
    planMocks.getActivePlanForUser.mockResolvedValueOnce({
      plan: { slug: 'personal', name: 'Personal' },
    })
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      user: { findUnique: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCallerFactory(workspaceRouter)(baseContext(prisma))
    await expect(
      caller.inviteMember({
        workspaceId: WORKSPACE_ID,
        email: 'invitee@example.com',
        role: 'EDITOR',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(planMocks.requireWritableWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
})
