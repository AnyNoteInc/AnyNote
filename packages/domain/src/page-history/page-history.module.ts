import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { PageHistoryRepository } from './repositories/page-history.repository.ts'
import { RevisionCaptureService } from './services/revision-capture.service.ts'
import { PAGE_HISTORY } from './page-history.tokens.ts'

export const pageHistoryModule = new ContainerModule(({ bind }) => {
  bind(PAGE_HISTORY.Repository).toResolvedValue(
    (uow) => new PageHistoryRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(PAGE_HISTORY.Service).toResolvedValue(
    (repo, uow) => new RevisionCaptureService(repo as PageHistoryRepository, uow as UnitOfWork),
    [PAGE_HISTORY.Repository, SHARED.UnitOfWork],
  )
})
