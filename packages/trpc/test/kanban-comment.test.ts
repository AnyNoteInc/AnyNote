import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { commentRouter } from '../src/routers/kanban/comment'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const OTHER_USER = '00000000-0000-0000-0000-0000000000be'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002'
const PAGE_ID = '00000000-0000-0000-0000-000000000003'
const TASK_ID = '00000000-0000-0000-0000-0000000000a1'
const COMMENT_ID = '00000000-0000-0000-0000-0000000000f1'

function ctx(prisma: PrismaClient, userId = USER_ID) {
  return {
    prisma,
    user: {
      id: userId,
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

describe('kanban.comment.create', () => {
  it('inserts comment and writes COMMENTED activity', async () => {
    const commentCreate = vi.fn().mockResolvedValue({ id: COMMENT_ID })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      taskComment: { create: commentCreate },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ pageId: PAGE_ID }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(commentRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, taskId: TASK_ID, content: { text: 'hi' } })

    expect(commentCreate).toHaveBeenCalledWith({
      data: { taskId: TASK_ID, authorId: USER_ID, content: { text: 'hi' } },
    })
    expect(activityCreate).toHaveBeenCalledWith({
      data: {
        taskId: TASK_ID,
        actorId: USER_ID,
        type: 'COMMENTED',
        payload: { commentId: COMMENT_ID },
      },
    })
  })
})

describe('kanban.comment.delete', () => {
  it('forbids deletion by non-author non-OWNER', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      taskComment: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          authorId: OTHER_USER,
          taskId: TASK_ID,
          task: { pageId: PAGE_ID },
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(commentRouter)(ctx(prisma))
    await expect(
      caller.delete({ pageId: PAGE_ID, id: COMMENT_ID, taskId: TASK_ID }),
    ).rejects.toThrow(/прав/i)
  })

  it('allows OWNER to delete any comment (sets deletedAt)', async () => {
    const update = vi.fn().mockResolvedValue({})
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      taskComment: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          authorId: OTHER_USER,
          taskId: TASK_ID,
          task: { pageId: PAGE_ID },
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(commentRouter)(ctx(prisma))
    await caller.delete({ pageId: PAGE_ID, id: COMMENT_ID, taskId: TASK_ID })

    expect(update).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
      data: { deletedAt: expect.any(Date) },
    })
  })
})
