import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { dateInput, endPosition, positionBetween, recordActivity } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return a.getTime() === b.getTime()
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export const taskRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        columnId: z.string().uuid().optional(),
        typeId: z.string().uuid().optional(),
        priorityId: z.string().uuid().optional(),
        sprintId: z.string().uuid().optional(),
        title: z.string().min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      const column = input.columnId
        ? await ctx.prisma.kanbanColumn.findFirst({
            where: { id: input.columnId, pageId: page.id },
          })
        : await ctx.prisma.kanbanColumn.findFirst({
            where: { pageId: page.id },
            orderBy: { position: 'asc' },
          })
      if (!column) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'У доски нет колонок — создайте хотя бы одну',
        })
      }

      if (input.sprintId) {
        const sprint = await ctx.prisma.sprint.findFirst({
          where: { id: input.sprintId, pageId: page.id },
        })
        if (!sprint) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Спринт не найден' })
        }
      }

      const [type, priority] = await Promise.all([
        input.typeId
          ? ctx.prisma.kanbanType.findFirst({ where: { id: input.typeId, pageId: page.id } })
          : ctx.prisma.kanbanType.findFirst({
              where: { pageId: page.id },
              orderBy: { position: 'asc' },
            }),
        input.priorityId
          ? ctx.prisma.kanbanPriority.findFirst({
              where: { id: input.priorityId, pageId: page.id },
            })
          : ctx.prisma.kanbanPriority.findFirst({
              where: { pageId: page.id },
              orderBy: { position: 'asc' },
            }),
      ])

      const tasksInColumn = await ctx.prisma.task.findMany({
        where: { pageId: page.id, columnId: column.id, deletedAt: null },
        select: { position: true },
      })
      const tasksInSprint = input.sprintId
        ? await ctx.prisma.task.findMany({
            where: { pageId: page.id, sprintId: input.sprintId, deletedAt: null },
            select: { sprintPosition: true },
          })
        : []
      const sprintPosition = input.sprintId
        ? endPosition(
            tasksInSprint.map((task) => ({ position: task.sprintPosition ?? 0 })),
          )
        : null

      const task = await ctx.prisma.$transaction(async (tx) => {
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
            createdById: ctx.user.id,
          },
        })
        await recordActivity(tx, { taskId: created.id, actorId: ctx.user.id, type: 'CREATED' })
        return created
      })

      kanbanBus.emit(page.id, { kind: 'task.created', taskId: task.id })
      return task
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(500).optional(),
        description: z.unknown().optional(),
        startDate: dateInput,
        dueDate: dateInput,
        typeId: z.string().uuid().nullable().optional(),
        priorityId: z.string().uuid().nullable().optional(),
        sprintId: z.string().uuid().nullable().optional(),
        sprintPosition: z.number().nullable().optional(),
        parentId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
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
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }

      const task = await ctx.prisma.$transaction(async (tx) => {
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
            updatedById: ctx.user.id,
          },
        })

        if (input.title !== undefined && input.title !== current.title) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'RENAMED',
          })
        }
        if (input.description !== undefined) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'DESCRIPTION_CHANGED',
          })
        }
        if (input.dueDate !== undefined && !sameDate(current.dueDate, input.dueDate)) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'DUE_DATE_CHANGED',
            payload: { from: toIso(current.dueDate), to: toIso(input.dueDate) },
          })
        }
        if (input.startDate !== undefined && !sameDate(current.startDate, input.startDate)) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'START_DATE_CHANGED',
            payload: { from: toIso(current.startDate), to: toIso(input.startDate) },
          })
        }
        if (input.typeId !== undefined && input.typeId !== current.typeId) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'TYPE_CHANGED',
            payload: { fromId: current.typeId, toId: input.typeId },
          })
        }
        if (input.priorityId !== undefined && input.priorityId !== current.priorityId) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'PRIORITY_CHANGED',
            payload: { fromId: current.priorityId, toId: input.priorityId },
          })
        }
        if (input.sprintId !== undefined && input.sprintId !== current.sprintId) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'SPRINT_CHANGED',
            payload: { fromId: current.sprintId, toId: input.sprintId },
          })
        }
        if (input.parentId !== undefined && input.parentId !== current.parentId) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'PARENT_CHANGED',
            payload: { fromId: current.parentId, toId: input.parentId },
          })
        }
        return updated
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: task.id })
      return task
    }),

  move: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        targetColumnId: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, columnId: true },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }

      const columns = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { id: true, title: true, kind: true },
      })
      const fromColumn = columns.find((c) => c.id === current.columnId)
      const toColumn = columns.find((c) => c.id === input.targetColumnId)
      if (!toColumn) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Колонка назначения не найдена' })
      }

      const tasksInTarget = await ctx.prisma.task.findMany({
        where: {
          pageId: page.id,
          columnId: input.targetColumnId,
          deletedAt: null,
          NOT: { id: input.id },
        },
        select: { id: true, position: true },
      })
      const prev = input.beforeId
        ? (tasksInTarget.find((t) => t.id === input.beforeId)?.position ?? null)
        : null
      const next = input.afterId
        ? (tasksInTarget.find((t) => t.id === input.afterId)?.position ?? null)
        : null
      const position = positionBetween(prev, next)

      const task = await ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.task.update({
          where: { id: input.id },
          data: { columnId: input.targetColumnId, position, updatedById: ctx.user.id },
        })
        await recordActivity(tx, {
          taskId: current.id,
          actorId: ctx.user.id,
          type: 'MOVED',
          payload: {
            fromColumnId: current.columnId,
            toColumnId: input.targetColumnId,
            fromColumnTitle: fromColumn?.title ?? null,
            toColumnTitle: toColumn.title,
          },
        })
        if (fromColumn && fromColumn.kind !== toColumn.kind) {
          await recordActivity(tx, {
            taskId: current.id,
            actorId: ctx.user.id,
            type: 'STATUS_CHANGED',
            payload: { fromKind: fromColumn.kind, toKind: toColumn.kind },
          })
        }
        return updated
      })

      kanbanBus.emit(page.id, { kind: 'task.moved', taskId: task.id })
      return task
    }),

  setAssignees: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        userIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, assignees: { select: { userId: true } } },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const currentIds = new Set(current.assignees.map((a) => a.userId))
      const targetIds = new Set(input.userIds)
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      await ctx.prisma.$transaction(async (tx) => {
        if (toRemove.length > 0) {
          await tx.taskAssignee.deleteMany({
            where: { taskId: input.id, userId: { in: toRemove } },
          })
        }
        if (toAdd.length > 0) {
          await tx.taskAssignee.createMany({
            data: toAdd.map((userId) => ({ taskId: input.id, userId })),
          })
        }
        const activityRows = [
          ...toRemove.map((userId) => ({
            taskId: input.id,
            actorId: ctx.user.id,
            type: 'UNASSIGNED' as const,
            payload: { userId },
          })),
          ...toAdd.map((userId) => ({
            taskId: input.id,
            actorId: ctx.user.id,
            type: 'ASSIGNED' as const,
            payload: { userId },
          })),
        ]
        if (activityRows.length > 0) {
          await tx.taskActivity.createMany({ data: activityRows })
        }
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),

  setLabels: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        labelIds: z.array(z.string().uuid()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const current = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { id: true, pageId: true, labels: { select: { labelId: true } } },
      })
      if (current.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const currentIds = new Set(current.labels.map((l) => l.labelId))
      const targetIds = new Set(input.labelIds)
      const toRemove = [...currentIds].filter((id) => !targetIds.has(id))
      const toAdd = [...targetIds].filter((id) => !currentIds.has(id))

      await ctx.prisma.$transaction(async (tx) => {
        if (toRemove.length > 0) {
          await tx.kanbanLabelOnTask.deleteMany({
            where: { taskId: input.id, labelId: { in: toRemove } },
          })
        }
        if (toAdd.length > 0) {
          await tx.kanbanLabelOnTask.createMany({
            data: toAdd.map((labelId) => ({ taskId: input.id, labelId })),
          })
        }
        const activityRows = [
          ...toRemove.map((labelId) => ({
            taskId: input.id,
            actorId: ctx.user.id,
            type: 'UNLABELED' as const,
            payload: { labelId },
          })),
          ...toAdd.map((labelId) => ({
            taskId: input.id,
            actorId: ctx.user.id,
            type: 'LABELED' as const,
            payload: { labelId },
          })),
        ]
        if (activityRows.length > 0) {
          await tx.taskActivity.createMany({ data: activityRows })
        }
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),

  softDelete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [page, task] = await Promise.all([
        assertPageAccess(ctx, input.pageId),
        ctx.prisma.task.findUniqueOrThrow({
          where: { id: input.id },
          select: { id: true, pageId: true, createdById: true },
        }),
      ])
      if (task.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      if (task.createdById !== ctx.user.id) {
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
        })
        if (member?.role !== 'OWNER') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Недостаточно прав на удаление задачи',
          })
        }
      }

      await ctx.prisma.task.update({
        where: { id: input.id },
        data: { deletedAt: new Date(), updatedById: ctx.user.id },
      })
      kanbanBus.emit(page.id, { kind: 'task.deleted', taskId: input.id })
      return { ok: true as const }
    }),

  archive: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { pageId: true },
      })
      if (task.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      await ctx.prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: input.id },
          data: { archived: true, updatedById: ctx.user.id },
        })
        await recordActivity(tx, { taskId: input.id, actorId: ctx.user.id, type: 'ARCHIVED' })
      })
      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),

  unarchive: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.id },
        select: { pageId: true },
      })
      if (task.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      await ctx.prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: input.id },
          data: { archived: false, updatedById: ctx.user.id },
        })
        await recordActivity(tx, { taskId: input.id, actorId: ctx.user.id, type: 'UNARCHIVED' })
      })
      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.id })
      return { ok: true as const }
    }),
})
