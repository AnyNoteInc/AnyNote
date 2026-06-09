import { z } from 'zod'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const relationRouter = router({
  // Replace the full link set for a (rowId, propertyId) RELATION cell. The domain
  // validates the property is a configured RELATION, every target lives in the
  // same workspace, and syncs the back-relation mirror when one is configured.
  setRelationLinks: protectedProcedure
    .input(domain.setRelationLinksInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.setRelationLinks(ctx.user.id, input))
    }),

  // Candidate rows of a RELATION property's target source, for the link picker.
  // Read-access is enough (it lists rows of another source in the same workspace).
  listLinkableRows: protectedProcedure
    .input(domain.listLinkableRowsInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listLinkableRows(ctx.user.id, input))
    }),

  // Parse-only formula validation for the FORMULA settings editor. Reports only
  // SYNTAX errors (dangling operator, unbalanced parens, unterminated string);
  // runtime concerns (unknown prop/function) are deferred to compute-on-read, so
  // they validate as `{ valid: true }`. Pure — no DB access, no page guard needed.
  validateFormula: protectedProcedure
    .input(z.object({ expression: z.string() }))
    .query(({ input }) => domain.validateFormula(input.expression)),
})
