import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { endPosition, pageWorkspaceId, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'

export const sprintRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        startDate: z.date().nullable().optional(),
        endDate: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      const existing = await ctx.prisma.sprint.findMany({
        where: { pageId: page.id },
        select: { position: true },
      })
      const sprint = await ctx.prisma.sprint.create({
        data: {
          pageId: page.id,
          name: input.name,
          description: input.description ?? null,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          status: 'PLANNED',
          position: endPosition(existing),
        },
      })
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: sprint.id })
      return sprint
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().nullable().optional(),
        startDate: z.date().nullable().optional(),
        endDate: z.date().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      const sprint = await ctx.prisma.sprint.update({
        where: { id: input.id },
        data: {
          name: input.name,
          description: input.description,
          startDate: input.startDate,
          endDate: input.endDate,
        },
      })
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: sprint.id })
      return sprint
    }),

  activate: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      try {
        await ctx.prisma.$transaction(async (tx) => {
          await tx.sprint.updateMany({
            where: { pageId: page.id, status: 'ACTIVE', NOT: { id: input.id } },
            data: { status: 'PLANNED' },
          })
          await tx.sprint.update({
            where: { id: input.id },
            data: { status: 'ACTIVE' },
          })
        })
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code
        if (code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Активный спринт уже существует — попробуйте ещё раз',
          })
        }
        throw e
      }
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: input.id })
      return { ok: true as const }
    }),

  complete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      await ctx.prisma.sprint.update({
        where: { id: input.id },
        data: { status: 'COMPLETED' },
      })
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: input.id })
      return { ok: true as const }
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
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      const rows = await ctx.prisma.sprint.findMany({
        where: { pageId: page.id },
        select: { id: true, position: true },
      })
      const prev = input.beforeId
        ? (rows.find((r) => r.id === input.beforeId)?.position ?? null)
        : null
      const next = input.afterId
        ? (rows.find((r) => r.id === input.afterId)?.position ?? null)
        : null
      const sprint = await ctx.prisma.sprint.update({
        where: { id: input.id },
        data: { position: positionBetween(prev, next) },
      })
      kanbanBus.emit(page.id, { kind: 'sprint.upserted', sprintId: sprint.id })
      return sprint
    }),

  delete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(
        ctx,
        input.pageId,
        await pageWorkspaceId(ctx, input.pageId),
      )
      await ctx.prisma.sprint.delete({ where: { id: input.id } })
      kanbanBus.emit(page.id, { kind: 'sprint.deleted', sprintId: input.id })
      return { ok: true as const }
    }),
})
