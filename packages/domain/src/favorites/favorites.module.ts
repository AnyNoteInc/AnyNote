import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { WORKSPACE } from '../workspace/index.ts'
import type { WorkspaceService } from '../workspace/index.ts'
import { FavoriteRepository } from './repositories/favorites.repository.ts'
import { FavoriteService } from './services/favorites.service.ts'
import { FAVORITES } from './favorites.tokens.ts'

export const favoritesModule = new ContainerModule(({ bind }) => {
  bind(FAVORITES.Repository).toResolvedValue(
    (uow) => new FavoriteRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(FAVORITES.Service).toResolvedValue(
    (repo, uow, workspace) =>
      new FavoriteService(
        repo as FavoriteRepository,
        uow as UnitOfWork,
        workspace as WorkspaceService,
      ),
    [FAVORITES.Repository, SHARED.UnitOfWork, WORKSPACE.Service],
  )
})
