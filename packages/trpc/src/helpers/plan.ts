import { mapDomain } from './map-domain'
import {
  getActivePlanForUser,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  getPlanDisplayName,
  getWorkspaceFeatures,
  requireWritableWorkspace as requireWritableWorkspaceDomain,
  resolveActivePlanOrPersonal,
  syncWorkspaceLimits,
} from '@repo/domain'

export type { PlanFeatures } from '@repo/domain'

export {
  getActivePlanForUser,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  getPlanDisplayName,
  getWorkspaceFeatures,
  resolveActivePlanOrPersonal,
  syncWorkspaceLimits,
}

export function requireWritableWorkspace(workspaceId: string): Promise<void> {
  return mapDomain(() => requireWritableWorkspaceDomain(workspaceId))
}
