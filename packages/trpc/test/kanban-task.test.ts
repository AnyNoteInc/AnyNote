import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'

import { taskRouter } from '../src/routers/kanban/task'
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

const pageRow = { id: PAGE_ID, workspaceId: WORKSPACE_ID, createdById: USER_ID }

describe('kanban.task.create', () => {
  it('picks first column by position when columnId is omitted; writes CREATED activity', async () => {
    const taskCreate = vi.fn().mockResolvedValue({ id: 'task-1', title: 'New task' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { create: taskCreate, findMany: vi.fn().mockResolvedValue([]) },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      kanbanColumn: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000c0', pageId: PAGE_ID, position: 1024 }),
      },
      kanbanType: {
        findFirst: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000d0', position: 1024 }),
      },
      kanbanPriority: {
        findFirst: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000e0', position: 1024 }),
      },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.create({ pageId: PAGE_ID, title: 'New task' })

    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageId: PAGE_ID,
          columnId: '00000000-0000-0000-0000-0000000000c0',
          typeId: '00000000-0000-0000-0000-0000000000d0',
          priorityId: '00000000-0000-0000-0000-0000000000e0',
          title: 'New task',
          createdById: USER_ID,
        }),
      }),
    )
    expect(activityCreate).toHaveBeenCalledWith({
      data: { taskId: 'task-1', actorId: USER_ID, type: 'CREATED', payload: undefined },
    })
    expect(result.id).toBe('task-1')
  })

  it('throws BAD_REQUEST when board has no columns', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      kanbanColumn: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(caller.create({ pageId: PAGE_ID, title: 'x' })).rejects.toThrow(/колонок/i)
  })
})

describe('kanban.task.update', () => {
  it('writes RENAMED activity when title changes', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1', title: 'New' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = { task: { update: taskUpdate }, taskActivity: { create: activityCreate } }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          title: 'Old',
          dueDate: null,
          startDate: null,
          typeId: null,
          priorityId: null,
          sprintId: null,
          parentId: null,
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.update({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1', title: 'New' })

    expect(activityCreate).toHaveBeenCalledWith({
      data: { taskId: '00000000-0000-0000-0000-0000000000a1', actorId: USER_ID, type: 'RENAMED', payload: undefined },
    })
  })

  it('writes DUE_DATE_CHANGED activity with from/to payload', async () => {
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { update: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1' }) },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          title: 'X',
          dueDate: new Date('2026-05-15'),
          startDate: null,
          typeId: null,
          priorityId: null,
          sprintId: null,
          parentId: null,
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const newDue = new Date('2026-05-20')
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.update({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1', dueDate: newDue })

    expect(activityCreate).toHaveBeenCalledWith({
      data: {
        taskId: '00000000-0000-0000-0000-0000000000a1',
        actorId: USER_ID,
        type: 'DUE_DATE_CHANGED',
        payload: { from: '2026-05-15T00:00:00.000Z', to: '2026-05-20T00:00:00.000Z' },
      },
    })
  })
})

describe('kanban.task.move', () => {
  it('updates columnId + position, writes MOVED, adds STATUS_CHANGED when kind differs', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = { task: { update: taskUpdate }, taskActivity: { create: activityCreate } }

    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          columnId: '00000000-0000-0000-0000-0000000000c1',
        }),
        findMany: vi.fn().mockResolvedValue([{ id: '00000000-0000-0000-0000-0000000000a2', position: 1024 }]),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: '00000000-0000-0000-0000-0000000000c1', title: 'Todo', kind: 'ACTIVE' },
          { id: '00000000-0000-0000-0000-0000000000c2', title: 'Done', kind: 'DONE' },
        ]),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.move({
      pageId: PAGE_ID,
      id: '00000000-0000-0000-0000-0000000000a1',
      targetColumnId: '00000000-0000-0000-0000-0000000000c2',
      beforeId: null,
      afterId: null,
    })

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-0000-0000-0000000000a1' },
        data: expect.objectContaining({ columnId: '00000000-0000-0000-0000-0000000000c2' }),
      }),
    )
    const activityCalls = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(activityCalls).toContain('MOVED')
    expect(activityCalls).toContain('STATUS_CHANGED')
  })

  it('does NOT add STATUS_CHANGED when source and target have same kind', async () => {
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { update: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1' }) },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          columnId: '00000000-0000-0000-0000-0000000000ca',
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      kanbanColumn: {
        findMany: vi.fn().mockResolvedValue([
          { id: '00000000-0000-0000-0000-0000000000ca', title: 'A', kind: 'ACTIVE' },
          { id: '00000000-0000-0000-0000-0000000000cb', title: 'B', kind: 'ACTIVE' },
        ]),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.move({
      pageId: PAGE_ID,
      id: '00000000-0000-0000-0000-0000000000a1',
      targetColumnId: '00000000-0000-0000-0000-0000000000cb',
      beforeId: null,
      afterId: null,
    })

    const types = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(types).toContain('MOVED')
    expect(types).not.toContain('STATUS_CHANGED')
  })
})

describe('kanban.task.setAssignees', () => {
  it('diffs against current: writes UNASSIGNED for removed, ASSIGNED for added', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      taskAssignee: { createMany, deleteMany },
      taskActivity: { create: activityCreate },
    }
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          assignees: [{ userId: '00000000-0000-0000-0000-0000000000b1' }],
        }),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(txClient)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.setAssignees({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1', userIds: ['00000000-0000-0000-0000-0000000000b2'] })

    expect(deleteMany).toHaveBeenCalledWith({
      where: { taskId: '00000000-0000-0000-0000-0000000000a1', userId: { in: ['00000000-0000-0000-0000-0000000000b1'] } },
    })
    expect(createMany).toHaveBeenCalledWith({
      data: [{ taskId: '00000000-0000-0000-0000-0000000000a1', userId: '00000000-0000-0000-0000-0000000000b2' }],
    })
    const types = activityCreate.mock.calls.map((c) => c[0].data.type)
    expect(types).toEqual(expect.arrayContaining(['UNASSIGNED', 'ASSIGNED']))
  })
})

describe('kanban.task.softDelete', () => {
  it('allows the task creator to soft-delete', async () => {
    const update = vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          createdById: USER_ID,
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-0000-0000-0000000000a1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('allows workspace OWNER to soft-delete someone else’s task', async () => {
    const update = vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-0000000000a1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          createdById: '00000000-0000-0000-0000-0000000000be',
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1' })

    expect(update).toHaveBeenCalled()
  })

  it('forbids a non-OWNER non-creator', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-0000-0000-0000000000a1',
          pageId: PAGE_ID,
          createdById: '00000000-0000-0000-0000-0000000000be',
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-0000-0000-0000000000a1' })).rejects.toThrow(/прав/i)
  })
})
