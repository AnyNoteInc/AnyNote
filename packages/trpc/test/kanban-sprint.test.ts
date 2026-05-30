import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

const kanbanMocks = vi.hoisted(() => ({
  createSprint: vi.fn(async () => ({ id: '00000000-0000-0000-0000-0000000000a1', pageId: 'p', name: 'S', status: 'PLANNED', position: 0 })),
  activateSprint: vi.fn(async () => ({ ok: true as const })),
  completeSprint: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('../src/domain', () => ({ domain: { kanban: kanbanMocks } }))

import type { PrismaClient } from '@repo/db'

import { sprintRouter } from '../src/routers/kanban/sprint'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const SPRINT_A = '00000000-0000-0000-0000-0000000000a1'
const SPRINT_B = '00000000-0000-0000-0000-0000000000a2'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: {
      id: USER_ID,
      email: 't@e.com',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  }
}

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.sprint.activate', () => {
  it('delegates to domainSvc.kanban.activateSprint', async () => {
    kanbanMocks.activateSprint.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    const result = await caller.activate({ pageId: PAGE_ID, id: SPRINT_B })

    expect(kanbanMocks.activateSprint).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ pageId: PAGE_ID, id: SPRINT_B }))
    expect(result.ok).toBe(true)
  })

  it('surfaces DomainError as TRPCError (CONFLICT) when activateSprint rejects', async () => {
    const { DomainError } = await import('@repo/domain')
    kanbanMocks.activateSprint.mockRejectedValueOnce(new DomainError('CONFLICT', 'Активный спринт уже существует — попробуйте ещё раз', 409))
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await expect(caller.activate({ pageId: PAGE_ID, id: SPRINT_A })).rejects.toThrow(/Активный/i)
  })
})

describe('kanban.sprint.create', () => {
  it('delegates to domainSvc.kanban.createSprint and returns sprint id', async () => {
    kanbanMocks.createSprint.mockResolvedValueOnce({ id: SPRINT_A, pageId: PAGE_ID, name: 'Sprint 2', status: 'PLANNED', position: 2048 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    const result = await caller.create({ pageId: PAGE_ID, name: 'Sprint 2' })

    expect(kanbanMocks.createSprint).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ pageId: PAGE_ID, name: 'Sprint 2' }))
    expect(result.id).toBe(SPRINT_A)
  })
})

describe('kanban.sprint.complete', () => {
  it('delegates to domainSvc.kanban.completeSprint with moveUndoneTo', async () => {
    const SPRINT_DEST = '00000000-0000-0000-0000-0000000000b2'
    kanbanMocks.completeSprint.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    const result = await caller.complete({ pageId: PAGE_ID, id: SPRINT_A, moveUndoneTo: SPRINT_DEST })

    expect(kanbanMocks.completeSprint).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      pageId: PAGE_ID,
      id: SPRINT_A,
      moveUndoneTo: SPRINT_DEST,
    }))
    expect(result.ok).toBe(true)
  })

  it('delegates with null moveUndoneTo (backlog)', async () => {
    kanbanMocks.completeSprint.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await caller.complete({ pageId: PAGE_ID, id: SPRINT_A, moveUndoneTo: null })

    expect(kanbanMocks.completeSprint).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ moveUndoneTo: null }))
  })
})

describe('kanban.sprint.update (direct prisma op — unchanged)', () => {
  it('updates sprint fields directly via prisma', async () => {
    const sprintUpdate = vi.fn().mockResolvedValue({ id: SPRINT_A })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      sprint: { update: sprintUpdate },
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await caller.update({ pageId: PAGE_ID, id: SPRINT_A, name: 'Renamed' })

    expect(sprintUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SPRINT_A, pageId: PAGE_ID }, data: expect.objectContaining({ name: 'Renamed' }) }),
    )
  })
})

describe('kanban.sprint.delete (direct prisma op — unchanged)', () => {
  it('deletes sprint via prisma.sprint.deleteMany', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      sprint: { deleteMany },
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    const result = await caller.delete({ pageId: PAGE_ID, id: SPRINT_A })

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: SPRINT_A, pageId: PAGE_ID } })
    expect(result.ok).toBe(true)
  })

  it('throws NOT_FOUND when sprint does not exist', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      sprint: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await expect(caller.delete({ pageId: PAGE_ID, id: SPRINT_A })).rejects.toThrow(/спринт/i)
  })
})
