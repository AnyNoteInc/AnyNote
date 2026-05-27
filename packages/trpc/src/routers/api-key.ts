import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { computeExpiresAt, generateApiKey, type ApiKeyTtl } from '../services/api-key'

const TtlSchema = z.enum(['7d', '30d', '90d', '1y', 'never']) satisfies z.ZodType<ApiKeyTtl>

export const apiKeyRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.apiKey.findMany({
      where: { userId: ctx.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        keyLastFour: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    }),
  ),

  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100), ttl: TtlSchema }))
    .mutation(async ({ ctx, input }) => {
      const { fullKey, prefix, lastFour, hash } = generateApiKey()
      const expiresAt = computeExpiresAt(input.ttl)
      const row = await ctx.prisma.apiKey.create({
        data: {
          userId: ctx.user.id,
          name: input.name,
          keyHash: hash,
          keyPrefix: prefix,
          keyLastFour: lastFour,
          expiresAt,
        },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          keyLastFour: true,
          createdAt: true,
          expiresAt: true,
        },
      })
      return { ...row, fullKey }
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.prisma.apiKey.updateMany({
        where: { id: input.id, userId: ctx.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      if (r.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true as const }
    }),
})
