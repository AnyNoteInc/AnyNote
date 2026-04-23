import { Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { QdrantWriter } from "./qdrant-writer.service.js"

@Injectable()
export class ReindexOnBootService implements OnApplicationBootstrap {
  private readonly log = new Logger(ReindexOnBootService.name)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly qdrant: QdrantWriter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.INDEXER_REINDEX_ON_BOOT !== "true") return

    this.log.warn("INDEXER_REINDEX_ON_BOOT=true - wiping Qdrant collection and re-enqueuing all TEXT pages")
    await this.qdrant.wipeCollection()

    const pages = await this.prisma.page.findMany({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })

    for (const page of pages) {
      await this.prisma.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: page.id,
          workspaceId: page.workspaceId,
          payload: {},
        },
      })
    }

    this.log.log(`Enqueued ${pages.length} pages for reindexing`)
  }
}
