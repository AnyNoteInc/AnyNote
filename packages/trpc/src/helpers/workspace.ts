import type { PrismaClient } from '@repo/db'
import { assertWorkspaceMembership as assertWorkspaceMembershipDomain } from '@repo/domain'
import { mapDomain } from './map-domain'

export function assertWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
) {
  return mapDomain(() => assertWorkspaceMembershipDomain(prisma, userId, workspaceId))
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.prisma, ctx.user.id, workspaceId)
}
