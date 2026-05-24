import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { router, protectedProcedure } from '../trpc'
import { assertCanManageShare } from '../helpers/page-access'

function newShareId(): string {
  return randomBytes(32).toString('hex') // 64 hex chars, 256-bit entropy
}

const userSelect = { id: true, firstName: true, lastName: true, email: true, image: true } as const

const shareSelect = {
  id: true,
  shareId: true,
  access: true,
  linkRole: true,
  users: { select: { role: true, user: { select: userSelect } }, orderBy: { createdAt: 'asc' as const } },
} as const

export const pageShareRouter = router({
  // Read-only: never creates a row (so the toolbar manage-probe stays side-effect-free).
  get: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      const owner = page.createdById
        ? await ctx.prisma.user.findUnique({ where: { id: page.createdById }, select: userSelect })
        : null
      return { share, owner, canManage: true }
    }),

  // Lazy create-or-return; called when the dialog opens (spec: lazy on dialog open).
  ensure: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const existing = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      if (existing) return existing
      return ctx.prisma.pageShare.create({
        data: { pageId: input.pageId, shareId: newShareId(), createdById: ctx.user.id },
        select: shareSelect,
      })
    }),
})
