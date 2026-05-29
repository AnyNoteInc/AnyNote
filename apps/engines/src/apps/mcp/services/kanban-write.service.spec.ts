import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { MarkdownParser } from './markdown-parser.service.js'
import type { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanWriteService } from './kanban-write.service.js'

// We do NOT mock @repo/domain — real domain functions run against a mocked PrismaClient
// so we can assert the write service maps NL inputs → domain args correctly.

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
    svc = new KanbanWriteService(gw, parser)
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
