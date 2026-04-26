import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

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
}
