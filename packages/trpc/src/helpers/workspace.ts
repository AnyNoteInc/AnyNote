import type { PrismaClient } from '@repo/db'
import { TRPCError } from '@trpc/server'

export async function assertWorkspaceMember(
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
