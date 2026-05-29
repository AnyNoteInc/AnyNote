import type { PrismaClient } from '@repo/db'

import { badRequest, notFound } from '../errors.ts'
import { assertPageAccess } from './access.ts'
import { endPosition, positionBetween, recordActivity } from './helpers.ts'
import type { CreateTaskInput, MoveTaskInput, SetTaskAssigneesInput, TaskIdInput, UpdateTaskInput } from './schemas.ts'

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.getTime() === b.getTime()
}
function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export async function createTask(prisma: PrismaClient, actorUserId: string, input: CreateTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const column = input.columnId
    ? await prisma.kanbanColumn.findFirst({ where: { id: input.columnId, pageId: page.id } })
    : await prisma.kanbanColumn.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } })
  if (!column) throw badRequest('У доски нет колонок — создайте хотя бы одну')

  if (input.sprintId) {
    const sprint = await prisma.sprint.findFirst({ where: { id: input.sprintId, pageId: page.id } })
    if (!sprint) throw badRequest('Спринт не найден')
  }

  const [type, priority] = await Promise.all([
    input.typeId
      ? prisma.kanbanType.findFirst({ where: { id: input.typeId, pageId: page.id } })
      : prisma.kanbanType.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
    input.priorityId
      ? prisma.kanbanPriority.findFirst({ where: { id: input.priorityId, pageId: page.id } })
      : prisma.kanbanPriority.findFirst({ where: { pageId: page.id }, orderBy: { position: 'asc' } }),
  ])

  const tasksInColumn = await prisma.task.findMany({
    where: { pageId: page.id, columnId: column.id, deletedAt: null },
    select: { position: true },
  })
  const tasksInSprint = input.sprintId
    ? await prisma.task.findMany({ where: { pageId: page.id, sprintId: input.sprintId, deletedAt: null }, select: { sprintPosition: true } })
    : []
  const sprintPosition = input.sprintId
    ? endPosition(tasksInSprint.map((task) => ({ position: task.sprintPosition ?? 0 })))
    : null

  return prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        pageId: page.id,
        columnId: column.id,
        typeId: type?.id ?? null,
        priorityId: priority?.id ?? null,
        title: input.title,
        position: endPosition(tasksInColumn),
        sprintId: input.sprintId ?? null,
        sprintPosition,
        createdById: actorUserId,
      },
    })
    await recordActivity(tx, { taskId: created.id, actorId: actorUserId, type: 'CREATED' })
    return created
  })
}

export async function updateTask(prisma: PrismaClient, actorUserId: string, input: UpdateTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({
    where: { id: input.id },
    select: { id: true, pageId: true, title: true, dueDate: true, startDate: true, typeId: true, priorityId: true, sprintId: true, parentId: true },
  })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: input.id },
      data: {
        title: input.title,
        description: input.description as never,
        startDate: input.startDate,
        dueDate: input.dueDate,
        typeId: input.typeId,
        priorityId: input.priorityId,
        sprintId: input.sprintId,
        sprintPosition: input.sprintPosition,
        parentId: input.parentId,
        updatedById: actorUserId,
      },
    })
    if (input.title !== undefined && input.title !== current.title)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'RENAMED' })
    if (input.description !== undefined)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'DESCRIPTION_CHANGED' })
    if (input.dueDate !== undefined && !sameDate(current.dueDate, input.dueDate))
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'DUE_DATE_CHANGED', payload: { from: toIso(current.dueDate), to: toIso(input.dueDate) } })
    if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate))
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'START_DATE_CHANGED', payload: { from: toIso(current.startDate), to: toIso(input.startDate) } })
    if (input.typeId !== undefined && input.typeId !== current.typeId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'TYPE_CHANGED', payload: { fromId: current.typeId, toId: input.typeId } })
    if (input.priorityId !== undefined && input.priorityId !== current.priorityId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'PRIORITY_CHANGED', payload: { fromId: current.priorityId, toId: input.priorityId } })
    if (input.sprintId !== undefined && input.sprintId !== current.sprintId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'SPRINT_CHANGED', payload: { fromId: current.sprintId, toId: input.sprintId } })
    if (input.parentId !== undefined && input.parentId !== current.parentId)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'PARENT_CHANGED', payload: { fromId: current.parentId, toId: input.parentId } })
    return updated
  })
}

export async function moveTask(prisma: PrismaClient, actorUserId: string, input: MoveTaskInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({ where: { id: input.id }, select: { id: true, pageId: true, columnId: true } })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')

  const columns = await prisma.kanbanColumn.findMany({ where: { pageId: page.id }, select: { id: true, title: true, kind: true } })
  const fromColumn = columns.find((c) => c.id === current.columnId)
  const toColumn = columns.find((c) => c.id === input.targetColumnId)
  if (!toColumn) throw badRequest('Колонка назначения не найдена')

  const tasksInTarget = await prisma.task.findMany({
    where: { pageId: page.id, columnId: input.targetColumnId, deletedAt: null, NOT: { id: input.id } },
    select: { id: true, position: true },
  })
  const prev = input.beforeId ? (tasksInTarget.find((t) => t.id === input.beforeId)?.position ?? null) : null
  const next = input.afterId ? (tasksInTarget.find((t) => t.id === input.afterId)?.position ?? null) : null
  const position = positionBetween(prev, next)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({ where: { id: input.id }, data: { columnId: input.targetColumnId, position, updatedById: actorUserId } })
    await recordActivity(tx, {
      taskId: current.id,
      actorId: actorUserId,
      type: 'MOVED',
      payload: { fromColumnId: current.columnId, toColumnId: input.targetColumnId, fromColumnTitle: fromColumn?.title ?? null, toColumnTitle: toColumn.title },
    })
    if (fromColumn && fromColumn.kind !== toColumn.kind)
      await recordActivity(tx, { taskId: current.id, actorId: actorUserId, type: 'STATUS_CHANGED', payload: { fromKind: fromColumn.kind, toKind: toColumn.kind } })
    return updated
  })
}

export async function setTaskAssignees(prisma: PrismaClient, actorUserId: string, input: SetTaskAssigneesInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const current = await prisma.task.findUniqueOrThrow({ where: { id: input.id }, select: { id: true, pageId: true, assignees: { select: { userId: true } } } })
  if (current.pageId !== page.id) throw notFound('Задача не найдена')
  const currentIds = new Set(current.assignees.map((a) => a.userId))
  const targetIds = new Set(input.userIds)
  const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
  const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

  await prisma.$transaction(async (tx) => {
    if (toRemove.length > 0) await tx.taskAssignee.deleteMany({ where: { taskId: input.id, userId: { in: toRemove } } })
    if (toAdd.length > 0) await tx.taskAssignee.createMany({ data: toAdd.map((userId) => ({ taskId: input.id, userId })) })
    const activityRows = [
      ...toRemove.map((userId) => ({ taskId: input.id, actorId: actorUserId, type: 'UNASSIGNED' as const, payload: { userId } })),
      ...toAdd.map((userId) => ({ taskId: input.id, actorId: actorUserId, type: 'ASSIGNED' as const, payload: { userId } })),
    ]
    if (activityRows.length > 0) await tx.taskActivity.createMany({ data: activityRows })
  })
  return { ok: true as const }
}

export async function archiveTask(prisma: PrismaClient, actorUserId: string, input: TaskIdInput) {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  const task = await prisma.task.findUniqueOrThrow({ where: { id: input.id }, select: { pageId: true } })
  if (task.pageId !== page.id) throw notFound('Задача не найдена')
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: input.id }, data: { archived: true, updatedById: actorUserId } })
    await recordActivity(tx, { taskId: input.id, actorId: actorUserId, type: 'ARCHIVED' })
  })
  return { ok: true as const }
}
