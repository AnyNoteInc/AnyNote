import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

// Page-level (row-level) access rules + the structure lock. These constrain the
// SERVER-SIDE row visibility/edit boundary — distinct from cosmetic column
// visibility. The domain is the single authority: the tRPC layer only gates
// workspace membership (read) / edit access (write); `assertCanEditStructure`
// inside the domain is what blocks a plain EDITOR (managing rules + locking is a
// structure operation). All row read/mutation procedures already pass
// `ctx.user.id`, so the domain resolver enforces the rules end-to-end.
export const accessRouter = router({
  listRules: protectedProcedure
    .input(domain.listAccessRulesInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listAccessRules(ctx.user.id, input))
    }),

  createRule: protectedProcedure
    .input(domain.createAccessRuleInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.createAccessRule(ctx.user.id, input))
    }),

  updateRule: protectedProcedure
    .input(domain.updateAccessRuleInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.updateAccessRule(ctx.user.id, input))
    }),

  deleteRule: protectedProcedure
    .input(domain.deleteAccessRuleInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.deleteAccessRule(ctx.user.id, input))
    }),

  setStructureLocked: protectedProcedure
    .input(domain.setStructureLockedInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.setStructureLocked(ctx.user.id, input))
    }),
})
