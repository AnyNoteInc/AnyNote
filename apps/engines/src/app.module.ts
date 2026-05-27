import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'

import { ApiModule } from './apps/api/api.module.js'
import { BillingModule } from './apps/billing/billing.module.js'
import { CleanupModule } from './apps/cleanup/cleanup.module.js'
import { IndexerModule } from './apps/indexer/indexer.module.js'
import { McpModule } from './apps/mcp/mcp.module.js'
import { NotifierModule } from './apps/notifier/notifier.module.js'
import { AuthModule } from './auth/auth.module.js'
import { HealthModule } from './health/health.module.js'
import { DbModule } from './infra/db/db.module.js'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    AuthModule,
    BillingModule,
    CleanupModule,
    IndexerModule,
    NotifierModule,
    McpModule,
    ApiModule,
    HealthModule,
  ],
})
export class AppModule {}
