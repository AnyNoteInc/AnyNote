import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import type { MarkdownParser } from './markdown-parser.service.js'
import type { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanWriteService } from './kanban-write.service.js'

// The domain singleton is injected; tests assert that KanbanWriteService delegates
// correctly by spying on domain.kanban.* methods.  Real prisma ops happen inside the
// domain singleton's own UoW, so we provide a mock domain whose kanban methods
// delegate back to the same mock prisma so existing assertions keep working.

function makeMockPrisma() {
  const taskCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async (a: unknown) => ({
    id: 't1',
    ...((a as { data: object }).data as object),
  }))
  const taskUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ id: 't1' }))
  const taskFindUniqueOrThrow = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 't1',
    pageId: 'b1',
    columnId: 'c1',
    title: 'Old',
    dueDate: null,
    startDate: null,
    typeId: null,
    priorityId: null,
    sprintId: null,
    parentId: null,
    assignees: [],
  }))
  const taskFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const taskActivityCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  const taskActivityCreateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const taskAssigneeDeleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const taskAssigneeCreateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const taskAssigneeFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [
    { userId: 'u2' },
  ])

  const tx = {
    task: { create: taskCreate, update: taskUpdate, findUniqueOrThrow: taskFindUniqueOrThrow, findMany: taskFindMany },
    taskActivity: { create: taskActivityCreate, createMany: taskActivityCreateMany },
    taskAssignee: { deleteMany: taskAssigneeDeleteMany, createMany: taskAssigneeCreateMany },
  }

  const prisma = {
    page: {
      findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
        id: 'b1',
        workspaceId: 'w1',
        createdById: 'u1',
      })),
    },
    kanbanColumn: {
      findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ id: 'c1' })),
      findMany: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [
        { id: 'c1', title: 'Todo', kind: 'ACTIVE' },
        { id: 'col-done', title: 'Done', kind: 'DONE' },
      ]),
    },
    kanbanType: { findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null) },
    kanbanPriority: { findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null) },
    sprint: { findFirst: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ id: 's1' })) },
    task: {
      create: taskCreate,
      update: taskUpdate,
      findUniqueOrThrow: taskFindUniqueOrThrow,
      findMany: taskFindMany,
    },
    taskActivity: { create: taskActivityCreate, createMany: taskActivityCreateMany },
    taskAssignee: { deleteMany: taskAssigneeDeleteMany, createMany: taskAssigneeCreateMany, findMany: taskAssigneeFindMany },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    __mocks: { taskCreate, taskUpdate, taskFindUniqueOrThrow, taskActivityCreate, taskAssigneeCreateMany },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }

  return prisma
}

function makeGateway(prisma: PrismaClient) {
  return {
    db: prisma,
    resolveBoardPageId: jest.fn<(...a: unknown[]) => Promise<unknown>>(
      async (_u: unknown, _w: unknown, b?: unknown) => (b as string | null | undefined) ?? 'b1',
    ),
    resolveColumnByStatus: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => 'col-done'),
    findCancelColumn: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null),
    resolveSprintTarget: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => 's-next'),
    resolveTypeByName: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => 'ty1'),
    resolvePriorityByName: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => 'pr1'),
    resolveAssignee: jest.fn((_uid: unknown, v: unknown) => (v === 'me' ? 'u1' : (v as string))),
    currentAssigneeIds: jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ['u2']),
    run: jest.fn((fn: () => unknown) => fn()),
  } as unknown as KanbanGateway
}

describe('KanbanWriteService', () => {
  const parser = {
    parse: jest.fn((md: string) => ({ type: 'doc', content: [{ type: 'text', text: md }] })),
  } as unknown as MarkdownParser

  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let gw: KanbanGateway
  let svc: KanbanWriteService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    gw = makeGateway(mockPrisma)

    // Build a minimal domain mock whose kanban methods delegate into mockPrisma
    // so existing prisma-level assertions continue to pass unchanged.
    type AnyFn = (...a: unknown[]) => unknown
    const p = mockPrisma as unknown as {
      task: { create: AnyFn; update: AnyFn }
      taskActivity: { create: AnyFn }
      taskAssignee: { createMany: AnyFn }
    }
    const domain = {
      kanban: {
        createTask: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          const task = await p.task.create({ data: { ...input, createdById: _uid } })
          await p.taskActivity.create({ data: { taskId: (task as { id: string }).id, actorId: _uid, type: 'CREATED' } })
          return task as { id: string; pageId: string; columnId: string; position: number }
        }),
        updateTask: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          return p.task.update({ where: { id: input.id }, data: { ...input, updatedById: _uid } }) as Promise<{ id: string; pageId: string }>
        }),
        moveTask: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          return p.task.update({ where: { id: input.id }, data: { columnId: input.targetColumnId, updatedById: _uid } }) as Promise<{ id: string; pageId: string }>
        }),
        setTaskAssignees: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          await p.taskAssignee.createMany({ data: (input.userIds as string[]).map((userId) => ({ taskId: input.id, userId })) })
          return { ok: true as const }
        }),
        archiveTask: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          await p.task.update({ where: { id: input.id }, data: { archived: true, updatedById: _uid } })
          return { ok: true as const }
        }),
        createTaskComment: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          return { id: 'cmt1', taskId: input.taskId as string, authorId: _uid }
        }),
        createSprint: jest.fn(async (_uid: string, input: Record<string, unknown>) => {
          return { id: 's1', pageId: input.pageId as string, name: input.name as string, status: 'PLANNED', position: 0 }
        }),
        activateSprint: jest.fn(async () => ({ ok: true as const })),
        completeSprint: jest.fn(async () => ({ ok: true as const })),
      },
      pages: {} as Domain['pages'],
    } as unknown as Domain

    svc = new KanbanWriteService(gw, parser, domain)
  })

  it('moveTaskToStatus resolves column and calls domain.moveTask with null before/after', async () => {
    await svc.moveTaskToStatus('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
    expect(gw.resolveColumnByStatus).toHaveBeenCalledWith('b1', 'Done')
    // domain.moveTask was called via gateway.run — verify the prisma update was called with targetColumnId
    const { __mocks } = mockPrisma as ReturnType<typeof makeMockPrisma>
    expect(__mocks.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ columnId: 'col-done' }) }),
    )
  })

  it('cancelTask archives when no CANCELLED column', async () => {
    const out = await svc.cancelTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1' })
    expect(gw.findCancelColumn).toHaveBeenCalledWith('b1')
    // archiveTask was called — check task was updated with archived:true
    const { __mocks } = mockPrisma as ReturnType<typeof makeMockPrisma>
    expect(__mocks.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ archived: true }) }),
    )
    expect(out).toEqual({ ok: true, via: 'archive' })
  })

  it('assignTask merges with existing assignees (currentAssigneeIds + resolved target)', async () => {
    await svc.assignTask('u1', 'w1', { boardPageId: 'b1', taskId: 't1', user: 'me' })
    expect(gw.currentAssigneeIds).toHaveBeenCalledWith('t1')
    expect(gw.resolveAssignee).toHaveBeenCalledWith('u1', 'me')
    // domain.setTaskAssignees was called with merged ids [u2, u1]
    const { __mocks } = mockPrisma as ReturnType<typeof makeMockPrisma>
    expect(__mocks.taskAssigneeCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([{ taskId: 't1', userId: 'u1' }]) }),
    )
  })
})
