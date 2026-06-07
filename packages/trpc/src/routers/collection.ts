import { z } from 'zod'

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
