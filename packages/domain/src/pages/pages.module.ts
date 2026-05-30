import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { KANBAN } from '../kanban/kanban.tokens.ts'
import type { KanbanService } from '../kanban/services/kanban.service.ts'
import { PageRepository } from './repositories/pages.repository.ts'
import { PageService } from './services/pages.service.ts'
import { PAGES } from './pages.tokens.ts'

export const pagesModule = new ContainerModule(({ bind }) => {
  bind(PAGES.Repository).toResolvedValue(
    (uow) => new PageRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(PAGES.Service).toResolvedValue(
    (repo, uow, kanban) =>
      new PageService(repo as PageRepository, uow as UnitOfWork, kanban as KanbanService),
    [PAGES.Repository, SHARED.UnitOfWork, KANBAN.Service],
  )
})
