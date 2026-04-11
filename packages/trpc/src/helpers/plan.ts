import type { PrismaClient } from "@repo/db"

export async function getActivePlanForUser(prisma: PrismaClient, userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    include: { plan: true },
    orderBy: { startedAt: "desc" },
  })
  if (!subscription) {
    throw new Error(`User ${userId} has no active subscription`)
  }
  return { subscription, plan: subscription.plan }
}
