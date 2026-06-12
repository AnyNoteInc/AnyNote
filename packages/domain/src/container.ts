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
import { DATABASE } from './database/database.tokens.ts'
import { databaseModule } from './database/database.module.ts'
import type { DatabaseService } from './database/services/database.service.ts'
import { PAGES } from './pages/pages.tokens.ts'
import { pagesModule } from './pages/pages.module.ts'
import type { PageService } from './pages/services/pages.service.ts'
import { PEOPLE } from './people/people.tokens.ts'
import { peopleModule } from './people/people.module.ts'
import type { PeopleService } from './people/services/people.service.ts'
import { IDENTITY } from './identity/identity.tokens.ts'
import { identityModule } from './identity/identity.module.ts'
import type { IdentityService } from './identity/services/identity.service.ts'
import { PAGE_HISTORY } from './page-history/page-history.tokens.ts'
import { pageHistoryModule } from './page-history/page-history.module.ts'
import type { RevisionCaptureService } from './page-history/services/revision-capture.service.ts'
import { TEMPLATES } from './templates/templates.tokens.ts'
import { templatesModule } from './templates/templates.module.ts'
import type { TemplateService } from './templates/services/templates.service.ts'
import { BILLING } from './billing/billing.tokens.ts'
import { billingModule } from './billing/billing.module.ts'
import type { BillingService } from './billing/services/billing.service.ts'
import { COLLECTIONS } from './collections/collections.tokens.ts'
import { collectionsModule } from './collections/collections.module.ts'
import type { CollectionService } from './collections/services/collections.service.ts'
import { SHARE_ACCESS } from './share-access/share-access.tokens.ts'
import { shareAccessModule } from './share-access/share-access.module.ts'
import type { ShareAccessService } from './share-access/services/share-access.service.ts'
import { SHARE_COPY } from './share-copy/share-copy.tokens.ts'
import { shareCopyModule } from './share-copy/share-copy.module.ts'
import type { PublicShareCopyService } from './share-copy/services/share-copy.service.ts'
import { SECURITY } from './security/security.tokens.ts'
import { securityModule } from './security/security.module.ts'
import type { SecurityService } from './security/services/security.service.ts'

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
  database: DatabaseService
  pages: PageService
  people: PeopleService
  identity: IdentityService
  pageHistory: RevisionCaptureService
  templates: TemplateService
  billing: BillingService
  collections: CollectionService
  shareAccess: ShareAccessService
  shareCopy: PublicShareCopyService
  security: SecurityService
}

export function createDomainContainer(deps: DomainDeps): Container {
  const c = new Container()
  c.bind(SHARED.Prisma).toConstantValue(deps.prisma)
  // MUST be a singleton: inversify 8 defaults to transient, which hands every
  // service/repository its OWN PrismaUnitOfWork (own AsyncLocalStorage) — a
  // service's transaction() then opens a tx the repository's client() never
  // sees, so every repository write inside a "transaction" ran autocommit.
  c.bind(SHARED.UnitOfWork)
    .toResolvedValue((prisma) => new PrismaUnitOfWork(prisma as PrismaClient), [SHARED.Prisma])
    .inSingletonScope()
  c.bind(REMINDERS.Scheduler).toConstantValue(deps.scheduler)
  c.load(
    workspaceModule,
    favoritesModule,
    notificationsModule,
    remindersModule,
    kanbanModule,
    databaseModule,
    pageHistoryModule,
    pagesModule,
    peopleModule,
    identityModule,
    templatesModule,
    billingModule,
    collectionsModule,
    shareAccessModule,
    shareCopyModule,
    securityModule,
  )
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
    database: c.get<DatabaseService>(DATABASE.Service),
    pages: c.get<PageService>(PAGES.Service),
    people: c.get<PeopleService>(PEOPLE.Service),
    identity: c.get<IdentityService>(IDENTITY.Service),
    pageHistory: c.get<RevisionCaptureService>(PAGE_HISTORY.Service),
    templates: c.get<TemplateService>(TEMPLATES.Service),
    billing: c.get<BillingService>(BILLING.Service),
    collections: c.get<CollectionService>(COLLECTIONS.Service),
    shareAccess: c.get<ShareAccessService>(SHARE_ACCESS.Service),
    shareCopy: c.get<PublicShareCopyService>(SHARE_COPY.Service),
    security: c.get<SecurityService>(SECURITY.Service),
  }
}
