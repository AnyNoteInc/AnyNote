import { TRPCError } from "@trpc/server"
import { prisma } from "@repo/db"
import type { AiModel, AiProvider, Plan, PrismaClient } from "@repo/db"

export async function getActivePlanForUser(prismaClient: PrismaClient, userId: string) {
  const subscription = await prismaClient.subscription.findFirst({
    where: { userId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  })
  if (!subscription) {
    throw new Error(`User ${userId} has no active subscription`)
  }
  return { subscription, plan: subscription.plan }
}

export type PlanFeatures = {
  slug: "personal" | "pro" | "max"
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

function planToFeatures(plan: Plan): PlanFeatures {
  return {
    slug: plan.slug as PlanFeatures["slug"],
    name: plan.name,
    sortOrder: plan.sortOrder,
    isPaid: plan.slug !== "personal",
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
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: "asc" },
  })
}

export async function getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true },
  })
  if (!workspace?.createdById) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: "personal" } })
    return planToFeatures(personal)
  }
  const sub = await prisma.subscription.findFirst({
    where: { userId: workspace.createdById, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })
  if (!sub) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: "personal" } })
    return planToFeatures(personal)
  }
  return planToFeatures(sub.plan)
}

export async function requireWritableWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true, createdAt: true },
  })
  if (!workspace) throw new TRPCError({ code: "NOT_FOUND" })

  const features = await getWorkspaceFeatures(workspaceId)
  if (features.maxWorkspaces === null) return

  const olderCount = await prisma.workspace.count({
    where: { createdById: workspace.createdById, createdAt: { lt: workspace.createdAt } },
  })
  if (olderCount >= features.maxWorkspaces) {
    throw new TRPCError({ code: "FORBIDDEN", message: "WORKSPACE_OVER_PLAN_LIMIT" })
  }
}
