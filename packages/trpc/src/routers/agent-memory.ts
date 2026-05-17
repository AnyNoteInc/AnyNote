import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

import { router, protectedProcedure } from '../trpc'

type RoleAllowed = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'

const READERS: RoleAllowed[] = ['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']

async function assertRole(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
  allowed: RoleAllowed[],
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role as RoleAllowed)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return member
}

export const agentMemoryRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, READERS)
      return ctx.prisma.workspaceAgentMemory.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { scope: 'WORKSPACE' },
            { scope: 'USER', userId: ctx.user.id },
          ],
        },
        orderBy: { updatedAt: 'desc' },
      })
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.workspaceAgentMemory.findUnique({
        where: { id: input.id },
      })
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
      const isAuthor = row.userId === ctx.user.id
      if (!isAuthor) {
        // Author may always delete their own USER-scope rows.
        // Otherwise, require OWNER role on the workspace.
        const member = await ctx.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: row.workspaceId, userId: ctx.user.id } },
        })
        if (!member || member.role !== 'OWNER') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
        }
      }
      await ctx.prisma.workspaceAgentMemory.delete({ where: { id: input.id } })
      return { ok: true as const }
    }),
})
