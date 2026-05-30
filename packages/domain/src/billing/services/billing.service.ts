import type { AiModel, AiProvider } from '@repo/db'

import { forbidden, notFound } from '../../shared/errors.ts'
import type { PlanFeatures } from '../dto/billing.dto.ts'
import type { BillingRepository } from '../repositories/billing.repository.ts'

type ActiveSubscriptionRow = NonNullable<
  Awaited<ReturnType<BillingRepository['findActiveSubscriptionWithPlan']>>
>

export class BillingService {
  constructor(private readonly repo: BillingRepository) {}

  async getActivePlan(
    userId: string,
  ): Promise<{ subscription: ActiveSubscriptionRow; plan: ActiveSubscriptionRow['plan'] }> {
    const subscription = await this.repo.findActiveSubscriptionWithPlan(userId)
    if (!subscription) {
      throw new Error(`User ${userId} has no active subscription`)
    }
    return { subscription, plan: subscription.plan }
  }

  async getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
    return this.repo.getWorkspaceFeatures(workspaceId)
  }

  async getAvailableAiModels(
    workspaceId: string,
  ): Promise<(AiModel & { provider: AiProvider })[]> {
    const features = await this.repo.getWorkspaceFeatures(workspaceId)
    const allowed = await this.repo.findPlansUpToSortOrder(features.sortOrder)
    const allowedSlugs = allowed.map((r) => r.slug)
    return this.repo.findAvailableAiModels(workspaceId, allowedSlugs)
  }

  async getAvailableEmbeddingModels(
    workspaceId: string,
  ): Promise<(AiModel & { provider: AiProvider })[]> {
    const features = await this.repo.getWorkspaceFeatures(workspaceId)
    const allowed = await this.repo.findPlansUpToSortOrder(features.sortOrder)
    const allowedSlugs = allowed.map((r) => r.slug)
    return this.repo.findAvailableEmbeddingModels(workspaceId, allowedSlugs)
  }

  async requireWritableWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.repo.findWorkspaceOwner(workspaceId)
    if (!workspace) throw notFound('Workspace not found')

    const features = await this.repo.getWorkspaceFeatures(workspaceId)
    if (features.maxWorkspaces === null) return

    const olderCount = await this.repo.countOlderWorkspaces(
      workspace.createdById ?? '',
      workspace.createdAt,
    )
    if (olderCount >= features.maxWorkspaces) {
      throw forbidden('WORKSPACE_OVER_PLAN_LIMIT')
    }
  }
}
