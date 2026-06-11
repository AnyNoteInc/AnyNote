import { ContainerModule } from 'inversify'

import { BILLING } from '../billing/index.ts'
import type { BillingService } from '../billing/index.ts'
import { COLLECTIONS } from '../collections/index.ts'
import type { CollectionService } from '../collections/index.ts'
import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { PeopleRepository } from './repositories/people.repository.ts'
import { PeopleService } from './services/people.service.ts'
import { PEOPLE } from './people.tokens.ts'

export const peopleModule = new ContainerModule(({ bind }) => {
  bind(PEOPLE.Repository).toResolvedValue(
    (uow) => new PeopleRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(PEOPLE.Service).toResolvedValue(
    (repo, uow, collections, billing) =>
      new PeopleService(
        repo as PeopleRepository,
        uow as UnitOfWork,
        // Acceptance reuses the same personal-collection ensure the legacy
        // workspace.inviteMember path runs — inside the acceptance tx (ALS join).
        collections as CollectionService,
        billing as BillingService,
      ),
    [PEOPLE.Repository, SHARED.UnitOfWork, COLLECTIONS.Service, BILLING.Service],
  )
})
