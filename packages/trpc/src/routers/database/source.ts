import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import {
  assertPageAccess,
  assertPageEditAccess,
  assertWorkspaceMember,
} from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

// Source-level reads. `getByPage` returns the database SCHEMA only
// (source + views + properties + systemTitleProperty) — rows are fetched
// separately and view-aware via `listRows` / `listGroupedRows`. The schema is
// the single shape consumed by the renderer, table view, item modal, and
// embedded database node to drive view tabs and column layout.
export const sourceRouter = router({
  getByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.getByPage(ctx.user.id, input.pageId))
    }),

  // Resolve a database by its SOURCE id (the embedded-database editor node
  // references a source, not a DATABASE page). We resolve the source's owning
  // page first so we can guard with `assertPageAccess` (consistent NOT_FOUND
  // for non-members) and return its `pageId` — the embed drives all mutations
  // (createRow, updateCellValue, …) through that DATABASE page id.
  getBySourceId: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const source = await ctx.prisma.databaseSource.findUnique({
        where: { id: input.sourceId },
        select: { pageId: true },
      })
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'База данных не найдена' })
      }
      await assertPageAccess(ctx, source.pageId)
      const view = await mapDomain(() => domainSvc.database.getByPage(ctx.user.id, source.pageId))
      return { pageId: source.pageId, view }
    }),

  // List every database SOURCE in a workspace ({ sourceId, pageId, title }) for the
  // RELATION/ROLLUP settings pickers (a relation target is another DATABASE page's
  // source). The property-settings dialog resolves a chosen source's schema via
  // `getBySourceId`. Title falls back to the owning page's title so the picker is
  // never blank. Read access is workspace membership.
  listSources: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const sources = await ctx.prisma.databaseSource.findMany({
        where: {
          workspaceId: input.workspaceId,
          page: { archivedAt: null, deletedAt: null },
        },
        select: { id: true, pageId: true, title: true, page: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      })
      return sources.map((s) => ({
        sourceId: s.id,
        pageId: s.pageId,
        title: s.title ?? s.page.title ?? null,
      }))
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
