import { domain } from '../domain'
import { mapDomain } from './map-domain'
import {
  getPlanDisplayName,
  syncWorkspaceLimits,
  resolveActivePlanOrPersonal,
  type PlanFeatures,
} from '@repo/domain'

export type { PlanFeatures }
export { getPlanDisplayName, syncWorkspaceLimits, resolveActivePlanOrPersonal }

export const getActivePlanForUser = (_prisma: unknown, userId: string) =>
  domain.billing.getActivePlan(userId)

export const getAvailableAiModels = (workspaceId: string) =>
  domain.billing.getAvailableAiModels(workspaceId)

export const getAvailableEmbeddingModels = (workspaceId: string) =>
  domain.billing.getAvailableEmbeddingModels(workspaceId)

export const getWorkspaceFeatures = (workspaceId: string) =>
  domain.billing.getWorkspaceFeatures(workspaceId)

export function requireWritableWorkspace(workspaceId: string): Promise<void> {
  return mapDomain(() => domain.billing.requireWritableWorkspace(workspaceId))
}
