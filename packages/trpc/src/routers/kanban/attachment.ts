import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { recordActivity } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const attachmentRouter = router({
  list: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), taskId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.taskId },
        select: { pageId: true },
      })
      if (task.pageId !== input.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const rows = await ctx.prisma.taskAttachment.findMany({
        where: { taskId: input.taskId, deletedAt: null },
        include: {
          file: {
            select: { id: true, name: true, mimeType: true, fileSize: true },
          },
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map((r) => ({
        ...r,
        file: { ...r.file, fileSize: r.file.fileSize.toString() },
      }))
    }),

  attach: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        taskId: z.string().uuid(),
        fileId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.taskId },
        select: { pageId: true },
      })
      if (task.pageId !== page.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }
      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, workspaceId: page.workspaceId },
        select: { id: true },
      })
      if (!file) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Файл не найден в этом воркспейсе',
        })
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.taskAttachment.upsert({
          where: { taskId_fileId: { taskId: input.taskId, fileId: input.fileId } },
          create: {
            taskId: input.taskId,
            fileId: input.fileId,
            uploadedById: ctx.user.id,
          },
          update: { deletedAt: null },
        })
        await recordActivity(tx, {
          taskId: input.taskId,
          actorId: ctx.user.id,
          type: 'ATTACHMENT_ADDED',
          payload: { fileId: input.fileId },
        })
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.taskId })
      return { ok: true as const }
    }),

  detach: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        taskId: z.string().uuid(),
        fileId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const existing = await ctx.prisma.taskAttachment.findUnique({
        where: { taskId_fileId: { taskId: input.taskId, fileId: input.fileId } },
        select: { uploadedById: true, task: { select: { pageId: true } } },
      })
      if (!existing || existing.task.pageId !== input.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Вложение не найдено' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      })
      const isOwner = member?.role === 'OWNER'
      const isUploader = existing.uploadedById === ctx.user.id
      if (!isOwner && !isUploader) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на удаление вложения' })
      }

      await ctx.prisma.$transaction(async (tx) => {
        await tx.taskAttachment.update({
          where: { taskId_fileId: { taskId: input.taskId, fileId: input.fileId } },
          data: { deletedAt: new Date() },
        })
        await recordActivity(tx, {
          taskId: input.taskId,
          actorId: ctx.user.id,
          type: 'ATTACHMENT_REMOVED',
          payload: { fileId: input.fileId },
        })
      })

      kanbanBus.emit(page.id, { kind: 'task.updated', taskId: input.taskId })
      return { ok: true as const }
    }),
})
