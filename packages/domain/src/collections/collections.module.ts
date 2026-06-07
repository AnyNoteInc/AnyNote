import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { CollectionRepository } from './repositories/collections.repository.ts'
import { CollectionService } from './services/collections.service.ts'
import { COLLECTIONS } from './collections.tokens.ts'

export const collectionsModule = new ContainerModule(({ bind }) => {
  bind(COLLECTIONS.Repository).toResolvedValue(
    (uow) => new CollectionRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(COLLECTIONS.Service).toResolvedValue(
    (repo, uow) => new CollectionService(repo as CollectionRepository, uow as UnitOfWork),
    [COLLECTIONS.Repository, SHARED.UnitOfWork],
  )
})
