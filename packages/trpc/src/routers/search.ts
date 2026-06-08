import { Prisma } from '@repo/db'
import * as domain from '@repo/domain'
import { z } from 'zod'

import { assertWorkspaceMember } from '../helpers/workspace'
import { searchPg, searchQdrant, type SearchResultItem } from '../services/page-search'
import { protectedProcedure, router } from '../trpc'

const HISTORY_LIMIT_DISPLAYED = 5
const HISTORY_LIMIT_STORED = 20

export type HistoryItem = {
  pageId: string
  title: string
  icon: string | null
  isFavorite: boolean
}

export const searchRouter = router({
  search: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), query: z.string().max(200) }))
    .query(async ({ input, ctx }): Promise<SearchResultItem[]> => {
      await assertWorkspaceMember(ctx, input.workspaceId)

      const pg = await searchPg(ctx.prisma, input.workspaceId, ctx.user.id, input.query)
      if (pg.length > 0) return pg
      try {
        return await searchQdrant(ctx.prisma, input.workspaceId, ctx.user.id, input.query)
      } catch {
        return []
      }
    }),

  history: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ input, ctx }): Promise<HistoryItem[]> => {
        await assertWorkspaceMember(ctx, input.workspaceId)

        const rows = await ctx.prisma.searchHistory.findMany({
          where: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
            page: {
              deletedAt: null,
              archivedAt: null,
              isTemplate: null,
              AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
            },
          },
          orderBy: { lastVisitedAt: 'desc' },
          take: HISTORY_LIMIT_DISPLAYED,
          include: {
            page: { select: { id: true, title: true, icon: true } },
          },
        })
        const pageIds = rows.map((row) => row.pageId)
        const favorites = await ctx.prisma.favoritePage.findMany({
          where: { userId: ctx.user.id, pageId: { in: pageIds } },
          select: { pageId: true },
        })
        const favoritePageIds = new Set(favorites.map((favorite) => favorite.pageId))

        return rows.map((row) => ({
          pageId: row.pageId,
          title: row.page.title ?? '',
          icon: row.page.icon,
          isFavorite: favoritePageIds.has(row.pageId),
        }))
      }),

    add: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), pageId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertWorkspaceMember(ctx, input.workspaceId)

        try {
          await ctx.prisma.searchHistory.upsert({
            where: {
              userId_workspaceId_pageId: {
                userId: ctx.user.id,
                workspaceId: input.workspaceId,
                pageId: input.pageId,
              },
            },
            create: {
              userId: ctx.user.id,
              workspaceId: input.workspaceId,
              pageId: input.pageId,
            },
            update: { lastVisitedAt: new Date() },
          })
          await ctx.prisma.$executeRaw`
            DELETE FROM "search_history"
            WHERE "user_id" = ${ctx.user.id}::uuid
              AND "workspace_id" = ${input.workspaceId}::uuid
              AND id NOT IN (
                SELECT id FROM "search_history"
                WHERE "user_id" = ${ctx.user.id}::uuid
                  AND "workspace_id" = ${input.workspaceId}::uuid
                ORDER BY "last_visited_at" DESC
                LIMIT ${HISTORY_LIMIT_STORED}
              )
          `
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') return
          throw err
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), pageId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        await ctx.prisma.searchHistory.deleteMany({
          where: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
            pageId: input.pageId,
          },
        })
      }),
  }),
})
