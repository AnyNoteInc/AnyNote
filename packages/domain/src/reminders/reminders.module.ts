import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import type { DeliveryScheduler } from './reminders.ports.ts'
import { ReminderRepository } from './repositories/reminders.repository.ts'
import { ReminderService } from './services/reminders.service.ts'
import { REMINDERS } from './reminders.tokens.ts'

export const remindersModule = new ContainerModule(({ bind }) => {
  bind(REMINDERS.Repository).toResolvedValue(
    (uow) => new ReminderRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(REMINDERS.Service).toResolvedValue(
    (repo, uow, scheduler) =>
      new ReminderService(
        repo as ReminderRepository,
        uow as UnitOfWork,
        scheduler as DeliveryScheduler,
      ),
    [REMINDERS.Repository, SHARED.UnitOfWork, REMINDERS.Scheduler],
  )
})
