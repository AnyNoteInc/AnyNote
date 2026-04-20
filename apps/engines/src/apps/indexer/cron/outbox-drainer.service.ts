import { randomUUID } from "node:crypto"

import { InjectQueue } from "@nestjs/bullmq"
import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common"
import { Interval } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"
import type { Queue } from "bullmq"

import { PRISMA } from "../../../infra/db/db.providers.js"

const INDEXING_QUEUE = "indexing"

type ClaimedRow = {
  id: bigint
  page_id: string
  workspace_id: string
}

@Injectable()
export class OutboxDrainerService implements OnModuleInit {
  private readonly log = new Logger(OutboxDrainerService.name)
  private readonly batch: number
  private readonly workerId: string

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @InjectQueue(INDEXING_QUEUE) private readonly queue: Queue,
  ) {
    this.batch = Number(process.env.INDEXER_DRAINER_BATCH ?? 50)
    this.workerId = `engines-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
  }

  onModuleInit(): void {
    this.log.log(`OutboxDrainer ready; worker=${this.workerId} batch=${this.batch}`)
  }

  @Interval(Number(process.env.INDEXER_DRAINER_INTERVAL_MS ?? 5000))
  async drain(): Promise<number> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        SELECT id, aggregate_id as page_id, workspace_id
        FROM outbox_events
        WHERE event_type = 'page.upserted'
          AND aggregate_type = 'page'
          AND status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${this.batch}
        FOR UPDATE SKIP LOCKED
      `)

      if (rows.length === 0) return 0

      for (const row of rows) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE outbox_events
          SET status = 'PROCESSING', locked_at = now(), locked_by = ${this.workerId}
          WHERE id = ${row.id}
        `)
        await this.queue.add(
          "index-page",
          { outboxId: row.id.toString(), pageId: row.page_id, workspaceId: row.workspace_id },
          { jobId: `outbox-${row.id}`, removeOnComplete: true, removeOnFail: 100 },
        )
      }
      this.log.log(`Drained ${rows.length} outbox row(s) → BullMQ`)
      return rows.length
    })
  }
}
