import { randomUUID } from "node:crypto"

import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { AgentsClient } from "../services/agents-client.service.js"
import { PageContentReader, type TiptapNode } from "../services/page-content-reader.service.js"

type Row = { id: bigint; page_id: string; workspace_id: string }

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
  ) {
    this.workerId = `engines-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
    this.batch = Number(process.env.INDEXER_BATCH ?? 10)
    this.maxAttempts = Number(process.env.INDEXER_MAX_ATTEMPTS ?? 5)
  }

  onModuleInit(): void {
    this.log.log(
      `VectorizationCron ready; worker=${this.workerId} batch=${this.batch}`,
    )
  }

  @Cron(process.env.INDEXER_CRON_EXPRESSION ?? "*/30 * * * * *")
  async tick(): Promise<void> {
    const rows = await this.claimBatch()
    if (rows.length === 0) return
    await this.processBatch(rows)
  }

  private async claimBatch(): Promise<Row[]> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT id, aggregate_id AS page_id, workspace_id
        FROM outbox_events
        WHERE event_type = 'page.upserted'
          AND aggregate_type = 'page'
          AND status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
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
      return rows
    })
  }

  private async processBatch(rows: Row[]): Promise<void> {
    for (const row of rows) {
      try {
        const page = await this.prisma.page.findUnique({
          where: { id: row.page_id },
          select: {
            id: true, type: true, deletedAt: true, title: true,
            content: true, workspaceId: true,
          },
        })
        const isEligible = page && !page.deletedAt && page.type === "TEXT"
        const contents = isEligible
          ? this.reader.blocksFromDoc(page.content as TiptapNode | null)
          : []
        await this.agents.vectorize({
          pageId: row.page_id,
          workspaceId: row.workspace_id,
          title: page?.title ?? "",
          pageType: "TEXT",
          contents,
        })
        await this.markDone(row.id)
      } catch (err) {
        this.log.error(`Indexing failed for page ${row.page_id}: ${(err as Error).message}`)
        await this.markFailedOrRetry(row.id, err as Error)
      }
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
