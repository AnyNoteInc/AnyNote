import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { auth, withVerificationResendContext } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'

const ThemeSchema = z.enum(['light', 'dark', 'system'])

export const userRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.userPreference.findUnique({
      where: { userId: ctx.user.id },
    })
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
