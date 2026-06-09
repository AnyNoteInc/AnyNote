import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import type { RevisionRecorder } from '../shared/revision-recorder.ts'
import { KANBAN } from '../kanban/kanban.tokens.ts'
import type { KanbanService } from '../kanban/services/kanban.service.ts'
import { DATABASE } from '../database/database.tokens.ts'
import type { DatabaseService } from '../database/services/database.service.ts'
import { PAGE_HISTORY } from '../page-history/page-history.tokens.ts'
import { PageRepository } from './repositories/pages.repository.ts'
import { PageService } from './services/pages.service.ts'
import { PAGES } from './pages.tokens.ts'

export const pagesModule = new ContainerModule(({ bind }) => {
  bind(PAGES.Repository).toResolvedValue(
    (uow) => new PageRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(PAGES.Service).toResolvedValue(
    (repo, uow, kanban, database, history) =>
      new PageService(
        repo as PageRepository,
        uow as UnitOfWork,
        kanban as KanbanService,
        database as DatabaseService,
        // PAGE_HISTORY.Service (RevisionCaptureService) structurally satisfies
        // the RevisionRecorder port — keeps pages decoupled from page-history.
        history as RevisionRecorder,
      ),
    [PAGES.Repository, SHARED.UnitOfWork, KANBAN.Service, DATABASE.Service, PAGE_HISTORY.Service],
  )
})
