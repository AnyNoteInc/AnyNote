import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { recordActivity } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const taskRouter = router({
  create: protectedProcedure
    .input(domain.createTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domainSvc.kanban.createTask(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.created', taskId: task.id })
      return task
    }),

  update: protectedProcedure
    .input(domain.updateTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domainSvc.kanban.updateTask(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: task.id })
      return task
    }),

  move: protectedProcedure
    .input(domain.moveTaskInput)
    .mutation(async ({ ctx, input }) => {
      const task = await mapDomain(() => domainSvc.kanban.moveTask(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.moved', taskId: task.id })
      return task
    }),

  setAssignees: protectedProcedure
    .input(domain.setTaskAssigneesInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domainSvc.kanban.setTaskAssignees(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: input.id })
      return res
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
    .input(domain.taskIdInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domainSvc.kanban.archiveTask(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'task.updated', taskId: input.id })
      return res
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
