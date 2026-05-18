import { Module } from '@nestjs/common'

import { BackfillReindexCommand } from './commands/backfill-reindex.command.js'
import { VectorizationCronService } from './cron/vectorization-cron.service.js'
import { IndexerController } from './indexer.controller.js'
import { PlaywrightGuard } from './playwright.guard.js'
import { AgentsClient } from './services/agents-client.service.js'
import { BackfillReindexService } from './services/backfill-reindex.service.js'
import { PageContentReader } from './services/page-content-reader.service.js'
import { PlanFeaturesService } from './services/plan-features.service.js'

@Module({
  controllers: [IndexerController],
  providers: [
    VectorizationCronService,
    AgentsClient,
    PageContentReader,
    PlanFeaturesService,
    BackfillReindexService,
    BackfillReindexCommand,
    PlaywrightGuard,
  ],
})
export class IndexerModule {}
