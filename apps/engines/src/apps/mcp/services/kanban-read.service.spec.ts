import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { KanbanGateway } from './kanban-gateway.service.js'
import { KanbanReadService } from './kanban-read.service.js'

describe('KanbanReadService', () => {
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const taskFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findMany: pageFindMany, findFirst: jest.fn(async () => ({ id: 'b1' })) },
    sprint: { findFirst: jest.fn(async () => ({ id: 's-active' })), findMany: jest.fn(async () => []) },
    task: { findMany: taskFindMany },
    kanbanColumn: { findMany: jest.fn(async () => [{ id: 'c1', title: 'Todo', kind: 'ACTIVE' }]) },
  } as unknown as PrismaClient
  let svc: KanbanReadService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new KanbanReadService(prisma, new KanbanGateway(prisma))
  })

  it('listBoards maps boards with active sprint', async () => {
    pageFindMany.mockResolvedValue([
      { id: 'b1', title: 'Dev', icon: null, sprints: [{ id: 's1', name: 'S1' }] },
    ])
    const out = await svc.listBoards('u1', 'w1')
    expect(out.boards).toEqual([
      { boardPageId: 'b1', title: 'Dev', icon: null, activeSprint: { id: 's1', name: 'S1' } },
    ])
  })

  it('listTasks maps tasks and resolves assignee "me"', async () => {
    pageFindMany.mockResolvedValue([{ id: 'b1', title: 'Dev' }])
    taskFindMany.mockResolvedValue([
      {
        id: 't1',
        title: 'Ship',
        dueDate: null,
        startDate: null,
        archived: false,
        column: { title: 'Todo', kind: 'ACTIVE' },
        sprint: { id: 's1', name: 'S1' },
        type: { title: 'Задача' },
        priority: { title: 'High' },
        assignees: [{ participant: { user: { id: 'u2', firstName: 'Ann', lastName: 'Lee' } } }],
      },
    ])
    const out = await svc.listTasks('u1', 'w1', undefined, { assignee: 'me' })
    expect(out.tasks[0]).toMatchObject({
      id: 't1',
      status: 'Todo',
      sprint: 'S1',
      assignees: [{ userId: 'u2', name: 'Ann Lee' }],
    })
    const where = (taskFindMany.mock.calls[0]![0] as { where: { assignees?: { some: { participant: { userId: string } } } } }).where
    expect(where.assignees?.some.participant.userId).toBe('u1')
  })
})
