import type { PrismaClient } from '@repo/db'
import { domain } from '../domain'
import { mapDomain } from './map-domain'

export function assertWorkspaceMembership(userId: string, workspaceId: string) {
  return mapDomain(() => domain.workspace.assertMembership(userId, workspaceId))
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.user.id, workspaceId)
}
