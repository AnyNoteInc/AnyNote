import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import { parsePageHistoryDays } from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'

@Injectable()
export class PlanFeaturesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async isPageIndexingEnabled(workspaceId: string): Promise<boolean> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { createdById: true },
    })
    if (!ws?.createdById) return false
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: ws.createdById, status: 'ACTIVE' },
      select: { plan: { select: { pageIndexingEnabled: true } } },
    })
    return Boolean(sub?.plan.pageIndexingEnabled)
  }

  /**
   * Page-revision retention window (days) for a workspace, or `null` for unlimited.
   * Mirrors the domain `parsePageHistoryDays` rule: paid plans default to unlimited,
   * the free/personal plan defaults to 7 days when `Plan.features` has no `pageHistory:` entry.
   * A workspace with no owner / no active subscription falls back to the free default.
   */
  async getPageHistoryDays(workspaceId: string): Promise<number | null> {
    const ws = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { createdById: true },
    })
    if (!ws?.createdById) return parsePageHistoryDays(null, false)
    const sub = await this.prisma.subscription.findFirst({
      where: { userId: ws.createdById, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: { plan: { select: { slug: true, features: true } } },
    })
    if (!sub?.plan) return parsePageHistoryDays(null, false)
    const isPaid = sub.plan.slug !== 'personal'
    return parsePageHistoryDays(sub.plan.features, isPaid)
  }
}
