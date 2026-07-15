import { ContainerModule } from 'inversify'

import { SHARED } from '../../shared/tokens.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { BILLING } from '../../billing/billing.tokens.ts'
import type { BillingService } from '../../billing/services/billing.service.ts'
import { DATABASE } from '../database.tokens.ts'
import type { DatabaseRepository } from '../repositories/database.repository.ts'
import { DatabaseFormRepository } from './database-form.repository.ts'
import { DatabaseFormService } from './database-form.service.ts'
import { DATABASE_FORMS } from './database-forms.tokens.ts'

export const databaseFormsModule = new ContainerModule(({ bind }) => {
  bind(DATABASE_FORMS.Repository).toResolvedValue(
    (uow) => new DatabaseFormRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(DATABASE_FORMS.Service).toResolvedValue(
    (repo, databaseRepo, uow, billing) =>
      new DatabaseFormService(
        repo as DatabaseFormRepository,
        databaseRepo as DatabaseRepository,
        uow as UnitOfWork,
        billing as BillingService,
      ),
    [DATABASE_FORMS.Repository, DATABASE.Repository, SHARED.UnitOfWork, BILLING.Service],
  )
})
