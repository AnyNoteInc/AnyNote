import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const typeRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        title: z.string().min(1).max(120),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const existing = await ctx.prisma.kanbanType.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const row = await ctx.prisma.kanbanType.create({
        data: {
          pageId: page.id,
          title: input.title,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        title: z.string().min(1).max(120).optional(),
        color: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const row = await ctx.prisma.kanbanType.update({
        where: { id: input.id },
        data: { title: input.title, color: input.color },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
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
      const rows = await ctx.prisma.kanbanType.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId
        ? (rows.find((r) => r.id === input.beforeId)?.position ?? null)
        : null
      const next = input.afterId
        ? (rows.find((r) => r.id === input.afterId)?.position ?? null)
        : null
      const row = await ctx.prisma.kanbanType.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return row
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      await ctx.prisma.kanbanType.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'type' })
      return { ok: true as const }
    }),
})
