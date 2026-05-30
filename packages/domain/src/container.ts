import 'reflect-metadata'

import { Container } from 'inversify'
import type { PrismaClient } from '@repo/db'

import { SHARED } from './shared/tokens.ts'
import { PrismaUnitOfWork } from './shared/unit-of-work.ts'
import { WORKSPACE } from './workspace/workspace.tokens.ts'
import { workspaceModule } from './workspace/workspace.module.ts'
import type { WorkspaceService } from './workspace/services/workspace.service.ts'
import { FAVORITES } from './favorites/favorites.tokens.ts'
import { favoritesModule } from './favorites/favorites.module.ts'
import type { FavoriteService } from './favorites/services/favorites.service.ts'
import { NOTIFICATIONS } from './notifications/notifications.tokens.ts'
import { notificationsModule } from './notifications/notifications.module.ts'
import type { NotificationService } from './notifications/services/notifications.service.ts'
import type { DeliveryScheduler } from './reminders/reminders.ports.ts'
import { REMINDERS } from './reminders/reminders.tokens.ts'
import { remindersModule } from './reminders/reminders.module.ts'
import type { ReminderService } from './reminders/services/reminders.service.ts'
import { KANBAN } from './kanban/kanban.tokens.ts'
import { kanbanModule } from './kanban/kanban.module.ts'
import type { KanbanService } from './kanban/services/kanban.service.ts'
import { PAGES } from './pages/pages.tokens.ts'
import { pagesModule } from './pages/pages.module.ts'
import type { PageService } from './pages/services/pages.service.ts'

export interface DomainDeps {
  prisma: PrismaClient
  scheduler: DeliveryScheduler
}

export interface Domain {
  workspace: WorkspaceService
  favorites: FavoriteService
  notifications: NotificationService
  reminders: ReminderService
  kanban: KanbanService
  pages: PageService
}

export function createDomainContainer(deps: DomainDeps): Container {
  const c = new Container()
  c.bind(SHARED.Prisma).toConstantValue(deps.prisma)
  c.bind(SHARED.UnitOfWork).toResolvedValue(
    (prisma) => new PrismaUnitOfWork(prisma as PrismaClient),
    [SHARED.Prisma],
  )
  c.bind(REMINDERS.Scheduler).toConstantValue(deps.scheduler)
  c.load(workspaceModule, favoritesModule, notificationsModule, remindersModule, kanbanModule, pagesModule)
  return c
}

export function createDomain(deps: DomainDeps): Domain {
  const c = createDomainContainer(deps)
  return {
    workspace: c.get<WorkspaceService>(WORKSPACE.Service),
    favorites: c.get<FavoriteService>(FAVORITES.Service),
    notifications: c.get<NotificationService>(NOTIFICATIONS.Service),
    reminders: c.get<ReminderService>(REMINDERS.Service),
    kanban: c.get<KanbanService>(KANBAN.Service),
    pages: c.get<PageService>(PAGES.Service),
  }
}
