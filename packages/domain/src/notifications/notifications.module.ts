import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { NotificationRepository } from './repositories/notifications.repository.ts'
import { NotificationService } from './services/notifications.service.ts'
import { NOTIFICATIONS } from './notifications.tokens.ts'

export const notificationsModule = new ContainerModule(({ bind }) => {
  bind(NOTIFICATIONS.Repository).toResolvedValue(
    (uow) => new NotificationRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(NOTIFICATIONS.Service).toResolvedValue(
    (repo) => new NotificationService(repo as NotificationRepository),
    [NOTIFICATIONS.Repository],
  )
})
