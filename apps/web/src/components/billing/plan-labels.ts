import { getPlanDisplayName as domainGetPlanDisplayName } from '@repo/domain'

/**
 * Web-layer wrapper around the domain helper.
 * Accepts nullable/undefined slug and name to handle partial data from Prisma queries
 * (e.g. plan?.slug when subscription may be null).
 * The domain function takes Pick<Plan,'slug'|'name'> where both are non-nullable strings;
 * we normalise here before delegating.
 */
export function getPlanDisplayName(plan: {
  slug: string | null | undefined
  name?: string | null
}): string {
  if (!plan.slug) return plan.name ?? 'Персональный'
  return domainGetPlanDisplayName({ slug: plan.slug, name: plan.name ?? plan.slug })
}
