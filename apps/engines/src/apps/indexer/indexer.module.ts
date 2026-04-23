import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"

import { OutboxCronService } from "./cron/outbox-cron.service.js"
import { OutboxDrainerService } from "./cron/outbox-drainer.service.js"
import { IndexingProcessor } from "./queue/indexing.processor.js"
import { EmbeddingClient } from "./services/embedding-client.service.js"
import { PageChunker } from "./services/page-chunker.service.js"
import { ProcessingClient } from "./services/processing-client.service.js"
import { QdrantWriter } from "./services/qdrant-writer.service.js"
import { ReindexOnBootService } from "./services/reindex-on-boot.service.js"

@Module({
  imports: [
    BullModule.registerQueue({
      name: "indexing",
    }),
  ],
  providers: [
    OutboxCronService,
    OutboxDrainerService,
    IndexingProcessor,
    PageChunker,
    ProcessingClient,
    EmbeddingClient,
    QdrantWriter,
    ReindexOnBootService,
  ],
  exports: [EmbeddingClient],
})
export class IndexerModule {}
