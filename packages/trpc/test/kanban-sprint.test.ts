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
