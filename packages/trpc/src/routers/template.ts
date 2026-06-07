import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import { assertWorkspaceMember, assertPageAccess } from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

// ── Router ───────────────────────────────────────────────────────────────────

export const templateRouter = router({
  // Marketplace listing: workspace section + popular + all, filtered by tag/query.
  listMarketplace: protectedProcedure
    .input(domain.listMarketplaceInput)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.templates.listMarketplace(ctx.user.id, input))
    }),

  // All curated tags — visible to any authenticated user (no workspace scope).
  listTags: protectedProcedure.query(async () => {
    return mapDomain(() => domainSvc.templates.listTags())
  }),

  // Procedure name kept as `getById` so the web client keeps working; it
  // delegates to the service's `getTemplate`.
  getById: protectedProcedure
    .input(domain.getTemplateInput)
    .query(async ({ ctx, input }) => {
      return mapDomain(() => domainSvc.templates.getTemplate(ctx.user.id, input))
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
      // The caller must be a member of *their own* workspace (input.workspaceId);
      // the domain's `update` does the real authz (creator-only canEdit) and, for
      // GLOBAL templates, re-checks against the system workspace it actually lives in.
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
