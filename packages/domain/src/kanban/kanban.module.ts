import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { KanbanRepository } from './repositories/kanban.repository.ts'
import { KanbanService } from './services/kanban.service.ts'
import { KANBAN } from './kanban.tokens.ts'

export const kanbanModule = new ContainerModule(({ bind }) => {
  bind(KANBAN.Repository).toResolvedValue(
    (uow) => new KanbanRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(KANBAN.Service).toResolvedValue(
    (repo, uow) => new KanbanService(repo as KanbanRepository, uow as UnitOfWork),
    [KANBAN.Repository, SHARED.UnitOfWork],
  )
})
