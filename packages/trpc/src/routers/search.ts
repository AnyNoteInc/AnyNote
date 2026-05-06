import { Prisma, type PrismaClient } from '@repo/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { searchPg, searchQdrant, type SearchResultItem } from '../services/page-search'
import { protectedProcedure, router } from '../trpc'

async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  return member
}

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

      const [pg, qdrant] = await Promise.allSettled([
        searchPg(ctx.prisma, input.workspaceId, input.query),
        searchQdrant(ctx.prisma, input.workspaceId, input.query),
      ])

      if (pg.status === 'rejected') throw pg.reason
      if (pg.value.length > 0) return pg.value
      return qdrant.status === 'fulfilled' ? qdrant.value : []
    }),

  history: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ input, ctx }): Promise<HistoryItem[]> => {
        await assertWorkspaceMember(ctx, input.workspaceId)

        const rows = await ctx.prisma.searchHistory.findMany({
          where: { userId: ctx.user.id, workspaceId: input.workspaceId },
          orderBy: { lastVisitedAt: 'desc' },
          take: HISTORY_LIMIT_DISPLAYED * 2,
          include: {
            page: {
              select: { id: true, title: true, icon: true, deletedAt: true, archived: true },
            },
          },
        })
        const liveRows = rows.filter(
          (row) => row.page.deletedAt === null && row.page.archived === false,
        )
        const pageIds = liveRows.map((row) => row.pageId)
        const favorites = await ctx.prisma.favoritePage.findMany({
          where: { userId: ctx.user.id, pageId: { in: pageIds } },
          select: { pageId: true },
        })
        const favoritePageIds = new Set(favorites.map((favorite) => favorite.pageId))

        return liveRows.slice(0, HISTORY_LIMIT_DISPLAYED).map((row) => ({
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
          if (err instanceof Error && (err as Error & { code?: string }).code === 'P2003') return
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
