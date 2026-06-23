import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup'

import { ApiModule } from './apps/api/api.module.js'
import { BillingModule } from './apps/billing/billing.module.js'
import { CleanupModule } from './apps/cleanup/cleanup.module.js'
import { HistoryModule } from './apps/history/history.module.js'
import { IndexerModule } from './apps/indexer/indexer.module.js'
import { McpModule } from './apps/mcp/mcp.module.js'
import { NotifierModule } from './apps/notifier/notifier.module.js'
import { TelegramModule } from './apps/telegram/telegram.module.js'
import { WebhookModule } from './apps/webhook/webhook.module.js'
import { AuthModule } from './auth/auth.module.js'
import { HealthModule } from './health/health.module.js'
import { DbModule } from './infra/db/db.module.js'
import { DomainModule } from './infra/domain/domain.module.js'

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    DomainModule,
    AuthModule,
    BillingModule,
    CleanupModule,
    HistoryModule,
    IndexerModule,
    NotifierModule,
    WebhookModule,
    TelegramModule,
    McpModule,
    ApiModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
