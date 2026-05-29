import { HttpException, Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { KanbanGateway } from './kanban-gateway.service.js'

export type TaskFilters = { sprint?: string; assignee?: string; status?: string; includeArchived?: boolean }

const TASK_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  startDate: true,
  archived: true,
  column: { select: { title: true, kind: true } },
  sprint: { select: { id: true, name: true } },
  type: { select: { title: true } },
  priority: { select: { title: true } },
  assignees: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
} as const

type TaskRow = {
  id: string
  title: string
  dueDate: Date | null
  startDate: Date | null
  archived: boolean
  column: { title: string; kind: string }
  sprint: { id: string; name: string } | null
  type: { title: string } | null
  priority: { title: string } | null
  assignees: { user: { id: string; firstName: string | null; lastName: string | null } }[]
}

function mapTask(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    status: t.column.title,
    statusKind: t.column.kind,
    sprint: t.sprint?.name ?? null,
    priority: t.priority?.title ?? null,
    type: t.type?.title ?? null,
    dueDate: t.dueDate,
    startDate: t.startDate,
    archived: t.archived,
    assignees: t.assignees.map((a) => ({
      userId: a.user.id,
      name: [a.user.firstName, a.user.lastName].filter(Boolean).join(' '),
    })),
  }
}

@Injectable()
export class KanbanReadService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly gateway: KanbanGateway,
  ) {}

  async listBoards(userId: string, workspaceId: string) {
    const rows = await this.prisma.page.findMany({
      where: {
        workspaceId,
        type: 'KANBAN',
        deletedAt: null,
        archived: false,
        workspace: { members: { some: { userId } } },
      },
      select: {
        id: true,
        title: true,
        icon: true,
        sprints: { where: { status: 'ACTIVE' }, select: { id: true, name: true }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })
    return {
      boards: rows.map((b) => ({
        boardPageId: b.id,
        title: b.title ?? '',
        icon: b.icon,
        activeSprint: b.sprints[0] ?? null,
      })),
    }
  }

  async listSprints(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprints = await this.prisma.sprint.findMany({
      where: { pageId: board },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    })
    return { boardPageId: board, sprints }
  }

  async getActiveSprint(userId: string, workspaceId: string, boardPageId?: string | null) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const activeSprint = await this.prisma.sprint.findFirst({
      where: { pageId: board, status: 'ACTIVE' },
      select: { id: true, name: true, status: true, startDate: true, endDate: true },
    })
    return { boardPageId: board, activeSprint }
  }

  async listTasks(
    userId: string,
    workspaceId: string,
    boardPageId: string | null | undefined,
    filters: TaskFilters,
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const sprintFilter =
      filters.sprint !== undefined
        ? { sprintId: await this.gateway.resolveSprintTarget(board, filters.sprint) }
        : {}
    const statusFilter =
      filters.status !== undefined
        ? { columnId: await this.gateway.resolveColumnByStatus(board, filters.status) }
        : {}
    const assigneeFilter =
      filters.assignee !== undefined
        ? { assignees: { some: { userId: this.gateway.resolveAssignee(userId, filters.assignee) } } }
        : {}
    const tasks = (await this.prisma.task.findMany({
      where: {
        pageId: board,
        deletedAt: null,
        ...(filters.includeArchived ? {} : { archived: false }),
        ...sprintFilter,
        ...statusFilter,
        ...assigneeFilter,
      },
      orderBy: [{ columnId: 'asc' }, { position: 'asc' }],
      take: 200,
      select: TASK_SELECT,
    })) as TaskRow[]
    return { boardPageId: board, tasks: tasks.map(mapTask) }
  }

  async getTask(
    userId: string,
    workspaceId: string,
    boardPageId: string | null | undefined,
    taskId: string,
  ) {
    const board = await this.gateway.resolveBoardPageId(userId, workspaceId, boardPageId)
    const task = (await this.prisma.task.findFirst({
      where: { id: taskId, pageId: board },
      select: TASK_SELECT,
    })) as TaskRow | null
    if (!task)
      throw new HttpException({ code: 'TASK_NOT_FOUND', message: `task ${taskId} not found on board` }, 404)
    const activity = await this.prisma.taskActivity.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        type: true,
        createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
    })
    return {
      boardPageId: board,
      task: mapTask(task),
      activity: activity.map((a) => ({
        type: a.type,
        createdAt: a.createdAt,
        actor: a.actor
          ? {
              userId: a.actor.id,
              name: [a.actor.firstName, a.actor.lastName].filter(Boolean).join(' '),
            }
          : null,
      })),
    }
  }
}
