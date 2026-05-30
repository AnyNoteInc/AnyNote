import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { BillingRepository } from './repositories/billing.repository.ts'
import { BillingService } from './services/billing.service.ts'
import { BILLING } from './billing.tokens.ts'

export const billingModule = new ContainerModule(({ bind }) => {
  bind(BILLING.Repository).toResolvedValue(
    (uow) => new BillingRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(BILLING.Service).toResolvedValue(
    (repo) => new BillingService(repo as BillingRepository),
    [BILLING.Repository],
  )
})
