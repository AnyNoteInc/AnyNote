import { forbidden } from '../../shared/errors.ts'
import type { WorkspaceRepository } from '../repositories/workspace.repository.ts'
import type { WorkspaceMembershipDto } from '../dto/workspace.dto.ts'

export class WorkspaceService {
  constructor(private readonly repo: WorkspaceRepository) {}

  async assertMembership(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembershipDto> {
    const membership = await this.repo.findMembership(actorUserId, workspaceId)
    if (!membership) throw forbidden('Вы не являетесь участником воркспейса')
    return membership
  }
}
