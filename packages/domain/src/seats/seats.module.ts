import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { SeatsRepository } from './repositories/seats.repository.ts'
import { SeatsService } from './services/seats.service.ts'
import { SEATS } from './seats.tokens.ts'

export const seatsModule = new ContainerModule(({ bind }) => {
  bind(SEATS.Repository).toResolvedValue(
    (uow) => new SeatsRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(SEATS.Service).toResolvedValue(
    (repo, uow) => new SeatsService(repo as SeatsRepository, uow as UnitOfWork),
    [SEATS.Repository, SHARED.UnitOfWork],
  )
})
