import { peopleError } from '../../people/index.ts'
import { forbidden } from '../../shared/errors.ts'
import type { WorkspaceRepository } from '../repositories/workspace.repository.ts'
import type { WorkspaceMembershipDto } from '../dto/workspace.dto.ts'

export class WorkspaceService {
  private readonly repo: WorkspaceRepository
  constructor(repo: WorkspaceRepository) {
    this.repo = repo
  }

  /**
   * Active membership assertion (spec §3 `assertActiveMembership`): the user
   * must hold a member row AND no `workspace_blocked_users` row. Every caller
   * funnelling through here (tRPC `assertWorkspaceMember`, domain services)
   * inherits workspace-block denial. Canonical block semantics live in
   * `PeopleService.isWorkspaceBlocked`/`assertNotBlocked`.
   */
  async assertMembership(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipDto> {
    const membership = await this.repo.findMembership(actorUserId, workspaceId)
    if (!membership) throw forbidden('Вы не являетесь участником воркспейса')
    if (await this.repo.findBlock(workspaceId, actorUserId)) throw peopleError('USER_BLOCKED')
    return membership
  }
}
