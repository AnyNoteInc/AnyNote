import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const viewRouter = router({
  list: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listViews(ctx.user.id, input.pageId))
    }),

  create: protectedProcedure.input(domain.createViewInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.database.createView(ctx.user.id, input))
  }),

  // `settings` is validated against the typed `viewSettingsSchema` (filters /
  // sorts / groupBy / visibleProperties / layout) by `updateViewInput`, so a
  // malformed filter (e.g. an unknown operator) is rejected with a zod error
  // before reaching the domain.
  update: protectedProcedure.input(domain.updateViewInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.database.updateView(ctx.user.id, input))
  }),

  duplicate: protectedProcedure
    .input(domain.duplicateViewInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      const view = await ctx.prisma.databaseView.findFirst({
        where: { id: input.viewId, source: { pageId: input.pageId } },
        select: { type: true },
      })
      if (view?.type === 'FORM') {
        return mapDomain(() => domainSvc.databaseForms.duplicateByView(ctx.user.id, input))
      }
      return mapDomain(() => domainSvc.database.duplicateView(ctx.user.id, input))
    }),

  // The domain performs final structure authorization, source serialization,
  // embedded-view protection, FORM archive delegation, and the last-view check.
  delete: protectedProcedure.input(domain.viewIdInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.database.deleteView(ctx.user.id, input))
  }),
})
