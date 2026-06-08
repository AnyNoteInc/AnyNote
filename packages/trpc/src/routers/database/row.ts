import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

export const rowRouter = router({
  // View-aware, paginated row fetch. The optional `viewId` selects the view whose
  // settings (filters/sorts/visibility) drive the server-side query; omitting it
  // falls back to default TABLE settings. Returns `{ rows, nextCursor }`; pass
  // `cursor` (the previous page's `nextCursor`) to page forward.
  list: protectedProcedure
    .input(domain.listRowsInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listRows(ctx.user.id, input))
    }),

  // Grouped rows for the BOARD layout: one bucket per the view's groupBy option
  // (plus a trailing null/empty bucket). No pagination — a focused board view is
  // bounded in practice.
  listGrouped: protectedProcedure
    .input(domain.listGroupedRowsInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listGroupedRows(ctx.user.id, input))
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

  setPosition: protectedProcedure
    .input(domain.setRowPositionInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.setRowPosition(ctx.user.id, input))
    }),
})
