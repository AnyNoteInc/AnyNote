import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { WorkspaceRepository } from './repositories/workspace.repository.ts'
import { WorkspaceService } from './services/workspace.service.ts'
import { WORKSPACE } from './workspace.tokens.ts'

export const workspaceModule = new ContainerModule(({ bind }) => {
  bind(WORKSPACE.Repository).toResolvedValue(
    (uow) => new WorkspaceRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(WORKSPACE.Service).toResolvedValue(
    (repo) => new WorkspaceService(repo as WorkspaceRepository),
    [WORKSPACE.Repository],
  )
})
