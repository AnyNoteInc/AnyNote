import type { PrismaClient } from '@repo/db'

import { domain } from '../domain'
import { mapDomain } from './map-domain'

// Ctx-bound (domain-free) membership helpers live in ./membership — re-exported
// here so both chokepoints share one import site. NOTE: importing THIS module
// drags in the domain container (`../domain` → `@repo/db` singleton); routers
// covered by mocked-prisma tests should import from './membership' directly.
export {
  BLOCKED_MESSAGE,
  MEMBER_ROLES,
  assertNotBlocked,
  assertRole,
  type WorkspaceRole,
} from './membership'

export function assertWorkspaceMembership(userId: string, workspaceId: string) {
  return mapDomain(() => domain.workspace.assertMembership(userId, workspaceId))
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.user.id, workspaceId)
}
