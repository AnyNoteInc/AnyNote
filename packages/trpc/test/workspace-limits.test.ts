import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { syncWorkspaceLimits, resolveActivePlanOrPersonal } from '../src/helpers/plan'
import { workspaceRouter } from '../src/routers/workspace'
import { handlePaymentSucceeded, handleRefundSucceeded } from '../src/services/billing'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+wslimits-test@anynote.dev'

async function cleanFixtures() {
  await prisma.order.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspaceLimit.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({
    where: { email: { contains: EMAIL_SUFFIX } },
  })
}

async function makeOwner(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

async function makeWorkspace(ownerId: string, name = 'WS') {
  return prisma.workspace.create({
    data: { name, createdById: ownerId },
    select: { id: true },
  })
}

describe('resolveActivePlanOrPersonal', () => {
  beforeEach(cleanFixtures)

  it('returns personal plan when no active subscription', async () => {
    const owner = await makeOwner('a')
    const plan = await resolveActivePlanOrPersonal(prisma, owner.id)
    expect(plan.slug).toBe('personal')
  })

  it('returns the active subscription plan', async () => {
    const owner = await makeOwner('b')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const plan = await resolveActivePlanOrPersonal(prisma, owner.id)
    expect(plan.slug).toBe('pro')
  })
})

describe('syncWorkspaceLimits', () => {
  beforeEach(cleanFixtures)

  it('upserts limits from personal plan when owner has no subscription', async () => {
    const owner = await makeOwner('c')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxMembers).toBe(1)
    expect(limit.maxFileBytes).toBe(524_288_000n)
  })

  it('updates existing limits when plan changes', async () => {
    const owner = await makeOwner('d')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)

    const max = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: max.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id)

    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('max')
    expect(limit.maxMembers).toBe(20)
    expect(limit.maxFileBytes).toBe(21_474_836_480n)
  })

  it('applies the same plan to multiple workspaces of the owner', async () => {
    const owner = await makeOwner('e')
    const ws1 = await makeWorkspace(owner.id, 'WS1')
    const ws2 = await makeWorkspace(owner.id, 'WS2')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id)
    const rows = await prisma.workspaceLimit.findMany({
      where: { workspaceId: { in: [ws1.id, ws2.id] } },
    })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.sourcePlanSlug).toBe('pro')
      expect(r.maxMembers).toBe(5)
      expect(r.maxFileBytes).toBe(5_368_709_120n)
    }
  })

  it('is idempotent — calling twice yields the same result', async () => {
    const owner = await makeOwner('f')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id)
    const first = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    await syncWorkspaceLimits(prisma, owner.id)
    const second = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(second.maxMembers).toBe(first.maxMembers)
    expect(second.maxFileBytes).toBe(first.maxFileBytes)
  })

  it('works inside a $transaction', async () => {
    const owner = await makeOwner('g')
    const ws1 = await makeWorkspace(owner.id, 'WS1')
    const ws2 = await makeWorkspace(owner.id, 'WS2')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    await prisma.$transaction(async (tx) => {
      await syncWorkspaceLimits(tx, owner.id)
    })
    const rows = await prisma.workspaceLimit.findMany({
      where: { workspaceId: { in: [ws1.id, ws2.id] } },
    })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.sourcePlanSlug).toBe('pro')
    }
  })
})

describe('workspace.create wires limits', () => {
  beforeEach(cleanFixtures)

  it('creates a WorkspaceLimit row from the owner plan', async () => {
    const owner = await makeOwner('h')
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: personal.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'TestWS' })
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxMembers).toBe(1)
  })
})

describe('billing transitions sync limits', () => {
  beforeEach(cleanFixtures)

  async function setupPendingOrder(ownerId: string, planSlug: 'pro' | 'max') {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: planSlug } })
    const order = await prisma.order.create({
      data: {
        userId: ownerId,
        planId: plan.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: plan.priceMonthlyKopecks,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: true,
        yookassaIdempotencyKey: `idem-${ownerId}-${Date.now()}`,
        yookassaPaymentId: `pay-${ownerId}-${Date.now()}`,
      },
    })
    return { order, plan }
  }

  it('handlePaymentSucceeded upgrades limits on owned workspaces', async () => {
    const owner = await makeOwner('i')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id) // start at personal

    const { order } = await setupPendingOrder(owner.id, 'max')
    const fakeYookassa = {
      getPayment: async () => ({
        id: order.yookassaPaymentId!,
        status: 'succeeded' as const,
        payment_method: undefined,
      }),
    }
    await handlePaymentSucceeded(
      { yookassa: fakeYookassa, prisma },
      { id: order.yookassaPaymentId!, status: 'succeeded' } as never,
    )

    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('max')
    expect(limit.maxFileBytes).toBe(21_474_836_480n)
  })

  it('handleRefundSucceeded downgrades limits to personal', async () => {
    const owner = await makeOwner('j')
    const ws = await makeWorkspace(owner.id)
    const max = await prisma.plan.findUniqueOrThrow({ where: { slug: 'max' } })
    const sub = await prisma.subscription.create({
      data: { userId: owner.id, planId: max.id, status: 'ACTIVE' },
    })
    await syncWorkspaceLimits(prisma, owner.id) // start at max

    const order = await prisma.order.create({
      data: {
        userId: owner.id,
        planId: max.id,
        subscriptionId: sub.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: max.priceMonthlyKopecks,
        currency: 'RUB',
        status: 'PAID',
        yookassaIdempotencyKey: `idem-r-${owner.id}-${Date.now()}`,
        yookassaPaymentId: `pay-r-${owner.id}-${Date.now()}`,
      },
    })
    await handleRefundSucceeded(
      { yookassa: { getPayment: async () => ({}) as never }, prisma },
      { id: `refund-${owner.id}`, payment_id: order.yookassaPaymentId!, status: 'succeeded' } as never,
    )
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxFileBytes).toBe(524_288_000n)
  })
})
