import { Injectable, Inject } from '@nestjs/common'
import type { Domain } from '@repo/domain'

import { DOMAIN } from '../../../infra/domain/domain.providers.js'
import { KanbanGateway } from './kanban-gateway.service.js'
import { MarkdownParser } from './markdown-parser.service.js'

type Board = { boardPageId?: string | null }

@Injectable()
export class KanbanWriteService {
  constructor(
    private readonly gateway: KanbanGateway,
    private readonly parser: MarkdownParser,
    @Inject(DOMAIN) private readonly domain: Domain,
  ) {}

  async createTask(
    userId: string,
    ws: string,
    a: Board & {
      title: string
      status?: string
      type?: string
      priority?: string
      sprint?: string
      assignees?: string[]
      dueDate?: Date
    },
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const columnId = a.status ? await this.gateway.resolveColumnByStatus(board, a.status) : undefined
    const typeId = a.type ? await this.gateway.resolveTypeByName(board, a.type) : undefined
    const priorityId = a.priority ? await this.gateway.resolvePriorityByName(board, a.priority) : undefined
    const sprintId = a.sprint
      ? ((await this.gateway.resolveSprintTarget(board, a.sprint)) ?? undefined)
      : undefined
    const task = await this.gateway.run(() =>
      this.domain.kanban.createTask(userId, {
        pageId: board,
        title: a.title,
        columnId,
        typeId,
        priorityId,
        sprintId,
      }),
    )
    if (a.assignees?.length) {
      const userIds = [...new Set(a.assignees.map((x) => this.gateway.resolveAssignee(userId, x)))]
      await this.gateway.run(() =>
        this.domain.kanban.setTaskAssignees(userId, { pageId: board, id: task.id, userIds }),
      )
    }
    if (a.dueDate) {
      await this.gateway.run(() =>
        this.domain.kanban.updateTask(userId, { pageId: board, id: task.id, dueDate: a.dueDate }),
      )
    }
    return { taskId: task.id }
  }

  async moveTaskToStatus(userId: string, ws: string, a: Board & { taskId: string; status: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const targetColumnId = await this.gateway.resolveColumnByStatus(board, a.status)
    await this.gateway.run(() =>
      this.domain.kanban.moveTask(userId, {
        pageId: board,
        id: a.taskId,
        targetColumnId,
        beforeId: null,
        afterId: null,
      }),
    )
    return { ok: true as const }
  }

  async assignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const userIds = [...new Set([...(await this.gateway.currentAssigneeIds(a.taskId)), target])]
    await this.gateway.run(() =>
      this.domain.kanban.setTaskAssignees(userId, { pageId: board, id: a.taskId, userIds }),
    )
    return { ok: true as const }
  }

  async unassignTask(userId: string, ws: string, a: Board & { taskId: string; user: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const target = this.gateway.resolveAssignee(userId, a.user)
    const userIds = (await this.gateway.currentAssigneeIds(a.taskId)).filter((id) => id !== target)
    await this.gateway.run(() =>
      this.domain.kanban.setTaskAssignees(userId, { pageId: board, id: a.taskId, userIds }),
    )
    return { ok: true as const }
  }

  async setTaskDates(
    userId: string,
    ws: string,
    a: Board & { taskId: string; startDate?: Date; dueDate?: Date },
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() =>
      this.domain.kanban.updateTask(userId, {
        pageId: board,
        id: a.taskId,
        startDate: a.startDate,
        dueDate: a.dueDate,
      }),
    )
    return { ok: true as const }
  }

  async setTaskSprint(userId: string, ws: string, a: Board & { taskId: string; target: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprintId = await this.gateway.resolveSprintTarget(board, a.target)
    await this.gateway.run(() =>
      this.domain.kanban.updateTask(userId, { pageId: board, id: a.taskId, sprintId }),
    )
    return { ok: true as const }
  }

  async setTaskPriority(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const priorityId = await this.gateway.resolvePriorityByName(board, a.value)
    await this.gateway.run(() =>
      this.domain.kanban.updateTask(userId, { pageId: board, id: a.taskId, priorityId }),
    )
    return { ok: true as const }
  }

  async setTaskType(userId: string, ws: string, a: Board & { taskId: string; value: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const typeId = await this.gateway.resolveTypeByName(board, a.value)
    await this.gateway.run(() =>
      this.domain.kanban.updateTask(userId, { pageId: board, id: a.taskId, typeId }),
    )
    return { ok: true as const }
  }

  async cancelTask(userId: string, ws: string, a: Board & { taskId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const cancelColumnId = await this.gateway.findCancelColumn(board)
    if (cancelColumnId) {
      await this.gateway.run(() =>
        this.domain.kanban.moveTask(userId, {
          pageId: board,
          id: a.taskId,
          targetColumnId: cancelColumnId,
          beforeId: null,
          afterId: null,
        }),
      )
      return { ok: true as const, via: 'column' as const }
    }
    await this.gateway.run(() =>
      this.domain.kanban.archiveTask(userId, { pageId: board, id: a.taskId }),
    )
    return { ok: true as const, via: 'archive' as const }
  }

  async addTaskComment(userId: string, ws: string, a: Board & { taskId: string; markdown: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const content = this.parser.parse(a.markdown)
    const comment = await this.gateway.run(() =>
      this.domain.kanban.createTaskComment(userId, { pageId: board, taskId: a.taskId, content }),
    )
    return { commentId: comment.id }
  }

  async createSprint(
    userId: string,
    ws: string,
    a: Board & { name: string; description?: string; startDate?: Date; endDate?: Date },
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const sprint = await this.gateway.run(() =>
      this.domain.kanban.createSprint(userId, {
        pageId: board,
        name: a.name,
        description: a.description,
        startDate: a.startDate,
        endDate: a.endDate,
      }),
    )
    return { sprintId: sprint.id }
  }

  async startSprint(userId: string, ws: string, a: Board & { sprintId: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    await this.gateway.run(() =>
      this.domain.kanban.activateSprint(userId, { pageId: board, id: a.sprintId }),
    )
    return { ok: true as const }
  }

  async closeSprint(userId: string, ws: string, a: Board & { sprintId: string; moveUndoneTo?: string }) {
    const board = await this.gateway.resolveBoardPageId(userId, ws, a.boardPageId)
    const moveUndoneTo =
      a.moveUndoneTo !== undefined
        ? await this.gateway.resolveSprintTarget(board, a.moveUndoneTo)
        : null
    await this.gateway.run(() =>
      this.domain.kanban.completeSprint(userId, { pageId: board, id: a.sprintId, moveUndoneTo }),
    )
    return { ok: true as const }
  }
}
