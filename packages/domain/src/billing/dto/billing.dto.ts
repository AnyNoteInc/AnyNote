import type { Plan } from '@repo/db'

export type PlanFeatures = {
  slug: 'personal' | 'pro' | 'max'
  name: string
  sortOrder: number
  isPaid: boolean
  maxWorkspaces: number | null
  maxMembersPerWorkspace: number
  chatsEnabled: boolean
  pageIndexingEnabled: boolean
  membersSettingsEnabled: boolean
  aiSettingsEnabled: boolean
  customMcpEnabled: boolean
  customAiProvidersEnabled: boolean
  prioritySupport: boolean
  developerSpaceEnabled: boolean
}

export function getPlanDisplayName(plan: Pick<Plan, 'slug' | 'name'>): string {
  if (plan.slug === 'personal') return 'Персональный'
  if (plan.slug === 'pro') return 'ПРО'
  if (plan.slug === 'max') return 'МАКС'
  return plan.name
}
