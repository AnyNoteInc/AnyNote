import { z } from 'zod'

import { router, protectedProcedure } from '../trpc'
import { assertActivePageEditAccess } from '../helpers/page-access'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

// History (list / preview / restore) requires EDIT-level page access. Snapshot
// content is never returned after a user loses access — assertPageEditAccess
// re-checks workspace membership + role on every call.
export const pageHistoryRouter = router({
  listRevisions: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertActivePageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.pageHistory.listRevisions(input.pageId))
    }),

  getRevisionPreview: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), revisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertActivePageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.pageHistory.getRevisionPreview(input.pageId, input.revisionId))
    }),

  restoreRevision: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), revisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertActivePageEditAccess(ctx, input.pageId)
      return mapDomain(() =>
        domainSvc.pageHistory.restoreRevision({
          pageId: input.pageId,
          revisionId: input.revisionId,
          actorId: ctx.user.id,
        }),
      )
    }),
})
