import { randomUUID } from 'node:crypto'

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { parseAiProviderConnection, type PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { AgentsClient, type EmbeddingPayload } from '../services/agents-client.service.js'
import { PageContentReader, type TiptapNode } from '../services/page-content-reader.service.js'
import { PlanFeaturesService } from '../services/plan-features.service.js'

type EventType = 'page.upserted' | 'page.deleted'

type Row = {
  id: bigint
  page_id: string
  workspace_id: string
  event_type: EventType
}

@Injectable()
export class VectorizationCronService implements OnModuleInit {
  private readonly log = new Logger(VectorizationCronService.name)
  private readonly workerId: string
  private readonly batch: number
  private readonly maxAttempts: number

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reader: PageContentReader,
    private readonly agents: AgentsClient,
    private readonly planFeatures: PlanFeaturesService,
  ) {
    this.workerId = `engines-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
    this.batch = Number(process.env.INDEXER_BATCH ?? 10)
    this.maxAttempts = Number(process.env.INDEXER_MAX_ATTEMPTS ?? 5)
  }

  onModuleInit(): void {
    this.log.log(`VectorizationCron ready; worker=${this.workerId} batch=${this.batch}`)
  }

  @Cron(process.env.INDEXER_CRON_EXPRESSION ?? '0 */5 * * * *')
  async tick(): Promise<void> {
    const rows = await this.claimBatch()
    if (rows.length === 0) return
    await this.processBatch(rows)
  }

  private async claimBatch(): Promise<Row[]> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Pick the latest PENDING event per (aggregate_type, aggregate_id, workspace_id) tuple.
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT id, event_type, aggregate_id AS page_id, workspace_id
        FROM outbox_events
        WHERE id IN (
          SELECT DISTINCT ON (aggregate_id, workspace_id) id
          FROM outbox_events
          WHERE status = 'PENDING'
            AND next_attempt_at <= now()
            AND aggregate_type = 'page'
            AND event_type IN ('page.upserted', 'page.deleted')
          ORDER BY aggregate_id, workspace_id, created_at DESC, id DESC
        )
        ORDER BY id
        LIMIT ${this.batch}
        FOR UPDATE SKIP LOCKED
      `)
      if (rows.length === 0) return rows
      const ids = rows.map((r) => r.id)
      await tx.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status='PROCESSING', locked_at=now(), locked_by=${this.workerId}
        WHERE id IN (${Prisma.join(ids)})
      `)
      // Collapse all other PENDING events for the same (aggregate_id, workspace_id)
      // into DONE so they don't fire again next tick.
      await tx.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status='DONE', processed_at=now()
        WHERE status='PENDING'
          AND aggregate_type='page'
          AND id NOT IN (${Prisma.join(ids)})
          AND (aggregate_id, workspace_id) IN (
            SELECT aggregate_id, workspace_id
            FROM outbox_events
            WHERE id IN (${Prisma.join(ids)})
          )
      `)
      return rows
    })
  }

  private async processBatch(rows: Row[]): Promise<void> {
    await Promise.all(rows.map((row) => this.processRow(row)))
  }

  private async processRow(row: Row): Promise<void> {
    const allowed = await this.planFeatures.isPageIndexingEnabled(row.workspace_id)
    if (!allowed) {
      await this.markDone(row.id)
      return
    }

    try {
      if (row.event_type === 'page.deleted') {
        await this.agents.deletePageVectors(row.page_id)
        await this.markDone(row.id)
        return
      }

      const aiSettings = await this.prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: row.workspace_id },
        select: {
          embeddingsModel: {
            select: {
              slug: true,
              vectorSize: true,
              provider: { select: { slug: true, connection: true } },
            },
          },
        },
      })

      const model = aiSettings?.embeddingsModel
      if (!model || model.vectorSize === null) {
        await this.markDone(row.id)
        return
      }

      const page = await this.prisma.page.findUnique({
        where: { id: row.page_id },
        select: {
          id: true,
          type: true,
          deletedAt: true,
          title: true,
          content: true,
          workspaceId: true,
        },
      })

      if (!page || page.deletedAt || page.type !== 'TEXT') {
        await this.markDone(row.id)
        return
      }

      const connection = parseAiProviderConnection(model.provider.slug, model.provider.connection)
      await this.agents.vectorize({
        pageId: row.page_id,
        workspaceId: row.workspace_id,
        title: page.title ?? '',
        pageType: 'TEXT',
        contents: this.reader.blocksFromDoc(page.content as TiptapNode | null),
        embedding: {
          provider: model.provider.slug as EmbeddingPayload['provider'],
          modelSlug: model.slug,
          vectorSize: model.vectorSize,
          connection,
        },
      })
      await this.markDone(row.id)
    } catch (err) {
      this.log.error(`Indexing failed for page ${row.page_id}: ${(err as Error).message}`)
      await this.markFailedOrRetry(row.id, err as Error)
    }
  }

  private async markDone(outboxId: bigint): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status='DONE', processed_at=now(), locked_at=NULL, locked_by=NULL
      WHERE id = ${outboxId}
    `)
  }

  private async markFailedOrRetry(outboxId: bigint, err: Error): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET
        attempts = attempts + 1,
        last_error = ${err.message},
        status = CASE WHEN attempts + 1 >= ${this.maxAttempts}
                     THEN 'FAILED'::"OutboxEventStatus"
                     ELSE 'PENDING'::"OutboxEventStatus" END,
        next_attempt_at = now() + (LEAST(300, POWER(2, attempts + 1) * 10) * interval '1 second'),
        locked_at = NULL,
        locked_by = NULL
      WHERE id = ${outboxId}
    `)
  }
}
