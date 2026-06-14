import type { AiModel, AiProvider, Plan } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import { activeSubscriptionWithPlanArgs } from '../active-subscription.ts'
import type { PlanFeatures } from '../dto/billing.dto.ts'
import {
  getPlanDisplayName,
  parseMeetingsEnabled,
  parsePageHistoryDays,
} from '../dto/billing.dto.ts'

function planToFeatures(plan: Plan): PlanFeatures {
  const isPaid = plan.slug !== 'personal'
  return {
    slug: plan.slug as PlanFeatures['slug'],
    name: getPlanDisplayName(plan),
    sortOrder: plan.sortOrder,
    isPaid,
    maxWorkspaces: plan.maxWorkspaces,
    maxMembersPerWorkspace: plan.maxMembersPerWorkspace,
    chatsEnabled: plan.chatsEnabled,
    pageIndexingEnabled: plan.pageIndexingEnabled,
    membersSettingsEnabled: plan.membersSettingsEnabled,
    aiSettingsEnabled: plan.aiSettingsEnabled,
    customMcpEnabled: plan.customMcpEnabled,
    customAiProvidersEnabled: plan.customAiProvidersEnabled,
    prioritySupport: plan.prioritySupport,
    developerSpaceEnabled: plan.developerSpaceEnabled,
    publicSitesEnabled:
      Array.isArray(plan.features) && (plan.features as string[]).includes('publicSites'),
    meetingsEnabled: parseMeetingsEnabled(plan.features),
    pageHistoryDays: parsePageHistoryDays(plan.features, isPaid),
  }
}

export class BillingRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async findActiveSubscriptionWithPlan(userId: string) {
    return this.uow.client().subscription.findFirst(activeSubscriptionWithPlanArgs(userId))
  }

  async getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
    const workspace = await this.uow.client().workspace.findUnique({
      where: { id: workspaceId },
      select: { createdById: true },
    })
    if (!workspace?.createdById) {
      const personal = await this.uow
        .client()
        .plan.findUniqueOrThrow({ where: { slug: 'personal' } })
      return planToFeatures(personal)
    }
    const sub = await this.uow.client().subscription.findFirst({
      where: { userId: workspace.createdById, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    })
    if (!sub) {
      const personal = await this.uow
        .client()
        .plan.findUniqueOrThrow({ where: { slug: 'personal' } })
      return planToFeatures(personal)
    }
    return planToFeatures(sub.plan)
  }

  async findPlansUpToSortOrder(sortOrder: number): Promise<{ slug: string }[]> {
    return this.uow.client().plan.findMany({
      where: { sortOrder: { lte: sortOrder } },
      select: { slug: true },
    })
  }

  async findAvailableAiModels(
    workspaceId: string,
    allowedSlugs: string[],
  ): Promise<(AiModel & { provider: AiProvider })[]> {
    return this.uow.client().aiModel.findMany({
      where: {
        isActive: true,
        supportsEmbeddings: false,
        OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
        provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] },
      },
      include: { provider: true },
      orderBy: { displayName: 'asc' },
    })
  }

  async findAvailableEmbeddingModels(
    workspaceId: string,
    allowedSlugs: string[],
  ): Promise<(AiModel & { provider: AiProvider })[]> {
    return this.uow.client().aiModel.findMany({
      where: {
        isActive: true,
        supportsEmbeddings: true,
        vectorSize: { not: null },
        OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
        provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] },
      },
      include: { provider: true },
      orderBy: { displayName: 'asc' },
    })
  }

  async findWorkspaceOwner(
    workspaceId: string,
  ): Promise<{ createdById: string | null; createdAt: Date } | null> {
    return this.uow.client().workspace.findUnique({
      where: { id: workspaceId },
      select: { createdById: true, createdAt: true },
    })
  }

  async countOlderWorkspaces(ownerId: string, createdAt: Date): Promise<number> {
    return this.uow.client().workspace.count({
      where: { createdById: ownerId, createdAt: { lt: createdAt } },
    })
  }
}
