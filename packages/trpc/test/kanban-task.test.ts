import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

const kanbanMocks = vi.hoisted(() => ({
  createTask: vi.fn(async () => ({ id: 'task-1', pageId: 'p', columnId: 'c', position: 0 })),
  updateTask: vi.fn(async () => ({ id: 'task-1', pageId: 'p' })),
  moveTask: vi.fn(async () => ({ id: 'task-1', pageId: 'p' })),
  setTaskAssignees: vi.fn(async () => ({ ok: true as const })),
  archiveTask: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('../src/domain', () => ({ domain: { kanban: kanbanMocks } }))

import type { PrismaClient } from '@repo/db'

import { taskRouter } from '../src/routers/kanban/task'
import { kanbanBus } from '../src/realtime/kanban-bus'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_USER = '00000000-0000-4000-8000-0000000000be'
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002'
const PAGE_ID = '00000000-0000-4000-8000-000000000003'
const TASK_MINE = '00000000-0000-4000-8000-0000000000a1'
const TASK_OTHER = '00000000-0000-4000-8000-0000000000a2'

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
  it('delegates to domainSvc.kanban.createTask and returns the task', async () => {
    kanbanMocks.createTask.mockResolvedValueOnce({ id: 'task-1', pageId: PAGE_ID, columnId: 'c1', position: 0 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.create({ pageId: PAGE_ID, title: 'New task' })

    expect(kanbanMocks.createTask).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ pageId: PAGE_ID, title: 'New task' }))
    expect(result.id).toBe('task-1')
  })

  it('delegates with sprintId when provided', async () => {
    const sprintId = '00000000-0000-4000-8000-0000000000f0'
    kanbanMocks.createTask.mockResolvedValueOnce({ id: 'task-2', pageId: PAGE_ID, columnId: 'c1', position: 0 })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.create({ pageId: PAGE_ID, title: 'Sprint task', sprintId })

    expect(kanbanMocks.createTask).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ sprintId }))
  })
})

describe('kanban.task.update', () => {
  it('delegates to domainSvc.kanban.updateTask', async () => {
    kanbanMocks.updateTask.mockResolvedValueOnce({ id: '00000000-0000-4000-8000-0000000000a1', pageId: PAGE_ID })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.update({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1', title: 'New' })

    expect(kanbanMocks.updateTask).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ id: '00000000-0000-4000-8000-0000000000a1', title: 'New' }))
    expect(result.id).toBe('00000000-0000-4000-8000-0000000000a1')
  })

  it('forwards actualDate to domainSvc.kanban.updateTask', async () => {
    kanbanMocks.updateTask.mockResolvedValueOnce({ id: '00000000-0000-4000-8000-0000000000a1', pageId: PAGE_ID })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const actual = new Date('2025-06-01T00:00:00.000Z')
    await caller.update({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1', actualDate: actual })
    expect(kanbanMocks.updateTask).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ id: '00000000-0000-4000-8000-0000000000a1', actualDate: actual }),
    )
  })
})

describe('kanban.task.move', () => {
  it('delegates to domainSvc.kanban.moveTask', async () => {
    kanbanMocks.moveTask.mockResolvedValueOnce({ id: '00000000-0000-4000-8000-0000000000a1', pageId: PAGE_ID })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.move({
      pageId: PAGE_ID,
      id: '00000000-0000-4000-8000-0000000000a1',
      targetColumnId: '00000000-0000-4000-8000-0000000000c2',
      beforeId: null,
      afterId: null,
    })

    expect(kanbanMocks.moveTask).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      id: '00000000-0000-4000-8000-0000000000a1',
      targetColumnId: '00000000-0000-4000-8000-0000000000c2',
    }))
  })
})

describe('kanban.task.setAssignees', () => {
  it('delegates to domainSvc.kanban.setTaskAssignees', async () => {
    kanbanMocks.setTaskAssignees.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.setAssignees({
      pageId: PAGE_ID,
      id: '00000000-0000-4000-8000-0000000000a1',
      participantIds: ['00000000-0000-4000-8000-0000000000b2'],
      userIdsToMirror: [],
    })

    expect(kanbanMocks.setTaskAssignees).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      id: '00000000-0000-4000-8000-0000000000a1',
      participantIds: ['00000000-0000-4000-8000-0000000000b2'],
      userIdsToMirror: [],
    }))
    expect(result.ok).toBe(true)
  })
})

describe('kanban.task.archive', () => {
  it('delegates to domainSvc.kanban.archiveTask', async () => {
    kanbanMocks.archiveTask.mockResolvedValueOnce({ ok: true as const })
    const prisma = {} as unknown as PrismaClient
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.archive({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' })

    expect(kanbanMocks.archiveTask).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ id: '00000000-0000-4000-8000-0000000000a1' }))
    expect(result.ok).toBe(true)
  })
})

describe('kanban.task.softDelete', () => {
  it('allows the task creator to soft-delete', async () => {
    const update = vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000a1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-0000000000a1',
          pageId: PAGE_ID,
          createdById: USER_ID,
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-4000-8000-0000000000a1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
  })

  it('allows workspace OWNER to soft-delete someone else’s task', async () => {
    const update = vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000a1' })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-0000000000a1',
          pageId: PAGE_ID,
          createdById: '00000000-0000-4000-8000-0000000000be',
        }),
        update,
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' })

    expect(update).toHaveBeenCalled()
  })

  it('forbids a non-OWNER non-creator', async () => {
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      task: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-0000000000a1',
          pageId: PAGE_ID,
          createdById: '00000000-0000-4000-8000-0000000000be',
        }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(caller.softDelete({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' })).rejects.toThrow(/прав/i)
  })
})

describe('kanban.task.bulkSoftDelete', () => {
  it('a non-owner non-creator only deletes their own tasks', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
      task: {
        findMany: vi.fn().mockResolvedValue([
          { id: TASK_MINE, createdById: USER_ID },
          { id: TASK_OTHER, createdById: OTHER_USER },
        ]),
        updateMany,
      },
    } as unknown as PrismaClient

    const emitSpy = vi.spyOn(kanbanBus, 'emit')
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.bulkSoftDelete({ pageId: PAGE_ID, ids: [TASK_MINE, TASK_OTHER] })

    expect(result).toEqual({ deletedIds: [TASK_MINE] })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [TASK_MINE] } },
        data: expect.objectContaining({ deletedAt: expect.any(Date), updatedById: USER_ID }),
      }),
    )
    expect(emitSpy).toHaveBeenCalledTimes(1)
    expect(emitSpy).toHaveBeenCalledWith(PAGE_ID, { kind: 'task.deleted', taskId: TASK_MINE })
    emitSpy.mockRestore()
  })

  it('an OWNER deletes every requested task regardless of creator', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
      task: {
        findMany: vi.fn().mockResolvedValue([
          { id: TASK_MINE, createdById: OTHER_USER },
          { id: TASK_OTHER, createdById: USER_ID },
        ]),
        updateMany,
      },
    } as unknown as PrismaClient

    const emitSpy = vi.spyOn(kanbanBus, 'emit')
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.bulkSoftDelete({ pageId: PAGE_ID, ids: [TASK_MINE, TASK_OTHER] })

    expect(result).toEqual({ deletedIds: [TASK_MINE, TASK_OTHER] })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [TASK_MINE, TASK_OTHER] } } }),
    )
    expect(emitSpy).toHaveBeenCalledTimes(2)
    expect(emitSpy).toHaveBeenCalledWith(PAGE_ID, { kind: 'task.deleted', taskId: TASK_MINE })
    expect(emitSpy).toHaveBeenCalledWith(PAGE_ID, { kind: 'task.deleted', taskId: TASK_OTHER })
    emitSpy.mockRestore()
  })

  it('deletes nothing and skips updateMany when no task is deletable', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const prisma = {
      page: { findFirst: vi.fn().mockResolvedValue(pageRow) },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) },
      task: {
        findMany: vi.fn().mockResolvedValue([{ id: TASK_OTHER, createdById: OTHER_USER }]),
        updateMany,
      },
    } as unknown as PrismaClient

    const emitSpy = vi.spyOn(kanbanBus, 'emit')
    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.bulkSoftDelete({ pageId: PAGE_ID, ids: [TASK_OTHER] })

    expect(result).toEqual({ deletedIds: [] })
    expect(updateMany).not.toHaveBeenCalled()
    expect(emitSpy).not.toHaveBeenCalled()
    emitSpy.mockRestore()
  })
})

describe('kanban.task.setLabels', () => {
  it('forbids a non-creator VIEWER member (FORBIDDEN)', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue({ ...pageRow, createdById: 'someone-else' }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(
      caller.setLabels({
        pageId: PAGE_ID,
        id: '00000000-0000-4000-8000-0000000000a1',
        labelIds: ['00000000-0000-4000-8000-0000000000d1'],
      }),
    ).rejects.toThrow(/прав/i)
  })
})

describe('kanban.task.unarchive', () => {
  it('forbids a non-creator VIEWER member (FORBIDDEN)', async () => {
    const prisma = {
      page: {
        findFirst: vi.fn().mockResolvedValue({ ...pageRow, createdById: 'someone-else' }),
      },
      workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER' }) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    await expect(
      caller.unarchive({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' }),
    ).rejects.toThrow(/прав/i)
  })

  it('sets archived=false and writes UNARCHIVED activity directly via prisma', async () => {
    const taskUpdate = vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000a1' })
    const activityCreate = vi.fn().mockResolvedValue({})
    const txClient = {
      task: { update: taskUpdate },
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

    const caller = createCallerFactory(taskRouter)(ctx(prisma))
    const result = await caller.unarchive({ pageId: PAGE_ID, id: '00000000-0000-4000-8000-0000000000a1' })

    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: '00000000-0000-4000-8000-0000000000a1' },
        data: expect.objectContaining({ archived: false }),
      }),
    )
    expect(activityCreate).toHaveBeenCalledWith({
      data: { taskId: '00000000-0000-4000-8000-0000000000a1', actorId: USER_ID, type: 'UNARCHIVED', payload: undefined },
    })
    expect(result.ok).toBe(true)
  })
})
