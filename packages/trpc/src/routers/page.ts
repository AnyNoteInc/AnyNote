import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import {
  assertWorkspaceMember,
  assertPageAccess,
  resolveMemberOrPageGrant,
} from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'
import { pageShareRouter } from './page-share'
import { pageHistoryRouter } from './page-history'

// ── Router ───────────────────────────────────────────────────────────────────

export const pageRouter = router({
  share: pageShareRouter,
  history: pageHistoryRouter,
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const select = {
        id: true,
        workspaceId: true,
        parentId: true,
        type: true,
        ownership: true,
        title: true,
        icon: true,
        coverUrl: true,
        coverPreset: true,
        content: true,
        contentYjs: true,
        collectionId: true,
        archivedAt: true,
        prevPageId: true,
        deletedAt: true,
        createdById: true,
        updatedById: true,
        createdAt: true,
        updatedAt: true,
      } as const
      // Member arm — semantics unchanged (visibility predicate hides other
      // members' PERSONAL pages), now block-aware (people spec §7.1).
      const memberPage = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: {
            members: { some: { userId: ctx.user.id } },
            blockedUsers: { none: { userId: ctx.user.id } },
          },
          AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
        },
        select,
      })
      if (memberPage) {
        return {
          ...memberPage,
          contentYjs: memberPage.contentYjs
            ? Buffer.from(memberPage.contentYjs).toString('base64')
            : null,
        }
      }
      // Guest arm (people spec §3): a PageShareUser grant on this page or any
      // ancestor admits the holder read-side. Trashed pages never resolve for
      // guests. Blocked users get FORBIDDEN from the resolve; everyone else
      // without access keeps the object-hiding NOT_FOUND.
      const page = await ctx.prisma.page.findFirst({
        where: { id: input.id, deletedAt: null },
        select,
      })
      if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
      const access = await resolveMemberOrPageGrant(ctx, page.workspaceId, page.id)
      // kind === 'member' here means the member arm above rejected the page on
      // visibility (someone else's PERSONAL page) — members keep NOT_FOUND.
      if (!access || access.kind !== 'guest') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
      }
      return {
        ...page,
        contentYjs: page.contentYjs ? Buffer.from(page.contentYjs).toString('base64') : null,
      }
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          archivedAt: null,
          deletedAt: null,
          isTemplate: null,
          AND: [domain.buildPageVisibilityWhere(ctx.user.id), domain.excludeDatabaseRowPages()],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          title: true,
          icon: true,
          parentId: true,
          prevPageId: true,
          collectionId: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  listShared: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          archivedAt: null,
          share: { users: { some: { userId: ctx.user.id } } },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true, icon: true },
      })
    }),

  create: protectedProcedure
    .input(domain.createPageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.create(ctx.user.id, input))
    }),

  // Structural page writes stay MEMBER-only this phase (people spec §3): an
  // EDITOR-grant guest edits page CONTENT through yjs collaboration, but tRPC
  // rename/update/move/delete are member territory. The explicit member assert
  // here turns a grant-holding guest's attempt into an honest FORBIDDEN (the
  // domain re-checks page-level access against the PAGE's workspace anyway).
  rename: protectedProcedure
    .input(domain.renamePageInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        await requireWritableWorkspace(input.workspaceId)
        return mapDomain(() => domainSvc.pages.rename(ctx.user.id, input))
      },
    ),

  update: protectedProcedure
    .input(domain.updatePageInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        await requireWritableWorkspace(input.workspaceId)
        return mapDomain(() => domainSvc.pages.update(ctx.user.id, input))
      },
    ),

  archive: protectedProcedure
    .input(domain.archivePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.archive(ctx.user.id, input))
    }),

  unarchive: protectedProcedure
    .input(domain.unarchivePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.unarchive(ctx.user.id, input))
    }),

  listArchived: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: null,
          archivedAt: { not: null },
          AND: [domain.buildPageVisibilityWhere(ctx.user.id), domain.excludeDatabaseRowPages()],
        },
        orderBy: { archivedAt: 'desc' },
        select: {
          id: true,
          title: true,
          icon: true,
          parentId: true,
          archivedAt: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  softDelete: protectedProcedure
    .input(domain.softDeletePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.softDelete(ctx.user.id, input))
    }),

  restore: protectedProcedure
    .input(domain.restorePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.restore(ctx.user.id, input))
    }),

  hardDelete: protectedProcedure
    .input(domain.hardDeletePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.hardDelete(ctx.user.id, input))
    }),

  listTrashed: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: { not: null },
          isTemplate: null,
          AND: [domain.excludeDatabaseRowPages()],
        },
        orderBy: { deletedAt: 'desc' },
        select: {
          id: true,
          title: true,
          icon: true,
          parentId: true,
          deletedAt: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  emptyTrash: protectedProcedure
    .input(domain.emptyTrashInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.emptyTrash(ctx.user.id, input))
    }),

  move: protectedProcedure
    .input(domain.movePageInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domainSvc.pages.move(ctx.user.id, input))
    }),

  moveToCollection: protectedProcedure
    .input(domain.moveToCollectionInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.moveToCollection(ctx.user.id, input))
    }),

  duplicate: protectedProcedure
    .input(domain.duplicatePageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domainSvc.pages.duplicate(ctx.user.id, input))
    }),

  reorder: protectedProcedure
    .input(domain.reorderPageInput)
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: { id: input.pageId, deletedAt: null },
        select: { workspaceId: true },
      })
      if (page) await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domainSvc.pages.reorder(ctx.user.id, input))
    }),

  addFavorite: protectedProcedure
    .input(domain.addFavoriteInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domainSvc.favorites.add(ctx.user.id, input))
    }),

  removeFavorite: protectedProcedure
    .input(domain.removeFavoriteInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      // domain.favorites.remove returns { count } — tRPC callers expect { pageId },
      // so we delegate and then return the pageId ourselves.
      return mapDomain(async () => {
        await domainSvc.favorites.remove(ctx.user.id, input)
        return { pageId: input.pageId }
      })
    }),

  reorderFavorites: protectedProcedure
    .input(domain.reorderFavoritesInput)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.favorites.reorder(ctx.user.id, input))
    }),

  listFavorites: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const favorites = await ctx.prisma.favoritePage.findMany({
        where: {
          userId: ctx.user.id,
          page: {
            workspaceId: input.workspaceId,
            deletedAt: null,
            isTemplate: null,
          },
        },
        include: {
          page: {
            select: {
              id: true,
              title: true,
              icon: true,
              parentId: true,
            },
          },
        },
        orderBy: { position: 'asc' },
      })
      return favorites.map((f) => f.page)
    }),
})
