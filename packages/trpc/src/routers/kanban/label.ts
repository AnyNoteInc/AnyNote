import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { KANBAN_LABEL_COLOR_HEXES } from '@repo/ui/lib/kanban-colors'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

function assertColor(color: string) {
  if (!KANBAN_LABEL_COLOR_HEXES.has(color)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Цвет не входит в палитру',
    })
  }
}

export const labelRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        name: z.string().min(1).max(80),
        color: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertColor(input.color)
      const page = await assertPageOwnership(ctx, input.pageId)
      const existing = await ctx.prisma.kanbanLabel.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const row = await ctx.prisma.kanbanLabel.create({
        data: {
          pageId: page.id,
          name: input.name,
          color: input.color,
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return row
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        name: z.string().min(1).max(80).optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.color !== undefined) assertColor(input.color)
      const page = await assertPageOwnership(ctx, input.pageId)
      const row = await ctx.prisma.kanbanLabel.update({
        where: { id: input.id },
        data: { name: input.name, color: input.color },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
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
      const rows = await ctx.prisma.kanbanLabel.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId
        ? (rows.find((r) => r.id === input.beforeId)?.position ?? null)
        : null
      const next = input.afterId
        ? (rows.find((r) => r.id === input.afterId)?.position ?? null)
        : null
      const row = await ctx.prisma.kanbanLabel.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return row
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      await ctx.prisma.kanbanLabel.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'settings.upserted', entity: 'label' })
      return { ok: true as const }
    }),
})
