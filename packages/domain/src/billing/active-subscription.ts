import type { Prisma, SubscriptionStatus } from '@repo/db'

/**
 * Single source of truth for "the user's current subscription" query shape,
 * shared by the DI'd {@link BillingRepository} and the standalone tx carve-outs
 * in `billing.tx.ts`. Keeping the status set + ordering here stops the two call
 * sites from drifting when the definition of an active subscription changes.
 */

/** Subscription statuses that count as "active enough" to resolve a plan. */
export const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['TRIAL', 'ACTIVE', 'PAST_DUE']

/** `findFirst` args selecting the latest active subscription for a user, with its plan. */
export function activeSubscriptionWithPlanArgs(
  userId: string,
): Prisma.SubscriptionFindFirstArgs & { include: { plan: true } } {
  return {
    where: { userId, status: { in: ACTIVE_SUBSCRIPTION_STATUSES } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  }
}
