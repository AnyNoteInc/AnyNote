import { TRPCError } from '@trpc/server'
import { prisma } from '@repo/db'
import type { AiModel, AiProvider, Plan, Prisma, PrismaClient } from '@repo/db'

export async function getActivePlanForUser(prismaClient: PrismaClient, userId: string) {
  const subscription = await prismaClient.subscription.findFirst({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!subscription) {
    throw new Error(`User ${userId} has no active subscription`)
  }
  return { subscription, plan: subscription.plan }
}

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
  prioritySupport: boolean
  developerSpaceEnabled: boolean
}

export function getPlanDisplayName(plan: Pick<Plan, 'slug' | 'name'>): string {
  if (plan.slug === 'personal') return 'Персональный'
  if (plan.slug === 'pro') return 'ПРО'
  if (plan.slug === 'max') return 'МАКС'
  return plan.name
}

function planToFeatures(plan: Plan): PlanFeatures {
  return {
    slug: plan.slug as PlanFeatures['slug'],
    name: getPlanDisplayName(plan),
    sortOrder: plan.sortOrder,
    isPaid: plan.slug !== 'personal',
    maxWorkspaces: plan.maxWorkspaces,
    maxMembersPerWorkspace: plan.maxMembersPerWorkspace,
    chatsEnabled: plan.chatsEnabled,
    pageIndexingEnabled: plan.pageIndexingEnabled,
    membersSettingsEnabled: plan.membersSettingsEnabled,
    aiSettingsEnabled: plan.aiSettingsEnabled,
    customMcpEnabled: plan.customMcpEnabled,
    prioritySupport: plan.prioritySupport,
    developerSpaceEnabled: plan.developerSpaceEnabled,
  }
}

export async function getAvailableAiModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: false,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}

export async function getAvailableEmbeddingModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: true,
      vectorSize: { not: null },
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}

export async function getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true },
  })
  if (!workspace?.createdById) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }
  const sub = await prisma.subscription.findFirst({
    where: { userId: workspace.createdById, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  })
  if (!sub) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }
  return planToFeatures(sub.plan)
}

export async function requireWritableWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true, createdAt: true },
  })
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' })

  const features = await getWorkspaceFeatures(workspaceId)
  if (features.maxWorkspaces === null) return

  const olderCount = await prisma.workspace.count({
    where: { createdById: workspace.createdById, createdAt: { lt: workspace.createdAt } },
  })
  if (olderCount >= features.maxWorkspaces) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'WORKSPACE_OVER_PLAN_LIMIT' })
  }
}

type TxClient = PrismaClient | Prisma.TransactionClient

export async function resolveActivePlanOrPersonal(tx: TxClient, userId: string): Promise<Plan> {
  const sub = await tx.subscription.findFirst({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  return sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { slug: 'personal' } }))
}

export async function syncWorkspaceLimits(tx: TxClient, userId: string): Promise<void> {
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
