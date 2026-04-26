import { describe, it, expect, beforeEach } from "vitest"
import { prisma } from "@repo/db"
import { getWorkspaceFeatures, getAvailableAiModels } from "../src/helpers/plan"

describe("getWorkspaceFeatures", () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: "+plan-test@anynote.dev" } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: "+plan-test@anynote.dev" } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: "+plan-test@anynote.dev" } },
    })

    const owner = await prisma.user.create({
      data: {
        email: "wf+plan-test@anynote.dev",
        emailVerified: true,
        name: "Test",
        firstName: "Test",
        lastName: "User",
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: "Test WS", createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  it("returns personal features when owner has no active subscription", async () => {
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe("personal")
    expect(features.chatsEnabled).toBe(false)
    expect(features.isPaid).toBe(false)
  })

  it("returns pro features when owner has ACTIVE pro subscription", async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: "pro" } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: pro.id,
        status: "ACTIVE",
        billingPeriod: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    const features = await getWorkspaceFeatures(workspaceId)
    expect(features.slug).toBe("pro")
    expect(features.chatsEnabled).toBe(true)
    expect(features.isPaid).toBe(true)
    expect(features.maxMembersPerWorkspace).toBe(5)
  })
})

describe("getAvailableAiModels", () => {
  let workspaceId: string
  let ownerId: string

  beforeEach(async () => {
    // clean fixtures from previous runs
    await prisma.subscription.deleteMany({
      where: { user: { email: { contains: "+plan-test@anynote.dev" } } },
    })
    await prisma.workspace.deleteMany({
      where: { createdBy: { email: { contains: "+plan-test@anynote.dev" } } },
    })
    await prisma.user.deleteMany({
      where: { email: { contains: "+plan-test@anynote.dev" } },
    })

    const owner = await prisma.user.create({
      data: {
        email: "wf+plan-test@anynote.dev",
        emailVerified: true,
        name: "Test",
        firstName: "Test",
        lastName: "User",
      },
    })
    ownerId = owner.id
    const ws = await prisma.workspace.create({
      data: { name: "Test WS", createdById: owner.id },
      select: { id: true },
    })
    workspaceId = ws.id
  })

  it("returns models with minPlanSlug=null and Pro-eligible models for Pro workspace", async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: "pro" } })
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId: pro.id,
        status: "ACTIVE",
        billingPeriod: "MONTHLY",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
      },
    })
    const models = await getAvailableAiModels(workspaceId)
    const slugs = models.map((m) => m.slug).sort()
    // assumes seed ran; we expect at minimum gigachat-2 and gigachat-2-pro
    expect(slugs).toContain("gigachat-2")
    expect(slugs).toContain("gigachat-2-pro")
    // should NOT include gigachat-2-max (requires Max plan)
    expect(slugs).not.toContain("gigachat-2-max")
  })

  it("returns no Max-only models for Personal workspace", async () => {
    // no subscription created → defaults to personal
    const models = await getAvailableAiModels(workspaceId)
    const slugs = models.map((m) => m.slug)
    expect(slugs).not.toContain("gigachat-2-pro")
    expect(slugs).not.toContain("gigachat-2-max")
  })
})
