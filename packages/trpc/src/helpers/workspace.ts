import type { PrismaClient } from '@repo/db'
import { TRPCError } from '@trpc/server'

export async function assertWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  return member
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.prisma, ctx.user.id, workspaceId)
}
