import { Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { KanbanReadService } from '../services/kanban-read.service.js'
import { KanbanWriteService } from '../services/kanban-write.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const WorkspaceOnly = z.object({ workspaceId: z.string().uuid() })
const BoardScoped = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional() })
const ListTasks = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprint: mcpInput(z.string().max(120).optional()),
  assignee: mcpInput(z.string().max(64).optional()),
  status: mcpInput(z.string().max(120).optional()),
  includeArchived: mcpInput(z.boolean().optional()),
})
const TaskRef = z.object({ workspaceId: z.string().uuid(), boardPageId: mcpNullableUuidOptional(), taskId: mcpUuid() })
const CreateTask = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  title: z.string().min(1).max(500),
  status: mcpInput(z.string().max(120).optional()),
  type: mcpInput(z.string().max(120).optional()),
  priority: mcpInput(z.string().max(120).optional()),
  sprint: mcpInput(z.string().max(120).optional()),
  assignees: mcpInput(z.array(z.string().min(1)).optional()),
  dueDate: mcpInput(z.coerce.date().optional()),
})
const MoveTask = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  status: z.string().min(1).max(120),
})
const Assign = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  user: z.string().min(1).max(64),
})
const SetDates = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  startDate: mcpInput(z.coerce.date().optional()),
  dueDate: mcpInput(z.coerce.date().optional()),
})
const SetSprint = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  target: z.string().min(1).max(120),
})
const SetField = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  value: z.string().min(1).max(120),
})
const AddComment = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  taskId: mcpUuid(),
  markdown: z.string().min(1).max(20_000),
})
const CreateSprint = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  name: z.string().min(1).max(120),
  description: mcpInput(z.string().max(2000).optional()),
  startDate: mcpInput(z.coerce.date().optional()),
  endDate: mcpInput(z.coerce.date().optional()),
})
const SprintRef = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprintId: mcpUuid(),
})
const CloseSprint = z.object({
  workspaceId: z.string().uuid(),
  boardPageId: mcpNullableUuidOptional(),
  sprintId: mcpUuid(),
  moveUndoneTo: mcpInput(z.string().max(120).optional()),
})

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class KanbanTools {
  constructor(private readonly reads: KanbanReadService, private readonly writes: KanbanWriteService) {}

  @Tool({
    name: 'listKanbanBoards',
    description:
      'Список Kanban-досок воркспейса (+активный спринт). Если доска одна — другие тулы можно звать без boardPageId. Параметр: workspaceId.',
    parameters: WorkspaceOnly,
  })
  async listKanbanBoards(a: z.infer<typeof WorkspaceOnly>, _c: Context, req: AuthedRequest) {
    return this.reads.listBoards(requireAuth(req).userId, a.workspaceId)
  }

  @Tool({
    name: 'listSprints',
    description: 'Спринты доски (id, name, status, даты). «какие у нас спринты». Параметры: workspaceId, boardPageId (опц.).',
    parameters: BoardScoped,
  })
  async listSprints(a: z.infer<typeof BoardScoped>, _c: Context, req: AuthedRequest) {
    return this.reads.listSprints(requireAuth(req).userId, a.workspaceId, a.boardPageId)
  }

  @Tool({
    name: 'getActiveSprint',
    description: 'Активный спринт доски (или null). «какой активный спринт». Параметры: workspaceId, boardPageId (опц.).',
    parameters: BoardScoped,
  })
  async getActiveSprint(a: z.infer<typeof BoardScoped>, _c: Context, req: AuthedRequest) {
    return this.reads.getActiveSprint(requireAuth(req).userId, a.workspaceId, a.boardPageId)
  }

  @Tool({
    name: 'listTasks',
    description:
      'Задачи доски. sprint:"current"|"backlog"|id|имя; assignee:"me"|userId; status:название колонки. «задачи в спринте/текущем/у меня/у {человека}». Параметры: workspaceId, boardPageId?, sprint?, assignee?, status?, includeArchived?.',
    parameters: ListTasks,
  })
  async listTasks(a: z.infer<typeof ListTasks>, _c: Context, req: AuthedRequest) {
    return this.reads.listTasks(requireAuth(req).userId, a.workspaceId, a.boardPageId, {
      sprint: a.sprint,
      assignee: a.assignee,
      status: a.status,
      includeArchived: a.includeArchived,
    })
  }

  @Tool({
    name: 'getTask',
    description: 'Детали задачи + последние события. Параметры: workspaceId, boardPageId?, taskId.',
    parameters: TaskRef,
  })
  async getTask(a: z.infer<typeof TaskRef>, _c: Context, req: AuthedRequest) {
    return this.reads.getTask(requireAuth(req).userId, a.workspaceId, a.boardPageId, a.taskId)
  }

  @Tool({
    name: 'createTask',
    description:
      'Создаёт задачу. status=колонка; sprint="current"|"next"|"backlog"|id|имя; assignees=["me"|userId]; type/priority=название. Требует подтверждения. Параметры: workspaceId, boardPageId?, title, status?, type?, priority?, sprint?, assignees?, dueDate?.',
    parameters: CreateTask,
  })
  async createTask(a: z.infer<typeof CreateTask>, _c: Context, req: AuthedRequest) {
    return this.writes.createTask(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      title: a.title,
      status: a.status,
      type: a.type,
      priority: a.priority,
      sprint: a.sprint,
      assignees: a.assignees,
      dueDate: a.dueDate,
    })
  }

  @Tool({
    name: 'moveTaskToStatus',
    description:
      'Перемещает задачу в колонку-статус по названию. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, status.',
    parameters: MoveTask,
  })
  async moveTaskToStatus(a: z.infer<typeof MoveTask>, _c: Context, req: AuthedRequest) {
    return this.writes.moveTaskToStatus(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      status: a.status,
    })
  }

  @Tool({
    name: 'assignTask',
    description:
      'Назначает участника ("me"|userId). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, user.',
    parameters: Assign,
  })
  async assignTask(a: z.infer<typeof Assign>, _c: Context, req: AuthedRequest) {
    return this.writes.assignTask(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      user: a.user,
    })
  }

  @Tool({
    name: 'unassignTask',
    description:
      'Снимает участника ("me"|userId). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, user.',
    parameters: Assign,
  })
  async unassignTask(a: z.infer<typeof Assign>, _c: Context, req: AuthedRequest) {
    return this.writes.unassignTask(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      user: a.user,
    })
  }

  @Tool({
    name: 'setTaskDates',
    description:
      'Срок задачи: startDate и/или dueDate (ISO). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, startDate?, dueDate?.',
    parameters: SetDates,
  })
  async setTaskDates(a: z.infer<typeof SetDates>, _c: Context, req: AuthedRequest) {
    return this.writes.setTaskDates(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      startDate: a.startDate,
      dueDate: a.dueDate,
    })
  }

  @Tool({
    name: 'setTaskSprint',
    description:
      'Спринт задачи: target="current"|"next"|"backlog"|id|имя. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, target.',
    parameters: SetSprint,
  })
  async setTaskSprint(a: z.infer<typeof SetSprint>, _c: Context, req: AuthedRequest) {
    return this.writes.setTaskSprint(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      target: a.target,
    })
  }

  @Tool({
    name: 'setTaskPriority',
    description: 'Приоритет задачи (название). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, value.',
    parameters: SetField,
  })
  async setTaskPriority(a: z.infer<typeof SetField>, _c: Context, req: AuthedRequest) {
    return this.writes.setTaskPriority(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      value: a.value,
    })
  }

  @Tool({
    name: 'setTaskType',
    description: 'Тип задачи (название). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, value.',
    parameters: SetField,
  })
  async setTaskType(a: z.infer<typeof SetField>, _c: Context, req: AuthedRequest) {
    return this.writes.setTaskType(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      value: a.value,
    })
  }

  @Tool({
    name: 'cancelTask',
    description:
      'Отменяет задачу: в колонку-CANCELLED, если есть, иначе archive. Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId.',
    parameters: TaskRef,
  })
  async cancelTask(a: z.infer<typeof TaskRef>, _c: Context, req: AuthedRequest) {
    return this.writes.cancelTask(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
    })
  }

  @Tool({
    name: 'addTaskComment',
    description:
      'Комментарий к задаче (Markdown). Требует подтверждения. Параметры: workspaceId, boardPageId?, taskId, markdown.',
    parameters: AddComment,
  })
  async addTaskComment(a: z.infer<typeof AddComment>, _c: Context, req: AuthedRequest) {
    return this.writes.addTaskComment(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      taskId: a.taskId,
      markdown: a.markdown,
    })
  }

  @Tool({
    name: 'createSprint',
    description:
      'Создаёт спринт (PLANNED). Только владелец/создатель доски. Требует подтверждения. Параметры: workspaceId, boardPageId?, name, description?, startDate?, endDate?.',
    parameters: CreateSprint,
  })
  async createSprint(a: z.infer<typeof CreateSprint>, _c: Context, req: AuthedRequest) {
    return this.writes.createSprint(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      name: a.name,
      description: a.description,
      startDate: a.startDate,
      endDate: a.endDate,
    })
  }

  @Tool({
    name: 'startSprint',
    description:
      'Запускает спринт (активный; прочие→PLANNED). Только владелец/создатель. Требует подтверждения. Параметры: workspaceId, boardPageId?, sprintId.',
    parameters: SprintRef,
  })
  async startSprint(a: z.infer<typeof SprintRef>, _c: Context, req: AuthedRequest) {
    return this.writes.startSprint(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      sprintId: a.sprintId,
    })
  }

  @Tool({
    name: 'closeSprint',
    description:
      'Завершает спринт; незавершённые → moveUndoneTo ("next"|"backlog"|id|имя; по умолч. беклог). Только владелец/создатель. Требует подтверждения. Параметры: workspaceId, boardPageId?, sprintId, moveUndoneTo?.',
    parameters: CloseSprint,
  })
  async closeSprint(a: z.infer<typeof CloseSprint>, _c: Context, req: AuthedRequest) {
    return this.writes.closeSprint(requireAuth(req).userId, a.workspaceId, {
      boardPageId: a.boardPageId,
      sprintId: a.sprintId,
      moveUndoneTo: a.moveUndoneTo,
    })
  }
}
