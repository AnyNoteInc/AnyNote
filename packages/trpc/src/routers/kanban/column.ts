import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

const ColumnKindEnum = z.enum(['ACTIVE', 'DONE', 'CANCELLED'])

export const columnRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        title: z.string().min(1).max(120),
        kind: ColumnKindEnum.default('ACTIVE'),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const existing = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const column = await ctx.prisma.kanbanColumn.create({
        data: {
          pageId: page.id,
          title: input.title,
          kind: input.kind,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        kind: ColumnKindEnum.optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const column = await ctx.prisma.kanbanColumn.update({
        where: { id: input.id },
        data: {
          title: input.title,
          kind: input.kind,
          color: input.color,
        },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        beforeId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const cols = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId
        ? (cols.find((c) => c.id === input.beforeId)?.position ?? null)
        : null
      const next = input.afterId
        ? (cols.find((c) => c.id === input.afterId)?.position ?? null)
        : null
      const position = positionBetween(prev, next)
      const column = await ctx.prisma.kanbanColumn.update({
        where: { id: input.id },
        data: { position },
      })
      kanbanBus.emit(page.id, { kind: 'column.upserted', columnId: column.id })
      return column
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const cols = await ctx.prisma.kanbanColumn.findMany({
        where: { pageId: page.id },
        orderBy: { position: 'asc' },
        select: { id: true, position: true },
      })
      if (cols.length <= 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Нельзя удалить последнюю колонку доски',
        })
      }
      const remaining = cols.filter((c) => c.id !== input.id)
      const firstRemaining = remaining[0]
      if (!firstRemaining) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Колонка не найдена',
        })
      }
      await ctx.prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { columnId: input.id },
          data: { columnId: firstRemaining.id },
        })
        await tx.kanbanColumn.delete({ where: { id: input.id } })
      })
      kanbanBus.emit(page.id, { kind: 'column.deleted', columnId: input.id })
      return { ok: true as const, reassignedTo: firstRemaining.id }
    }),
})
