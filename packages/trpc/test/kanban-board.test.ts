import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { boardRouter } from '../src/routers/kanban/board'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'

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

describe('kanban.board.getBoard', () => {
  it('returns columns, types, priorities, labels, sprints, tasks, members', async () => {
    const prisma = {
      page: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }),
      },
      kanbanColumn: { findMany: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Todo' }]) },
      kanbanType: { findMany: vi.fn().mockResolvedValue([{ id: 'tp1' }]) },
      kanbanPriority: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]) },
      kanbanLabel: { findMany: vi.fn().mockResolvedValue([]) },
      sprint: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([{ id: 't1', title: 'Hello' }]) },
      workspaceMember: {
        findMany: vi.fn().mockResolvedValue([{ userId: USER_ID, role: 'OWNER' }]),
      },
      workspaceParticipant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(boardRouter)(ctx(prisma))
    const result = await caller.getBoard({ pageId: PAGE_ID })

    expect(result.columns).toHaveLength(1)
    expect(result.tasks).toHaveLength(1)
    expect(result.members).toHaveLength(1)
    expect(result.participants).toHaveLength(0)
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageId: PAGE_ID, deletedAt: null, archived: false },
      }),
    )
  })

  it('throws NOT_FOUND when user is not a workspace member', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(boardRouter)(ctx(prisma))
    await expect(caller.getBoard({ pageId: PAGE_ID })).rejects.toThrow(/не найдена/i)
  })
})
