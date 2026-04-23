import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { ScheduleModule } from "@nestjs/schedule"

import { IndexerModule } from "./apps/indexer/indexer.module.js"
import { McpModule } from "./apps/mcp/mcp.module.js"
import { SearchModule } from "./apps/search/search.module.js"
import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"
import { OllamaModule } from "./infra/ollama/ollama.module.js"
import { QdrantModule } from "./infra/qdrant/qdrant.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    }),
    DbModule,
    QdrantModule,
    OllamaModule,
    IndexerModule,
    McpModule,
    SearchModule,
    HealthModule,
  ],
})
export class AppModule {}
