import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CompleteSprintInput,
  CreateParticipantInput,
  CreateSprintInput,
  CreateTaskCommentInput,
  CreateTaskInput,
  MoveTaskInput,
  ParticipantIdInput,
  SetTaskAssigneesInput,
  SprintIdInput,
  TaskIdInput,
  UpdateParticipantInput,
  UpdateTaskInput,
} from '../dto/kanban.dto.ts'
import { endPosition, positionBetween } from '../helpers.ts'
import type { AccessiblePage, KanbanRepository } from '../repositories/kanban.repository.ts'

// ── Date helpers ──────────────────────────────────────────────────────────────

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.getTime() === b.getTime()
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

// ─────────────────────────────────────────────────────────────────────────────

export class KanbanService {
  private readonly repo: KanbanRepository
  private readonly uow: UnitOfWork
  constructor(repo: KanbanRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  // ── Access helpers ──────────────────────────────────────────────────────────

  private async assertOwnership(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER') throw forbidden('Недостаточно прав')
    return page
  }

  private async assertCanEdit(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR') {
      throw forbidden('Недостаточно прав на редактирование')
    }
    return page
  }

  private async assertCanComment(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR' && role !== 'COMMENTER') {
      throw forbidden('Недостаточно прав на комментирование')
    }
    return page
  }

  // ── Task operations ─────────────────────────────────────────────────────────

  async createTask(actorUserId: string, input: CreateTaskInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)

    const column = await this.repo.findColumn(page.id, input.columnId)
    if (!column) throw badRequest('У доски нет колонок — создайте хотя бы одну')

    if (input.sprintId) {
      const sprint = await this.repo.findSprint(page.id, input.sprintId)
      if (!sprint) throw badRequest('Спринт не найден')
    }

    const [type, priority] = await this.repo.findTypeAndPriority(
      page.id,
      input.typeId,
      input.priorityId,
    )

    const tasksInColumn = await this.repo.findTasksInColumn(page.id, column.id)
    const tasksInSprint = input.sprintId
      ? await this.repo.findTasksInSprint(page.id, input.sprintId)
      : []
    const sprintPosition = input.sprintId
      ? endPosition(tasksInSprint.map((t) => ({ position: t.sprintPosition ?? 0 })))
      : null

    return this.uow.transaction(async () => {
      const created = await this.repo.createTask({
        pageId: page.id,
        columnId: column.id,
        typeId: type?.id ?? null,
        priorityId: priority?.id ?? null,
        title: input.title,
        position: endPosition(tasksInColumn),
        sprintId: input.sprintId ?? null,
        sprintPosition,
        createdById: actorUserId,
      })
      await this.repo.recordActivity({ taskId: created.id, actorId: actorUserId, type: 'CREATED' })
      return created
    })
  }

  async updateTask(actorUserId: string, input: UpdateTaskInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const current = await this.repo.findTaskForUpdate(input.id)
    if (current.pageId !== page.id) throw notFound('Задача не найдена')

    return this.uow.transaction(async () => {
      const updated = await this.repo.updateTask(input.id, {
        title: input.title,
        description: input.description,
        startDate: input.startDate,
        dueDate: input.dueDate,
        typeId: input.typeId,
        priorityId: input.priorityId,
        sprintId: input.sprintId,
        sprintPosition: input.sprintPosition,
        parentId: input.parentId,
        updatedById: actorUserId,
      })
      if (input.title !== undefined && input.title !== current.title)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'RENAMED' })
      if (input.description !== undefined)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'DESCRIPTION_CHANGED' })
      if (input.dueDate !== undefined && !sameDate(current.dueDate, input.dueDate))
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'DUE_DATE_CHANGED', payload: { from: toIso(current.dueDate), to: toIso(input.dueDate) } })
      if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate))
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'START_DATE_CHANGED', payload: { from: toIso(current.startDate), to: toIso(input.startDate) } })
      if (input.typeId !== undefined && input.typeId !== current.typeId)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'TYPE_CHANGED', payload: { fromId: current.typeId, toId: input.typeId } })
      if (input.priorityId !== undefined && input.priorityId !== current.priorityId)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'PRIORITY_CHANGED', payload: { fromId: current.priorityId, toId: input.priorityId } })
      if (input.sprintId !== undefined && input.sprintId !== current.sprintId)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'SPRINT_CHANGED', payload: { fromId: current.sprintId, toId: input.sprintId } })
      if (input.parentId !== undefined && input.parentId !== current.parentId)
        await this.repo.recordActivity({ taskId: current.id, actorId: actorUserId, type: 'PARENT_CHANGED', payload: { fromId: current.parentId, toId: input.parentId } })
      return updated
    })
  }

  async moveTask(actorUserId: string, input: MoveTaskInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const current = await this.repo.findTaskForMove(input.id)
    if (current.pageId !== page.id) throw notFound('Задача не найдена')

    const columns = await this.repo.findColumnsForPage(page.id)
    const fromColumn = columns.find((c) => c.id === current.columnId)
    const toColumn = columns.find((c) => c.id === input.targetColumnId)
    if (!toColumn) throw badRequest('Колонка назначения не найдена')

    const tasksInTarget = await this.repo.findTasksInTargetColumn(
      page.id,
      input.targetColumnId,
      input.id,
    )
    const prev = input.beforeId ? (tasksInTarget.find((t) => t.id === input.beforeId)?.position ?? null) : null
    const next = input.afterId ? (tasksInTarget.find((t) => t.id === input.afterId)?.position ?? null) : null
    const position = positionBetween(prev, next)

    return this.uow.transaction(async () => {
      const updated = await this.repo.moveTask(input.id, input.targetColumnId, position, actorUserId)
      await this.repo.recordActivity({
        taskId: current.id,
        actorId: actorUserId,
        type: 'MOVED',
        payload: {
          fromColumnId: current.columnId,
          toColumnId: input.targetColumnId,
          fromColumnTitle: fromColumn?.title ?? null,
          toColumnTitle: toColumn.title,
        },
      })
      if (fromColumn && fromColumn.kind !== toColumn.kind)
        await this.repo.recordActivity({
          taskId: current.id,
          actorId: actorUserId,
          type: 'STATUS_CHANGED',
          payload: { fromKind: fromColumn.kind, toKind: toColumn.kind },
        })
      return updated
    })
  }

  async setTaskAssignees(actorUserId: string, input: SetTaskAssigneesInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const current = await this.repo.findTaskForAssignees(input.id)
    if (current.pageId !== page.id) throw notFound('Задача не найдена')

    return this.uow.transaction(async () => {
      // Mirror any raw user ids into participant rows for this workspace.
      const mirroredIds: string[] = []
      for (const userId of input.userIdsToMirror) {
        const p = await this.repo.findOrCreateUserParticipant(page.workspaceId, userId)
        mirroredIds.push(p.id)
      }
      const targetIds = new Set([...input.participantIds, ...mirroredIds])

      // Validate every target participant belongs to this workspace.
      if (targetIds.size > 0) {
        const rows = await this.repo.findParticipantWorkspaceIds([...targetIds])
        for (const id of targetIds) {
          const row = rows.find((r) => r.id === id)
          if (!row || row.workspaceId !== page.workspaceId)
            throw badRequest('Участник не принадлежит рабочей области')
        }
      }

      const currentIds = new Set(current.assignees.map((a) => a.participantId))
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      if (toRemove.length > 0) await this.repo.deleteAssignees(input.id, toRemove)
      if (toAdd.length > 0) await this.repo.createAssignees(input.id, toAdd)
      const activityRows = [
        ...toRemove.map((participantId) => ({ taskId: input.id, actorId: actorUserId, type: 'UNASSIGNED' as const, payload: { participantId } })),
        ...toAdd.map((participantId) => ({ taskId: input.id, actorId: actorUserId, type: 'ASSIGNED' as const, payload: { participantId } })),
      ]
      if (activityRows.length > 0) await this.repo.createActivityMany(activityRows)
      return { ok: true as const }
    })
  }

  // ── Participant operations ────────────────────────────────────────────────

  private async assertWorkspaceMember(userId: string, workspaceId: string): Promise<void> {
    const role = await this.repo.findMembershipRole(userId, workspaceId)
    if (!role) throw forbidden('Недостаточно прав')
  }

  private async assertCanManageParticipants(userId: string, workspaceId: string): Promise<void> {
    const role = await this.repo.findMembershipRole(userId, workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR') {
      throw forbidden('Недостаточно прав на управление участниками')
    }
  }

  async listParticipants(actorUserId: string, workspaceId: string) {
    await this.assertWorkspaceMember(actorUserId, workspaceId)
    return this.repo.listParticipants(workspaceId)
  }

  async createParticipant(actorUserId: string, input: CreateParticipantInput) {
    await this.assertCanManageParticipants(actorUserId, input.workspaceId)
    return this.repo.createGuestParticipant({
      workspaceId: input.workspaceId,
      fullName: input.fullName,
      company: input.company ?? null,
    })
  }

  async updateParticipant(actorUserId: string, input: UpdateParticipantInput) {
    await this.assertCanManageParticipants(actorUserId, input.workspaceId)
    const existing = await this.repo.findParticipantById(input.id)
    if (!existing || existing.workspaceId !== input.workspaceId) throw notFound('Участник не найден')
    if (existing.userId) throw conflict('Этот участник связан с пользователем и не редактируется')
    return this.repo.updateGuestParticipant(input.id, {
      fullName: input.fullName,
      company: input.company ?? null,
    })
  }

  async deleteParticipant(actorUserId: string, input: ParticipantIdInput) {
    await this.assertCanManageParticipants(actorUserId, input.workspaceId)
    const existing = await this.repo.findParticipantById(input.id)
    if (!existing || existing.workspaceId !== input.workspaceId) throw notFound('Участник не найден')
    if (existing.userId) throw conflict('Этот участник связан с пользователем и не удаляется')
    await this.repo.deleteParticipant(input.id)
    return { ok: true as const }
  }

  async archiveTask(actorUserId: string, input: TaskIdInput) {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const task = await this.repo.findTaskPageId(input.id)
    if (task.pageId !== page.id) throw notFound('Задача не найдена')
    await this.uow.transaction(async () => {
      await this.repo.archiveTask(input.id, actorUserId)
      await this.repo.recordActivity({ taskId: input.id, actorId: actorUserId, type: 'ARCHIVED' })
    })
    return { ok: true as const }
  }

  // ── Sprint operations ───────────────────────────────────────────────────────

  async createSprint(actorUserId: string, input: CreateSprintInput) {
    const page = await this.assertOwnership(actorUserId, input.pageId)
    const existing = await this.repo.findSprintsForPosition(page.id)
    return this.repo.createSprint({
      pageId: page.id,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      status: 'PLANNED',
      position: endPosition(existing),
    })
  }

  async activateSprint(actorUserId: string, input: SprintIdInput) {
    const page = await this.assertOwnership(actorUserId, input.pageId)
    try {
      await this.uow.transaction(async () => {
        await this.repo.demoteActiveSprints(page.id, input.id)
        await this.repo.activateSprint(input.id, page.id)
      })
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002')
        throw conflict('Активный спринт уже существует — попробуйте ещё раз')
      throw e
    }
    return { ok: true as const }
  }

  async completeSprint(actorUserId: string, input: CompleteSprintInput) {
    const page = await this.assertOwnership(actorUserId, input.pageId)
    if (input.moveUndoneTo === input.id) throw badRequest('Невозможно перенести задачи в тот же спринт')

    await this.uow.transaction(async () => {
      const { sprint, dest, undoneColumns } = await this.repo.findSprintAndDestAndColumns(
        input.id,
        input.moveUndoneTo,
        page.id,
      )
      if (sprint?.pageId !== page.id) throw notFound('Спринт не найден')
      if (input.moveUndoneTo && dest?.pageId !== page.id)
        throw notFound('Целевой спринт не найден на этой доске')
      const undoneColumnIds = undoneColumns.map((c) => c.id)
      await this.repo.moveUndoneTasksToSprint(input.id, undoneColumnIds, input.moveUndoneTo)
      await this.repo.completeSprint(input.id)
    })
    return { ok: true as const }
  }

  // ── Comment operations ──────────────────────────────────────────────────────

  async createTaskComment(actorUserId: string, input: CreateTaskCommentInput) {
    await this.assertCanComment(actorUserId, input.pageId)
    const task = await this.repo.findTaskPageId(input.taskId)
    if (task.pageId !== input.pageId) throw notFound('Задача не найдена')
    return this.uow.transaction(async () => {
      const created = await this.repo.createTaskComment({
        taskId: input.taskId,
        authorId: actorUserId,
        content: input.content,
      })
      await this.repo.recordActivity({
        taskId: input.taskId,
        actorId: actorUserId,
        type: 'COMMENTED',
        payload: { commentId: created.id },
      })
      return created
    })
  }

  // ── Seed ────────────────────────────────────────────────────────────────────

  async seedDefaults(pageId: string): Promise<void> {
    await this.repo.seedKanbanDefaults(pageId)
  }
}
