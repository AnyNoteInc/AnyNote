import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

// Source-level reads. The view-model shape returned by `getByPage`
// (source + views + properties + rows + systemTitleProperty) is the single shape
// consumed by the renderer, table view, item modal, and embedded database node.
export const sourceRouter = router({
  getByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.getByPage(ctx.user.id, input.pageId))
    }),

  // Idempotently provision a source for a legacy DATABASE page that has none.
  // The renderer's "Создать базу" fallback calls this; a no-op if one exists.
  repairSource: protectedProcedure
    .input(domain.repairSourceInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.repairSource(ctx.user.id, input.pageId))
    }),
})
