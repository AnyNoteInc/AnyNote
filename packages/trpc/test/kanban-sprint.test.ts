import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

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
  it('demotes previous ACTIVE to PLANNED then activates target', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const update = vi.fn().mockResolvedValue({})
    const txClient = { sprint: { updateMany, update } }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await caller.activate({ pageId: PAGE_ID, id: SPRINT_B })

    expect(updateMany).toHaveBeenCalledWith({
      where: { pageId: PAGE_ID, status: 'ACTIVE', NOT: { id: SPRINT_B } },
      data: { status: 'PLANNED' },
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: SPRINT_B },
      data: { status: 'ACTIVE' },
    })
  })

  it('translates P2002 unique violation into CONFLICT', async () => {
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi.fn().mockRejectedValue(conflict),
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await expect(caller.activate({ pageId: PAGE_ID, id: SPRINT_A })).rejects.toThrow(/Активный/i)
  })
})

describe('kanban.sprint.create', () => {
  it('inserts at end position with PLANNED status', async () => {
    const create = vi.fn().mockResolvedValue({ id: SPRINT_A })
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      sprint: {
        findMany: vi.fn().mockResolvedValue([{ position: 1024 }]),
        create,
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(sprintRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, name: 'Sprint 2' })

    expect(create).toHaveBeenCalledWith({
      data: {
        pageId: PAGE_ID,
        name: 'Sprint 2',
        description: null,
        startDate: null,
        endDate: null,
        status: 'PLANNED',
        position: 2048,
      },
    })
  })
})

describe('kanban.sprint.complete', () => {
  const SPRINT_TARGET = '00000000-0000-0000-0000-0000000000b1'
  const SPRINT_DEST = '00000000-0000-0000-0000-0000000000b2'
  const OTHER_PAGE = '00000000-0000-0000-0000-0000000000c1'
  const COL_ACTIVE = '00000000-0000-0000-0000-0000000000d1'

  function buildPrismaWithColumns(opts: { destPageId?: string } = {}): {
    prisma: PrismaClient
    sprintUpdate: ReturnType<typeof vi.fn>
    taskUpdateMany: ReturnType<typeof vi.fn>
  } {
    const destPageId = opts.destPageId ?? PAGE_ID
    const sprintUpdate = vi.fn().mockResolvedValue({})
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const txClient = {
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([{ id: COL_ACTIVE, kind: 'ACTIVE' }]),
      },
      sprint: {
        findUnique: vi
          .fn()
          .mockImplementation(({ where: { id } }: { where: { id: string } }) => {
            if (id === SPRINT_TARGET) return Promise.resolve({ id, pageId: PAGE_ID })
            if (id === SPRINT_DEST) return Promise.resolve({ id, pageId: destPageId })
            return Promise.resolve(null)
          }),
        update: sprintUpdate,
      },
      task: { updateMany: taskUpdateMany },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient
    return { prisma, sprintUpdate, taskUpdateMany }
  }

  it('moves undone tasks (ACTIVE-kind columns) to destination sprint and flips status', async () => {
    const { prisma, sprintUpdate, taskUpdateMany } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await caller.complete({
      pageId: PAGE_ID,
      id: SPRINT_TARGET,
      moveUndoneTo: SPRINT_DEST,
    })

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { sprintId: SPRINT_TARGET, columnId: { in: [COL_ACTIVE] } },
      data: { sprintId: SPRINT_DEST, sprintPosition: null },
    })
    expect(sprintUpdate).toHaveBeenCalledWith({
      where: { id: SPRINT_TARGET },
      data: { status: 'COMPLETED' },
    })
  })

  it('moves undone tasks to backlog when moveUndoneTo is null', async () => {
    const { prisma, sprintUpdate, taskUpdateMany } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: null })

    expect(taskUpdateMany).toHaveBeenCalledWith({
      where: { sprintId: SPRINT_TARGET, columnId: { in: [COL_ACTIVE] } },
      data: { sprintId: null, sprintPosition: null },
    })
    expect(sprintUpdate).toHaveBeenCalledWith({
      where: { id: SPRINT_TARGET },
      data: { status: 'COMPLETED' },
    })
  })

  it('rejects moveUndoneTo pointing to a sprint on a different page', async () => {
    const { prisma, sprintUpdate, taskUpdateMany } = buildPrismaWithColumns({
      destPageId: OTHER_PAGE,
    })
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: SPRINT_DEST }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })

  it('rejects moveUndoneTo equal to the sprint being completed', async () => {
    const { prisma, taskUpdateMany, sprintUpdate } = buildPrismaWithColumns()
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: SPRINT_TARGET }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })

  it('rejects when source sprint does not exist', async () => {
    const sprintUpdate = vi.fn().mockResolvedValue({})
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const txClient = {
      kanbanColumn: { findMany: vi.fn().mockResolvedValue([{ id: COL_ACTIVE, kind: 'ACTIVE' }]) },
      sprint: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: sprintUpdate,
      },
      task: { updateMany: taskUpdateMany },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: null }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })

  it('rejects when source sprint belongs to a different page', async () => {
    const OTHER_PAGE_LOCAL = '00000000-0000-0000-0000-0000000000c2'
    const sprintUpdate = vi.fn().mockResolvedValue({})
    const taskUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const txClient = {
      kanbanColumn: { findMany: vi.fn().mockResolvedValue([{ id: COL_ACTIVE, kind: 'ACTIVE' }]) },
      sprint: {
        findUnique: vi
          .fn()
          .mockImplementation(({ where: { id } }: { where: { id: string } }) => {
            if (id === SPRINT_TARGET) return Promise.resolve({ id, pageId: OTHER_PAGE_LOCAL })
            return Promise.resolve(null)
          }),
        update: sprintUpdate,
      },
      task: { updateMany: taskUpdateMany },
    }
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue(pageRow),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ workspaceId: WORKSPACE_ID }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient
    const caller = createCallerFactory(sprintRouter)(ctx(prisma))

    await expect(
      caller.complete({ pageId: PAGE_ID, id: SPRINT_TARGET, moveUndoneTo: null }),
    ).rejects.toThrow(/спринт/i)
    expect(taskUpdateMany).not.toHaveBeenCalled()
    expect(sprintUpdate).not.toHaveBeenCalled()
  })
})
