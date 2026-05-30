import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageOwnership } from '../../helpers/page-access'
import { dateInput, positionBetween } from './helpers'
import { kanbanBus } from '../../realtime/kanban-bus'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const sprintRouter = router({
  create: protectedProcedure
    .input(domain.createSprintInput)
    .mutation(async ({ ctx, input }) => {
      const sprint = await mapDomain(() => domainSvc.kanban.createSprint(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: sprint.id })
      return sprint
    }),

  update: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().nullable().optional(),
        startDate: dateInput,
        endDate: dateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.pageId)
      const sprint = await ctx.prisma.sprint.update({
        where: { id: input.id, pageId: page.id },
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
    .input(domain.sprintIdInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domainSvc.kanban.activateSprint(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.id })
      return res
    }),

  complete: protectedProcedure
    .input(domain.completeSprintInput)
    .mutation(async ({ ctx, input }) => {
      const res = await mapDomain(() => domainSvc.kanban.completeSprint(ctx.user.id, input))
      kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.id })
      if (input.moveUndoneTo) kanbanBus.emit(input.pageId, { kind: 'sprint.upserted', sprintId: input.moveUndoneTo })
      return res
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
      const page = await assertPageOwnership(ctx, input.pageId)
      const { count } = await ctx.prisma.sprint.deleteMany({
        where: { id: input.id, pageId: page.id },
      })
      if (count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Спринт не найден' })
      }
      kanbanBus.emit(page.id, { kind: 'sprint.deleted', sprintId: input.id })
      return { ok: true as const }
    }),
})
