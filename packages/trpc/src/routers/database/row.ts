import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const rowRouter = router({
  // Optional `query` filters rows by title / cell content (handled in the domain repo).
  list: protectedProcedure
    .input(domain.listRowsInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listRows(ctx.user.id, input))
    }),

  // Creates a real item Page (child TEXT page of the DATABASE page) + a row bridge.
  create: protectedProcedure
    .input(domain.createRowInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.createRow(ctx.user.id, input))
    }),

  // Writes the row's item Page.title / icon.
  update: protectedProcedure
    .input(domain.updateRowInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.updateRowTitle(ctx.user.id, input))
    }),

  delete: protectedProcedure
    .input(domain.rowIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.deleteRow(ctx.user.id, input))
    }),

  restore: protectedProcedure
    .input(domain.rowIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.restoreRow(ctx.user.id, input))
    }),

  reorder: protectedProcedure
    .input(domain.reorderRowsInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.reorderRows(ctx.user.id, input))
    }),
})
