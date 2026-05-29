import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { KanbanReadService } from '../services/kanban-read.service.js'
import type { KanbanWriteService } from '../services/kanban-write.service.js'
import { KanbanTools } from './kanban.tools.js'

describe('KanbanTools', () => {
  const listBoards = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const moveTaskToStatus = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reads = { listBoards, listSprints: jest.fn(), getActiveSprint: jest.fn(), listTasks: jest.fn(), getTask: jest.fn() } as unknown as KanbanReadService
  const writes = { createTask: jest.fn(), moveTaskToStatus, assignTask: jest.fn(), unassignTask: jest.fn(), setTaskDates: jest.fn(), setTaskSprint: jest.fn(), setTaskPriority: jest.fn(), setTaskType: jest.fn(), cancelTask: jest.fn(), addTaskComment: jest.fn(), createSprint: jest.fn(), startSprint: jest.fn(), closeSprint: jest.fn() } as unknown as KanbanWriteService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: KanbanTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new KanbanTools(reads, writes)
  })

  it('listKanbanBoards delegates with caller id', async () => {
    listBoards.mockResolvedValue({ boards: [] })
    expect(await tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, req)).toEqual({ boards: [] })
    expect(listBoards).toHaveBeenCalledWith('u1', 'w1')
  })

  it('moveTaskToStatus delegates to the write service', async () => {
    moveTaskToStatus.mockResolvedValue({ ok: true })
    await tools.moveTaskToStatus({ workspaceId: 'w1', boardPageId: 'b1', taskId: 't1', status: 'Done' }, {} as never, req)
    expect(moveTaskToStatus).toHaveBeenCalledWith('u1', 'w1', { boardPageId: 'b1', taskId: 't1', status: 'Done' })
  })

  it('throws Unauthorized without auth', async () => {
    await expect(tools.listKanbanBoards({ workspaceId: 'w1' }, {} as never, { headers: {} } as AuthedRequest)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
