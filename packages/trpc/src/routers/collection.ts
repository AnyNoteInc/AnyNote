import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import { assertWorkspaceMember } from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

export const collectionRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.collections.listForUser(input.workspaceId, ctx.user.id))
    }),

  getById: protectedProcedure
    .input(z.object({ collectionId: z.string().uuid(), workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const collection = await ctx.prisma.collection.findFirst({
        where: { id: input.collectionId, workspaceId: input.workspaceId },
        select: {
          id: true,
          workspaceId: true,
          kind: true,
          title: true,
          icon: true,
          color: true,
          ownerId: true,
          homePageId: true,
        },
      })
      if (!collection) throw new TRPCError({ code: 'NOT_FOUND', message: 'Коллекция не найдена' })
      // PERSONAL collections are private to their owner
      if (collection.kind === 'PERSONAL' && collection.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Коллекция не найдена' })
      }
      return collection
    }),

  update: protectedProcedure
    .input(domain.updateCollectionInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.collections.update(ctx.user.id, input))
    }),

  reorder: protectedProcedure
    .input(domain.reorderCollectionsInput)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.collections.reorder(ctx.user.id, input))
    }),
})
