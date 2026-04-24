import { createHash } from "node:crypto"

import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Inject, Logger } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"
import type { Job } from "bullmq"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { EmbeddingClient } from "../services/embedding-client.service.js"
import { PageChunker, TiptapDoc } from "../services/page-chunker.service.js"
import { ProcessingClient } from "../services/processing-client.service.js"
import { QdrantPoint, QdrantWriter } from "../services/qdrant-writer.service.js"

const INDEXING_QUEUE = "indexing"

export type IndexPageJob = {
  outboxId: string
  pageId: string
  workspaceId: string
}

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost {
  private readonly log = new Logger(IndexingProcessor.name)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly chunker: PageChunker,
    private readonly processing: ProcessingClient,
    private readonly embedding: EmbeddingClient,
    private readonly qdrant: QdrantWriter,
  ) {
    super()
  }

  async process(job: Job<IndexPageJob>): Promise<void> {
    const { outboxId, pageId } = job.data
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          id: true,
          type: true,
          ownership: true,
          deletedAt: true,
          content: true,
          workspaceId: true,
          title: true,
          createdById: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      await this.qdrant.deleteByPageId(pageId)

      if (
        !page ||
        page.deletedAt ||
        page.type !== "TEXT" ||
        page.ownership !== "TEXT" ||
        !page.content
      ) {
        await this.markDone(outboxId)
        return
      }

      const chunks = this.chunker.chunksFromDoc(page.content as unknown as TiptapDoc)
      if (chunks.length === 0) {
        await this.markDone(outboxId)
        return
      }

      const points: QdrantPoint[] = []
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        if (!chunk) continue
        const normalizedChunks = await this.processing.normalize(chunk, "auto")
        for (const normalizedChunk of normalizedChunks) {
          const normalized = normalizedChunk.trim()
          if (!normalized) continue
          const vector = await this.embedding.embed(normalized)
          points.push({
            id: pointId(pageId, i),
            vector,
            payload: {
              pageId,
              workspaceId: page.workspaceId,
              chunkIndex: i,
              title: page.title ?? "",
              content: normalized,
              pageType: page.type,
              createdById: page.createdById ?? "",
              createdAt: page.createdAt.toISOString(),
              updatedAt: page.updatedAt.toISOString(),
            },
          })
        }
      }

      if (points.length > 0) {
        await this.qdrant.upsert(points)
      }
      await this.markDone(outboxId)
    } catch (err) {
      this.log.error(`Indexing failed for page ${pageId}: ${(err as Error).message}`)
      await this.markFailedOrRetry(outboxId, err as Error)
      throw err
    }
  }

  private async markDone(outboxId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status = 'DONE', processed_at = now(), locked_at = NULL, locked_by = NULL
      WHERE id = ${BigInt(outboxId)}
    `)
  }

  private async markFailedOrRetry(outboxId: string, err: Error): Promise<void> {
    const maxAttempts = Number(process.env.INDEXER_MAX_ATTEMPTS ?? 5)
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET
        attempts = attempts + 1,
        last_error = ${err.message},
        status = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'FAILED'::"OutboxEventStatus" ELSE 'PENDING'::"OutboxEventStatus" END,
        next_attempt_at = now() + (LEAST(300, POWER(2, attempts + 1) * 10) * interval '1 second'),
        locked_at = NULL,
        locked_by = NULL
      WHERE id = ${BigInt(outboxId)}
    `)
  }
}

function pointId(pageId: string, chunkIndex: number): string {
  const h = createHash("sha256").update(`${pageId}:${chunkIndex}`).digest("hex")
  // UUID v4 layout derived from hash to fit Qdrant's accepted id format
  return (
    h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32)
  )
}
