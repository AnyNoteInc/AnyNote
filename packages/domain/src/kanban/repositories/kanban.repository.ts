import type { Prisma, TaskActivityType } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { recordActivity as recordActivityFn } from '../helpers.ts'

// ── Internal I/O types ────────────────────────────────────────────────────────

export interface AccessiblePage {
  id: string
  workspaceId: string
  createdById: string | null
}

export class KanbanRepository {
  constructor(private readonly uow: UnitOfWork) {}

  // ── Access queries ──────────────────────────────────────────────────────────

  async findAccessiblePage(userId: string, pageId: string): Promise<AccessiblePage | null> {
    const row = await this.uow.client().page.findFirst({
      where: { id: pageId, workspace: { members: { some: { userId } } } },
      select: { id: true, workspaceId: true, createdById: true },
    })
    if (!row) return null
    return { id: row.id, workspaceId: row.workspaceId, createdById: row.createdById }
  }

  async findMembershipRole(userId: string, workspaceId: string): Promise<string | null> {
    const member = await this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
    return member?.role ?? null
  }

  // ── Activity recording ──────────────────────────────────────────────────────

  async recordActivity(input: {
    taskId: string
    actorId: string
    type: TaskActivityType
    payload?: Prisma.InputJsonValue
  }): Promise<void> {
    await recordActivityFn(this.uow.client() as Prisma.TransactionClient, input)
  }

  // ── Task queries ────────────────────────────────────────────────────────────

  async findColumn(
    pageId: string,
    columnId: string | undefined,
  ): Promise<{ id: string } | null> {
    if (columnId) {
      return this.uow.client().kanbanColumn.findFirst({ where: { id: columnId, pageId } })
    }
    return this.uow.client().kanbanColumn.findFirst({ where: { pageId }, orderBy: { position: 'asc' } })
  }

  async findSprint(pageId: string, sprintId: string): Promise<{ id: string } | null> {
    return this.uow.client().sprint.findFirst({ where: { id: sprintId, pageId } })
  }

  async findTypeAndPriority(
    pageId: string,
    typeId: string | undefined,
    priorityId: string | undefined,
  ): Promise<[{ id: string } | null, { id: string } | null]> {
    return Promise.all([
      typeId
        ? this.uow.client().kanbanType.findFirst({ where: { id: typeId, pageId } })
        : this.uow.client().kanbanType.findFirst({ where: { pageId }, orderBy: { position: 'asc' } }),
      priorityId
        ? this.uow.client().kanbanPriority.findFirst({ where: { id: priorityId, pageId } })
        : this.uow.client().kanbanPriority.findFirst({ where: { pageId }, orderBy: { position: 'asc' } }),
    ])
  }

  async findTasksInColumn(
    pageId: string,
    columnId: string,
  ): Promise<{ position: number }[]> {
    return this.uow.client().task.findMany({
      where: { pageId, columnId, deletedAt: null },
      select: { position: true },
    })
  }

  async findTasksInSprint(
    pageId: string,
    sprintId: string,
  ): Promise<{ sprintPosition: number | null }[]> {
    return this.uow.client().task.findMany({
      where: { pageId, sprintId, deletedAt: null },
      select: { sprintPosition: true },
    })
  }

  async createTask(data: {
    pageId: string
    columnId: string
    typeId: string | null
    priorityId: string | null
    title: string
    position: number
    sprintId: string | null
    sprintPosition: number | null
    createdById: string
  }): Promise<{ id: string; pageId: string; columnId: string; position: number }> {
    return this.uow.client().task.create({ data }) as Promise<{
      id: string
      pageId: string
      columnId: string
      position: number
    }>
  }

  async findTaskForUpdate(taskId: string): Promise<{
    id: string
    pageId: string
    title: string
    dueDate: Date | null
    startDate: Date | null
    typeId: string | null
    priorityId: string | null
    sprintId: string | null
    parentId: string | null
  }> {
    return this.uow.client().task.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        id: true,
        pageId: true,
        title: true,
        dueDate: true,
        startDate: true,
        typeId: true,
        priorityId: true,
        sprintId: true,
        parentId: true,
      },
    }) as Promise<{
      id: string
      pageId: string
      title: string
      dueDate: Date | null
      startDate: Date | null
      typeId: string | null
      priorityId: string | null
      sprintId: string | null
      parentId: string | null
    }>
  }

  async updateTask(
    taskId: string,
    data: {
      title?: string
      description?: unknown
      startDate?: Date | null
      dueDate?: Date | null
      typeId?: string | null
      priorityId?: string | null
      sprintId?: string | null
      sprintPosition?: number | null
      parentId?: string | null
      updatedById: string
    },
  ): Promise<{ id: string; pageId: string }> {
    return this.uow.client().task.update({
      where: { id: taskId },
      data: data as Prisma.TaskUpdateInput,
    }) as Promise<{ id: string; pageId: string }>
  }

  async findTaskForMove(taskId: string): Promise<{
    id: string
    pageId: string
    columnId: string
  }> {
    return this.uow.client().task.findUniqueOrThrow({
      where: { id: taskId },
      select: { id: true, pageId: true, columnId: true },
    }) as Promise<{ id: string; pageId: string; columnId: string }>
  }

  async findColumnsForPage(pageId: string): Promise<{ id: string; title: string; kind: string }[]> {
    return this.uow.client().kanbanColumn.findMany({
      where: { pageId },
      select: { id: true, title: true, kind: true },
    }) as Promise<{ id: string; title: string; kind: string }[]>
  }

  async findTasksInTargetColumn(
    pageId: string,
    columnId: string,
    excludeId: string,
  ): Promise<{ id: string; position: number }[]> {
    return this.uow.client().task.findMany({
      where: { pageId, columnId, deletedAt: null, NOT: { id: excludeId } },
      select: { id: true, position: true },
    }) as Promise<{ id: string; position: number }[]>
  }

  async moveTask(
    taskId: string,
    columnId: string,
    position: number,
    updatedById: string,
  ): Promise<{ id: string; pageId: string }> {
    return this.uow.client().task.update({
      where: { id: taskId },
      data: { columnId, position, updatedById },
    }) as Promise<{ id: string; pageId: string }>
  }

  async findTaskForAssignees(taskId: string): Promise<{
    id: string
    pageId: string
    assignees: { userId: string }[]
  }> {
    return this.uow.client().task.findUniqueOrThrow({
      where: { id: taskId },
      select: { id: true, pageId: true, assignees: { select: { userId: true } } },
    }) as Promise<{ id: string; pageId: string; assignees: { userId: string }[] }>
  }

  async deleteAssignees(taskId: string, userIds: string[]): Promise<void> {
    await this.uow.client().taskAssignee.deleteMany({
      where: { taskId, userId: { in: userIds } },
    })
  }

  async createAssignees(taskId: string, userIds: string[]): Promise<void> {
    await this.uow.client().taskAssignee.createMany({
      data: userIds.map((userId) => ({ taskId, userId })),
    })
  }

  async createActivityMany(
    rows: { taskId: string; actorId: string; type: TaskActivityType; payload?: Prisma.InputJsonValue }[],
  ): Promise<void> {
    await this.uow.client().taskActivity.createMany({ data: rows })
  }

  async findTaskPageId(taskId: string): Promise<{ pageId: string }> {
    return this.uow.client().task.findUniqueOrThrow({
      where: { id: taskId },
      select: { pageId: true },
    }) as Promise<{ pageId: string }>
  }

  async archiveTask(taskId: string, updatedById: string): Promise<void> {
    await this.uow.client().task.update({
      where: { id: taskId },
      data: { archived: true, updatedById },
    })
  }

  async createTaskComment(data: {
    taskId: string
    authorId: string
    content: unknown
  }): Promise<{ id: string; taskId: string; authorId: string }> {
    return this.uow.client().taskComment.create({
      data: data as unknown as Prisma.TaskCommentUncheckedCreateInput,
    }) as Promise<{ id: string; taskId: string; authorId: string }>
  }

  // ── Sprint queries ──────────────────────────────────────────────────────────

  async findSprintsForPosition(pageId: string): Promise<{ position: number }[]> {
    return this.uow.client().sprint.findMany({
      where: { pageId },
      select: { position: true },
    })
  }

  async createSprint(data: {
    pageId: string
    name: string
    description: string | null
    startDate: Date | null
    endDate: Date | null
    status: 'PLANNED' | 'ACTIVE' | 'COMPLETED'
    position: number
  }): Promise<{ id: string; pageId: string; name: string; status: string; position: number }> {
    return this.uow.client().sprint.create({ data }) as Promise<{
      id: string
      pageId: string
      name: string
      status: string
      position: number
    }>
  }

  async demoteActiveSprints(pageId: string, excludeId: string): Promise<void> {
    await this.uow.client().sprint.updateMany({
      where: { pageId, status: 'ACTIVE', NOT: { id: excludeId } },
      data: { status: 'PLANNED' },
    })
  }

  async activateSprint(sprintId: string, pageId: string): Promise<void> {
    await this.uow.client().sprint.update({
      where: { id: sprintId, pageId },
      data: { status: 'ACTIVE' },
    })
  }

  async findSprintById(
    sprintId: string,
  ): Promise<{ id: string; pageId: string } | null> {
    return this.uow.client().sprint.findUnique({
      where: { id: sprintId },
      select: { id: true, pageId: true },
    })
  }

  async findSprintAndDestAndColumns(
    sprintId: string,
    moveUndoneTo: string | null,
    pageId: string,
  ): Promise<{
    sprint: { id: string; pageId: string } | null
    dest: { id: string; pageId: string } | null
    undoneColumns: { id: string }[]
  }> {
    const [sprint, dest, undoneColumns] = await Promise.all([
      this.uow.client().sprint.findUnique({ where: { id: sprintId }, select: { id: true, pageId: true } }),
      moveUndoneTo
        ? this.uow.client().sprint.findUnique({ where: { id: moveUndoneTo }, select: { id: true, pageId: true } })
        : Promise.resolve(null),
      this.uow.client().kanbanColumn.findMany({
        where: { pageId, kind: 'ACTIVE' },
        select: { id: true },
      }),
    ])
    return { sprint, dest, undoneColumns }
  }

  async moveUndoneTasksToSprint(
    fromSprintId: string,
    activeColumnIds: string[],
    moveUndoneTo: string | null,
  ): Promise<void> {
    await this.uow.client().task.updateMany({
      where: { sprintId: fromSprintId, columnId: { in: activeColumnIds } },
      data: { sprintId: moveUndoneTo, sprintPosition: null },
    })
  }

  async completeSprint(sprintId: string): Promise<void> {
    await this.uow.client().sprint.update({
      where: { id: sprintId },
      data: { status: 'COMPLETED' },
    })
  }

  // ── Seed ────────────────────────────────────────────────────────────────────

  async seedKanbanDefaults(pageId: string): Promise<void> {
    const DEFAULT_PRIORITY_COLORS = {
      low: '#6B7280',
      medium: '#3B82F6',
      high: '#F97316',
      critical: '#EF4444',
    } as const

    await this.uow.client().kanbanColumn.createMany({
      data: [
        { pageId, title: 'Todo', kind: 'ACTIVE', position: 1024 },
        { pageId, title: 'In Progress', kind: 'ACTIVE', position: 2048 },
        { pageId, title: 'Done', kind: 'DONE', position: 3072 },
      ],
    })
    await this.uow.client().kanbanType.createMany({
      data: [
        { pageId, title: 'Задача', position: 1024 },
        { pageId, title: 'Баг', position: 2048 },
      ],
    })
    await this.uow.client().kanbanPriority.createMany({
      data: [
        { pageId, title: 'Низкий', color: DEFAULT_PRIORITY_COLORS.low, position: 1024 },
        { pageId, title: 'Средний', color: DEFAULT_PRIORITY_COLORS.medium, position: 2048 },
        { pageId, title: 'Высокий', color: DEFAULT_PRIORITY_COLORS.high, position: 3072 },
        { pageId, title: 'Критичный', color: DEFAULT_PRIORITY_COLORS.critical, position: 4096 },
      ],
    })
  }
}
