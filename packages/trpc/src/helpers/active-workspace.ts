import type { PrismaClient, Workspace } from '@repo/db'

// "Member" here means ACTIVE member: a workspace the user is blocked in must
// not resolve as their active workspace (canonical block semantics:
// `PeopleService.isWorkspaceBlocked` in @repo/domain).
async function isMember(prisma: PrismaClient, workspaceId: string, userId: string) {
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, workspace: { blockedUsers: { none: { userId } } } },
  })
  return member !== null
}

/**
 * Resolve the workspace the user should currently be scoped to.
 * Order: stored active (if still a member) -> default (if member) -> first
 * workspace by createdAt. Repairs the stored activeWorkspaceId when it falls
 * back. Returns null only when the user has no workspace at all.
 *
 * The active workspace is a default-scope HINT, never an authorization: every
 * tRPC procedure still asserts membership on the workspace it is given.
 */
export async function resolveActiveWorkspace(
  prisma: PrismaClient,
  userId: string,
): Promise<Workspace | null> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } })

  if (pref?.activeWorkspaceId && (await isMember(prisma, pref.activeWorkspaceId, userId))) {
    return prisma.workspace.findUnique({ where: { id: pref.activeWorkspaceId } })
  }

  let fallback: Workspace | null = null
  if (pref?.defaultWorkspaceId && (await isMember(prisma, pref.defaultWorkspaceId, userId))) {
    fallback = await prisma.workspace.findUnique({ where: { id: pref.defaultWorkspaceId } })
  }
  if (!fallback) {
    fallback = await prisma.workspace.findFirst({
      where: { members: { some: { userId } }, blockedUsers: { none: { userId } } },
      orderBy: { createdAt: 'asc' },
    })
  }
  if (!fallback) return null

  if (pref?.activeWorkspaceId !== fallback.id) {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: fallback.id },
      update: { activeWorkspaceId: fallback.id },
    })
  }
  return fallback
}
