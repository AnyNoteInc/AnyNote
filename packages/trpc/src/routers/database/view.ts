import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../../trpc'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { domain as domainSvc } from '../../domain'

// Walk a ProseMirror doc JSON looking for an `embeddedDatabase` node whose
// `attrs.viewId` matches. The doc is an arbitrarily nested `{ type, attrs,
// content: [...] }` tree, so a Prisma JSON-path filter can't reach the node at
// any depth — we pre-narrow candidate pages with a cheap `content::text LIKE`
// raw query, then confirm the reference structurally in JS here.
function contentReferencesView(node: unknown, viewId: string): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => contentReferencesView(child, viewId))
  }
  if (node !== null && typeof node === 'object') {
    const obj = node as { type?: unknown; attrs?: { viewId?: unknown }; content?: unknown }
    if (obj.type === 'embeddedDatabase' && obj.attrs?.viewId === viewId) return true
    if (obj.content !== undefined) return contentReferencesView(obj.content, viewId)
  }
  return false
}

export const viewRouter = router({
  list: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.listViews(ctx.user.id, input.pageId))
    }),

  create: protectedProcedure
    .input(domain.createViewInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.createView(ctx.user.id, input))
    }),

  // `settings` is validated against the typed `viewSettingsSchema` (filters /
  // sorts / groupBy / visibleProperties / layout) by `updateViewInput`, so a
  // malformed filter (e.g. an unknown operator) is rejected with a zod error
  // before reaching the domain.
  update: protectedProcedure
    .input(domain.updateViewInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.updateView(ctx.user.id, input))
    }),

  duplicate: protectedProcedure
    .input(domain.duplicateViewInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.database.duplicateView(ctx.user.id, input))
    }),

  // The domain `deleteView` already blocks deleting the last remaining view.
  // ADDITIONALLY, block deleting a view that an `embeddedDatabase` editor block
  // pins via `attrs.viewId` — removing it out from under the embed would leave a
  // dangling reference. We scope candidate TEXT pages to the database's workspace
  // and pre-narrow with a `content::text LIKE` raw query (Prisma's
  // `string_contains` only matches string-scalar JSON, not the doc-object content
  // here), then confirm the reference structurally in JS.
  delete: protectedProcedure
    .input(domain.viewIdInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageEditAccess(ctx, input.pageId)
      const candidates = await ctx.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "pages"
        WHERE "workspace_id" = ${page.workspaceId}::uuid
          AND "type" = 'TEXT'
          AND "deleted_at" IS NULL
          AND "content"::text LIKE ${`%${input.id}%`}
      `
      if (candidates.length > 0) {
        const pages = await ctx.prisma.page.findMany({
          where: { id: { in: candidates.map((c) => c.id) } },
          select: { content: true },
        })
        if (pages.some((p) => contentReferencesView(p.content, input.id))) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Представление используется во встроенном блоке',
          })
        }
      }
      return mapDomain(() => domainSvc.database.deleteView(ctx.user.id, input))
    }),
})
