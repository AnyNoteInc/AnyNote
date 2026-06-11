import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

export async function assertMember(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { workspaceId: true },
  })
  if (!m) throw new ForbiddenException('No access to workspace')
  // Active membership = member row + no block row. Inline one-liner mirror of
  // @repo/domain `PeopleService.assertNotBlocked` (engines keeps raw prisma here).
  const blocked = await prisma.workspaceBlockedUser.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  })
  if (blocked) throw new ForbiddenException('Доступ заблокирован администратором')
}
