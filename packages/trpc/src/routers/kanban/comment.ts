import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
import { recordActivity } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

const ContentSchema = z.unknown()

export const commentRouter = router({
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
      return ctx.prisma.taskComment.findMany({
        where: { taskId: input.taskId, deletedAt: null },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        taskId: z.string().uuid(),
        content: ContentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const task = await ctx.prisma.task.findUniqueOrThrow({
        where: { id: input.taskId },
        select: { pageId: true },
      })
      if (task.pageId !== input.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Задача не найдена' })
      }

      const comment = await ctx.prisma.$transaction(async (tx) => {
        const created = await tx.taskComment.create({
          data: {
            taskId: input.taskId,
            authorId: ctx.user.id,
            content: input.content as never,
          },
        })
        await recordActivity(tx, {
          taskId: input.taskId,
          actorId: ctx.user.id,
          type: 'COMMENTED',
          payload: { commentId: created.id },
        })
        return created
      })

      kanbanBus.emit(input.pageId, {
        kind: 'comment.upserted',
        taskId: input.taskId,
        commentId: comment.id,
      })
      return comment
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        taskId: z.string().uuid(),
        content: ContentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const existing = await ctx.prisma.taskComment.findUniqueOrThrow({
        where: { id: input.id },
        select: { authorId: true, taskId: true, task: { select: { pageId: true } } },
      })
      if (existing.taskId !== input.taskId || existing.task.pageId !== input.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      if (existing.authorId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Можно редактировать только свои комментарии' })
      }
      const updated = await ctx.prisma.taskComment.update({
        where: { id: input.id },
        data: { content: input.content as never },
      })
      kanbanBus.emit(input.pageId, {
        kind: 'comment.upserted',
        taskId: input.taskId,
        commentId: input.id,
      })
      return updated
    }),

  delete: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        taskId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      const existing = await ctx.prisma.taskComment.findUniqueOrThrow({
        where: { id: input.id },
        select: { authorId: true, taskId: true, task: { select: { pageId: true } } },
      })
      if (existing.taskId !== input.taskId || existing.task.pageId !== input.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      })
      const isOwner = member?.role === 'OWNER'
      const isAuthor = existing.authorId === ctx.user.id
      if (!isOwner && !isAuthor) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на удаление' })
      }
      await ctx.prisma.taskComment.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      })
      kanbanBus.emit(input.pageId, {
        kind: 'comment.deleted',
        taskId: input.taskId,
        commentId: input.id,
      })
      return { ok: true as const }
    }),
})
