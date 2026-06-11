import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { WorkspaceMembershipDto } from '../dto/workspace.dto.ts'

export class WorkspaceRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipDto | null> {
    const row = await this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!row) return null
    return { workspaceId: row.workspaceId, userId: row.userId, role: row.role }
  }

  /** Same shape as `PeopleRepository.findBlock` — one indexed lookup on the block table. */
  async findBlock(workspaceId: string, userId: string): Promise<{ id: string } | null> {
    return this.uow.client().workspaceBlockedUser.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    })
  }
}
