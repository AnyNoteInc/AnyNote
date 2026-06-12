import { ContainerModule } from 'inversify'

import { COLLECTIONS } from '../collections/index.ts'
import type { CollectionService } from '../collections/index.ts'
import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { IdentityRepository } from './repositories/identity.repository.ts'
import { IdentityService } from './services/identity.service.ts'
import { IDENTITY } from './identity.tokens.ts'

export const identityModule = new ContainerModule(({ bind }) => {
  bind(IDENTITY.Repository).toResolvedValue(
    (uow) => new IdentityRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(IDENTITY.Service).toResolvedValue(
    (repo, uow, collections) =>
      new IdentityService(
        repo as IdentityRepository,
        uow as UnitOfWork,
        // joinViaDomain reuses the same personal-collection ensure the invite
        // acceptance paths run — inside the join tx (ALS join). The DNS TXT
        // resolver defaults to node:dns/promises; tests inject a fake per call.
        collections as CollectionService,
      ),
    [IDENTITY.Repository, SHARED.UnitOfWork, COLLECTIONS.Service],
  )
})
