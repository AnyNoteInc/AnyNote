import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const cellRouter = router({
  // The domain validates the raw value against the property type (and option set).
  // DATE values arrive via the `dateValue` field which the DTO coerces with
  // z.preprocess — the browser tRPC client has no superjson, so Date is sent as a
  // string and re-parsed here (Phase 2 gotcha).
  updateValue: protectedProcedure
    .input(domain.updateCellValueInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.updateCellValue(ctx.user.id, input))
    }),
})
