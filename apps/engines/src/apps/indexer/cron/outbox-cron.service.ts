import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"

@Injectable()
export class OutboxCronService {
  private readonly log = new Logger(OutboxCronService.name)
  private readonly quietPeriodMs: number

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    this.quietPeriodMs = Number(process.env.INDEXER_QUIET_PERIOD_MINUTES ?? 5) * 60_000
  }

  @Cron(process.env.INDEXER_CRON_EXPRESSION ?? "*/1 * * * *")
  async tick(): Promise<number> {
    const cutoff = new Date(Date.now() - this.quietPeriodMs)

    const pages = await this.prisma.page.findMany({
      where: {
        type: "TEXT",
        ownership: "TEXT",
        deletedAt: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, workspaceId: true },
      take: 500,
    })

    if (pages.length === 0) return 0

    let inserted = 0
    for (const page of pages) {
      const rows = await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id, payload, status)
        VALUES ('page.upserted', 'page', ${page.id}::uuid, ${page.workspaceId}::uuid, '{}'::jsonb, 'PENDING')
        ON CONFLICT DO NOTHING
      `)
      if (rows > 0) inserted++
    }
    if (inserted > 0) this.log.log(`Enqueued ${inserted} page(s) for reindex`)
    return inserted
  }
}
