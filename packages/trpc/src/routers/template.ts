import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import { assertWorkspaceMember, assertPageAccess } from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

// ── Router ───────────────────────────────────────────────────────────────────

export const templateRouter = router({
  // Search workspace + global templates by query. Page-type fallback (empty
  // query → show creatable types) lives in the UI; this only returns templates.
  search: protectedProcedure
    .input(domain.searchTemplatesInput)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.templates.search(ctx.user.id, input))
    }),

  // For a future workspace-template management page.
  listByWorkspace: protectedProcedure
    .input(domain.listWorkspaceTemplatesInput)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.templates.listByWorkspace(ctx.user.id, input))
    }),

  // For a future global template gallery. Visible to any authenticated user.
  listGlobal: protectedProcedure.query(async () => {
    return mapDomain(() => domainSvc.templates.listGlobal())
  }),

  createFromPage: protectedProcedure
    .input(domain.createTemplateFromPageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      // Gate billing against the page's real workspace, not the client-supplied
      // workspaceId (the domain re-checks they match). This avoids running the
      // plan limit on the wrong workspace when the two disagree.
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domainSvc.templates.createFromPage(ctx.user.id, input))
    }),

  createPageFromTemplate: protectedProcedure
    .input(domain.createPageFromTemplateInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.templates.createPageFromTemplate(ctx.user.id, input))
    }),

  update: protectedProcedure
    .input(domain.updateTemplateInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.templates.update(ctx.user.id, input))
    }),

  delete: protectedProcedure
    .input(domain.deleteTemplateInput)
    .mutation(async ({ ctx, input }): Promise<{ count: number }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.templates.delete(ctx.user.id, input))
    }),
})
