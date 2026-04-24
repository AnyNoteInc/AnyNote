import { Module } from "@nestjs/common"

import { VectorizationCronService } from "./cron/vectorization-cron.service.js"
import { AgentsClient } from "./services/agents-client.service.js"
import { PageContentReader } from "./services/page-content-reader.service.js"

@Module({
  providers: [VectorizationCronService, AgentsClient, PageContentReader],
})
export class IndexerModule {}
