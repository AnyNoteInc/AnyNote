import { prisma } from "@repo/db"
import type { Plan, PrismaClient } from "@repo/db"

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
