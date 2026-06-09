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
  publicSitesEnabled: boolean
  /**
   * Page-revision retention window in days, or `null` for unlimited.
   * Parsed from `Plan.features` JSON: an entry `"pageHistory:30"` → 30,
   * `"pageHistory:unlimited"` → null. When absent, the default depends on
   * `isPaid`: paid plans default to `null` (unlimited), the free/personal
   * plan defaults to {@link DEFAULT_FREE_PAGE_HISTORY_DAYS} (7 days).
   */
  pageHistoryDays: number | null
}

/** Default retention window (days) for the free/personal plan when `Plan.features` has no `pageHistory:` entry. */
export const DEFAULT_FREE_PAGE_HISTORY_DAYS = 7

/**
 * Derive `pageHistoryDays` from a plan's `features` JSON array.
 * - `"pageHistory:unlimited"` → `null` (unlimited)
 * - `"pageHistory:<n>"` → `n` (a positive integer)
 * - absent → `null` for paid plans, {@link DEFAULT_FREE_PAGE_HISTORY_DAYS} for free
 */
export function parsePageHistoryDays(features: unknown, isPaid: boolean): number | null {
  if (Array.isArray(features)) {
    for (const entry of features) {
      if (typeof entry !== 'string') continue
      if (!entry.startsWith('pageHistory:')) continue
      const raw = entry.slice('pageHistory:'.length).trim()
      if (raw === 'unlimited') return null
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return isPaid ? null : DEFAULT_FREE_PAGE_HISTORY_DAYS
}

export function getPlanDisplayName(plan: Pick<Plan, 'slug' | 'name'>): string {
  if (plan.slug === 'personal') return 'Персональный'
  if (plan.slug === 'pro') return 'ПРО'
  if (plan.slug === 'max') return 'МАКС'
  return plan.name
}
