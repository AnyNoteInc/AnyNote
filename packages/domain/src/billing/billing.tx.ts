import type { Plan } from '@repo/db'

import type { Db } from '../shared/unit-of-work.ts'
import { activeSubscriptionWithPlanArgs } from './active-subscription.ts'

/**
 * Standalone tx-carve-out functions. These operate directly on a raw Prisma client / tx handle
 * passed by the caller (engines billing cron, trpc webhook handler, workspace.create, etc.).
 * They are NOT registered in the DI container — callers compose them into their own transactions.
 */

export async function resolveActivePlanOrPersonal(tx: Db, userId: string): Promise<Plan> {
  const sub = await tx.subscription.findFirst(activeSubscriptionWithPlanArgs(userId))
  return sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { slug: 'personal' } }))
}

export async function syncWorkspaceLimits(tx: Db, userId: string): Promise<void> {
  const plan = await resolveActivePlanOrPersonal(tx, userId)
  const workspaces = await tx.workspace.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  if (workspaces.length === 0) return
  const now = new Date()
  for (const w of workspaces) {
    await tx.workspaceLimit.upsert({
      where: { workspaceId: w.id },
      create: {
        workspaceId: w.id,
        maxMembers: plan.maxMembersPerWorkspace,
        maxFileBytes: plan.maxFileBytes,
        sourcePlanSlug: plan.slug,
        syncedAt: now,
      },
      update: {
        maxMembers: plan.maxMembersPerWorkspace,
        maxFileBytes: plan.maxFileBytes,
        sourcePlanSlug: plan.slug,
        syncedAt: now,
      },
    })
  }
}
