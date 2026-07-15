import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { PAGES } from '../pages/pages.tokens.ts'
import type { PageRepository } from '../pages/repositories/pages.repository.ts'
import { DatabaseRepository } from './repositories/database.repository.ts'
import { DatabaseService } from './services/database.service.ts'
import { DATABASE } from './database.tokens.ts'

export { databaseFormsModule } from './forms/database-forms.module.ts'

export const databaseModule = new ContainerModule(({ bind }) => {
  bind(DATABASE.Repository).toResolvedValue(
    (uow) => new DatabaseRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(DATABASE.Service).toResolvedValue(
    (repo, pageRepo, uow) =>
      new DatabaseService(
        repo as DatabaseRepository,
        pageRepo as PageRepository,
        uow as UnitOfWork,
      ),
    [DATABASE.Repository, PAGES.Repository, SHARED.UnitOfWork],
  )
})
