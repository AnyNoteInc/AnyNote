import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../infra/db/db.providers.js'
import { PlanFeaturesService } from '../indexer/services/plan-features.service.js'

/**
 * Retention prune for page revisions. Per workspace, reads `pageHistoryDays`
 * from the plan feature and deletes `PageRevision` rows older than now - days.
 * Unlimited (null) workspaces are skipped. Pruning is a scheduled JOB — never
 * an ad-hoc delete in a read API.
 */
@Injectable()
export class HistoryPruneService {
  private readonly logger = new Logger(HistoryPruneService.name)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly planFeatures: PlanFeaturesService,
  ) {}

  @Cron(process.env.HISTORY_PRUNE_CRON ?? '0 3 * * *')
  async prune(): Promise<void> {
    try {
      const total = await this.pruneAllWorkspaces()
      this.logger.log(`page-revision prune deleted ${total} expired revisions`)
    } catch (err) {
      this.logger.error('page-revision prune failed', err as Error)
    }
  }

  /** Prune every workspace; returns the total number of deleted revisions. */
  async pruneAllWorkspaces(now: Date = new Date()): Promise<number> {
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true } })
    let total = 0
    for (const ws of workspaces) {
      const days = await this.planFeatures.getPageHistoryDays(ws.id)
      total += await this.pruneWorkspace(ws.id, days, now)
    }
    return total
  }

  /**
   * Delete the workspace's revisions older than `now - days`. A `null`/`undefined`
   * retention (unlimited) is a no-op. Returns the number of deleted rows.
   */
  async pruneWorkspace(
    workspaceId: string,
    days: number | null,
    now: Date = new Date(),
  ): Promise<number> {
    if (days === null || days === undefined) return 0
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const result = await this.prisma.pageRevision.deleteMany({
      where: {
        page: { workspaceId },
        createdAt: { lt: cutoff },
      },
    })
    return result.count
  }
}
