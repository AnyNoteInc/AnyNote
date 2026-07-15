import { ContainerModule } from 'inversify'

import { SHARED } from '../../shared/tokens.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { DatabaseFormRepository } from './database-form.repository.ts'
import { DATABASE_FORMS } from './database-forms.tokens.ts'

export const databaseFormsModule = new ContainerModule(({ bind }) => {
  bind(DATABASE_FORMS.Repository).toResolvedValue(
    (uow) => new DatabaseFormRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
})
