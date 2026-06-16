import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { auth, withVerificationResendContext } from '@repo/auth'
import * as domain from '@repo/domain'

import { router, protectedProcedure } from '../trpc'

const ThemeSchema = z.enum(['light', 'dark', 'system'])

export const userRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
    })
  }),

  // GitHub-style activity: per-day counts of the caller's own page edits
  // (PageRevision rows where actor_id = caller) over the last 12 months, plus a
  // short list of the most recent actions for a feed.
  //
  // Tenant-boundary: BOTH queries are gated by current workspace membership, so
  // an ex-member can no longer see page titles or edit counts from a workspace
  // they have LEFT. Soft-deleted pages are excluded from both surfaces.
  //
  // The grid raw SQL gates on membership + soft-delete only (per-day counts, no
  // titles), so it deliberately does NOT replicate buildPageVisibilityWhere's
  // PERSONAL/share nuances — membership is the tenant boundary that matters for
  // a leak. recentActions (which DOES expose titles) gets the full visibility
  // predicate via buildPageVisibilityWhere.
  activity: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.prisma.$queryRaw<{ day: Date | string; count: bigint }[]>`
      SELECT date_trunc('day', pr.created_at)::date AS day, count(*)::bigint AS count
      FROM page_revisions pr
      JOIN pages pg ON pg.id = pr.page_id
      WHERE pr.actor_id = ${ctx.user.id}::uuid
        AND pg.deleted_at IS NULL
        AND pr.created_at >= now() - interval '12 months'
        AND EXISTS (
          SELECT 1 FROM workspace_members wm
          WHERE wm.workspace_id = pg.workspace_id
            AND wm.user_id = ${ctx.user.id}::uuid
        )
      GROUP BY day
      ORDER BY day
    `
    const grid = rows.map((r) => ({
      date: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }))

    const recentRaw = await ctx.prisma.pageRevision.findMany({
      where: {
        actorId: ctx.user.id,
        page: {
          deletedAt: null,
          workspace: { members: { some: { userId: ctx.user.id } } },
          AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        action: true,
        createdAt: true,
        page: { select: { id: true, title: true, type: true } },
      },
    })
    const recentActions = recentRaw.map((r) => ({
      action: r.action,
      createdAt: r.createdAt,
      pageId: r.page.id,
      pageTitle: r.page.title,
      pageType: r.page.type,
    }))

    return { grid, recentActions }
  }),

  // Search registered platform users to grant page access to people who are
  // NOT workspace members. Anti-enumeration: min 3 chars, prefix match,
  // capped results, display-only fields, excludes the caller.
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = input.query.trim()
      if (q.length < 3) return []
      return ctx.prisma.user.findMany({
        where: {
          id: { not: ctx.user.id },
          OR: [
            { email: { startsWith: q, mode: 'insensitive' } },
            { firstName: { startsWith: q, mode: 'insensitive' } },
            { lastName: { startsWith: q, mode: 'insensitive' } },
          ],
        },
        take: 8,
        orderBy: { email: 'asc' },
        select: { id: true, firstName: true, lastName: true, email: true, image: true },
      })
    }),

  setTheme: protectedProcedure
    .input(z.object({ theme: ThemeSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, theme: input.theme },
        update: { theme: input.theme },
      })
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(255),
        lastName: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { firstName: input.firstName, lastName: input.lastName },
      })
    }),

  listSessions: protectedProcedure.query(async ({ ctx }) => {
    // Never select `token` — it's the raw session secret.
    return ctx.prisma.session.findMany({
      where: { userId: ctx.user.id, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    })
  }),

  revokeSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      })
      if (!session || session.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      }
      await ctx.prisma.session.delete({ where: { id: input.sessionId } })
      return { ok: true }
    }),

  resendVerificationEmail: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.emailVerified) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email уже подтверждён',
      })
    }
    try {
      await withVerificationResendContext(() =>
        auth.api.sendVerificationEmail({
          body: { email: ctx.user.email },
          headers: ctx.headers,
        }),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось отправить письмо'
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })
    }
    return { ok: true }
  }),
})
