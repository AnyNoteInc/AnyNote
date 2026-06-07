import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import {
  assertWorkspaceMember,
  assertPageAccess,
} from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'
import { pageShareRouter } from './page-share'

// ── Router ───────────────────────────────────────────────────────────────────

export const pageRouter = router({
  share: pageShareRouter,
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
        select: {
          id: true,
          workspaceId: true,
          parentId: true,
          type: true,
          ownership: true,
          title: true,
          icon: true,
          content: true,
          contentYjs: true,
          archivedAt: true,
          prevPageId: true,
          deletedAt: true,
          createdById: true,
          updatedById: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
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
          isTemplateBacking: false,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          title: true,
          icon: true,
          parentId: true,
          prevPageId: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  create: protectedProcedure
    .input(domain.createPageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.pages.create(ctx.user.id, input))
    }),

  rename: protectedProcedure
    .input(domain.renamePageInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
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
        await requireWritableWorkspace(input.workspaceId)
        return mapDomain(() => domainSvc.pages.update(ctx.user.id, input))
      },
    ),

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
          isTemplateBacking: false,
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
            isTemplateBacking: false,
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
