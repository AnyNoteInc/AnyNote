import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { WorkspaceAccessDeniedError } from '../errors/mcp.errors.js'

@Injectable()
export class WorkspaceMemberGuard {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async assert(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    })
    if (!member) throw new WorkspaceAccessDeniedError(workspaceId, userId)
    // Active membership = member row + no block row (same semantics as
    // ../../api/auth/membership.ts assertMember and @repo/domain
    // PeopleService.assertNotBlocked); denial stays uniform.
    const blocked = await this.prisma.workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    })
    if (blocked) throw new WorkspaceAccessDeniedError(workspaceId, userId)
  }
}
