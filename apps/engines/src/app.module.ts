import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { ScheduleModule } from "@nestjs/schedule"

import { BillingModule } from "./apps/billing/billing.module.js"
import { IndexerModule } from "./apps/indexer/indexer.module.js"
import { McpModule } from "./apps/mcp/mcp.module.js"
import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    BillingModule,
    IndexerModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
