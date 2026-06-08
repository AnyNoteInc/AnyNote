import { z } from 'zod'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess } from '../../helpers/page-access'
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
})
