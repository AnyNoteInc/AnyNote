import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'
import type { Payment, Refund } from '@repo/yookassa'

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

    // the creator's OWNER seat lands in the billing ledger, same tx (8D)
    const joined = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'MEMBER_JOINED' },
    })
    expect(joined).toHaveLength(1)
    expect(joined[0]).toMatchObject({ targetUserId: owner.id, actorId: owner.id })
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
    await handlePaymentSucceeded({ yookassa: fakeYookassa, prisma }, {
      id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Payment)

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
    await handleRefundSucceeded({ yookassa: { getPayment: async () => ({}) as Payment }, prisma }, {
      id: `refund-${owner.id}`,
      payment_id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Refund)
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxFileBytes).toBe(524_288_000n)
  })
})

describe('handlePaymentSucceeded seat-purchase orders (8D)', () => {
  beforeEach(cleanFixtures)

  function fakeYookassaFor(paymentId: string) {
    return {
      getPayment: async () => ({
        id: paymentId,
        status: 'succeeded' as const,
        payment_method: undefined,
      }),
    }
  }

  async function setupSeatOrder(ownerId: string, workspaceId: string, seats: number) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    return prisma.order.create({
      data: {
        userId: ownerId,
        planId: plan.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: 12_345,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: false,
        metadata: { kind: 'seat_purchase', workspaceId, seats },
        yookassaIdempotencyKey: `idem-seat-${ownerId}-${Date.now()}`,
        yookassaPaymentId: `pay-seat-${ownerId}-${Date.now()}`,
      },
    })
  }

  it('flips the order PAID and applies the seats — no subscription rows, no limits sync', async () => {
    const owner = await makeOwner('sa')
    const ws = await makeWorkspace(owner.id)
    await syncWorkspaceLimits(prisma, owner.id) // personal baseline stays pinned

    const order = await setupSeatOrder(owner.id, ws.id, 2)
    await handlePaymentSucceeded({ yookassa: fakeYookassaFor(order.yookassaPaymentId!), prisma }, {
      id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Payment)

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(paid.status).toBe('PAID')
    expect(paid.paidAt).not.toBeNull()
    expect(paid.subscriptionId).toBeNull()

    const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
    expect(addon?.paidSeats).toBe(2)

    const events = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'SEATS_PURCHASED' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      seatsDelta: 2,
      seatsAfter: 2,
      amountKopecks: 12_345,
      orderId: order.id,
      actorId: owner.id,
    })
    expect(
      await prisma.workspaceAuditLog.count({
        where: { workspaceId: ws.id, action: 'seats.purchased' },
      }),
    ).toBe(1)

    // pinned: NO subscription upsert, NO syncWorkspaceLimits for seat orders
    expect(await prisma.subscription.count({ where: { userId: owner.id } })).toBe(0)
    const limit = await prisma.workspaceLimit.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(limit.sourcePlanSlug).toBe('personal')
    expect(limit.maxMembers).toBe(1)
  })

  it('a double success callback converges: seats and ledger applied once', async () => {
    const owner = await makeOwner('sb')
    const ws = await makeWorkspace(owner.id)
    const order = await setupSeatOrder(owner.id, ws.id, 3)
    const ctx = { yookassa: fakeYookassaFor(order.yookassaPaymentId!), prisma }
    const payment = { id: order.yookassaPaymentId!, status: 'succeeded' } as Payment

    await handlePaymentSucceeded(ctx, payment)
    await handlePaymentSucceeded(ctx, payment)

    const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
    expect(addon?.paidSeats).toBe(3)
    expect(
      await prisma.seatBillingEvent.count({
        where: { workspaceId: ws.id, type: 'SEATS_PURCHASED' },
      }),
    ).toBe(1)
  })
})

describe('handleRefundSucceeded seat-purchase orders (8D)', () => {
  beforeEach(cleanFixtures)

  it('flips the order REFUNDED only — addon seats NOT reverted, no subscription, no new ledger rows (spec §9 non-goal)', async () => {
    const owner = await makeOwner('sf')
    const ws = await makeWorkspace(owner.id)
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    // A settled seat purchase: PAID order (subscriptionId stays null for
    // seat orders), addon + SEATS_PURCHASED ledger row already applied.
    const order = await prisma.order.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: 12_345,
        currency: 'RUB',
        status: 'PAID',
        paidAt: new Date(),
        isInitial: false,
        metadata: { kind: 'seat_purchase', workspaceId: ws.id, seats: 2 },
        yookassaIdempotencyKey: `idem-seat-rf-${owner.id}-${Date.now()}`,
        yookassaPaymentId: `pay-seat-rf-${owner.id}-${Date.now()}`,
      },
    })
    await prisma.workspaceSeatAddon.create({
      data: { workspaceId: ws.id, paidSeats: 2 },
    })
    await prisma.seatBillingEvent.create({
      data: {
        workspaceId: ws.id,
        type: 'SEATS_PURCHASED',
        seatsDelta: 2,
        seatsAfter: 2,
        amountKopecks: 12_345,
        orderId: order.id,
        actorId: owner.id,
      },
    })

    const refundId = `refund-seat-${owner.id}`
    await handleRefundSucceeded({ yookassa: { getPayment: async () => ({}) as Payment }, prisma }, {
      id: refundId,
      payment_id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Refund)

    const refunded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
    expect(refunded.status).toBe('REFUNDED')
    expect(refunded.refundedAt).not.toBeNull()
    expect(refunded.yookassaRefundId).toBe(refundId)
    expect(refunded.subscriptionId).toBeNull()

    // pinned: spec §9 — mid-cycle refunds are a non-goal; seats stay applied
    const addon = await prisma.workspaceSeatAddon.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(addon.paidSeats).toBe(2)
    expect(addon.scheduledSeats).toBeNull()

    // no subscription was created or touched
    expect(await prisma.subscription.count({ where: { userId: owner.id } })).toBe(0)

    // no new ledger rows beyond the original purchase
    expect(await prisma.seatBillingEvent.count({ where: { workspaceId: ws.id } })).toBe(1)
  })
})

describe('handlePaymentSucceeded tier orders vs seat addons (8D)', () => {
  beforeEach(cleanFixtures)

  function fakeYookassaFor(paymentId: string) {
    return {
      getPayment: async () => ({
        id: paymentId,
        status: 'succeeded' as const,
        payment_method: undefined,
      }),
    }
  }

  it('INITIAL tier orders reset existing addons (plan_change)', async () => {
    const owner = await makeOwner('sc')
    const ws = await makeWorkspace(owner.id)
    await prisma.workspaceSeatAddon.create({
      data: { workspaceId: ws.id, paidSeats: 3, scheduledSeats: 1 },
    })
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    const order = await prisma.order.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: plan.priceMonthlyKopecks,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: true,
        yookassaIdempotencyKey: `idem-init-${owner.id}-${Date.now()}`,
        yookassaPaymentId: `pay-init-${owner.id}-${Date.now()}`,
      },
    })

    await handlePaymentSucceeded({ yookassa: fakeYookassaFor(order.yookassaPaymentId!), prisma }, {
      id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Payment)

    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: owner.id } })
    expect(sub.status).toBe('ACTIVE')

    const addon = await prisma.workspaceSeatAddon.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(addon.paidSeats).toBe(0)
    expect(addon.scheduledSeats).toBeNull()

    const resets = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'ADDONS_RESET' },
    })
    expect(resets).toHaveLength(1)
    expect(resets[0]?.metadata).toMatchObject({ reason: 'plan_change' })
    expect(
      await prisma.workspaceAuditLog.count({
        where: { workspaceId: ws.id, action: 'seats.addons_reset' },
      }),
    ).toBe(1)
  })

  async function setupRenewalFixture(label: string) {
    const owner = await makeOwner(label)
    const ws = await makeWorkspace(owner.id)
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
    })
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    const periodStart = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const periodEnd = new Date(Date.now() - 3600 * 1000)
    const sub = await prisma.subscription.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingPeriod: 'MONTHLY',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      },
    })
    const order = await prisma.order.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        subscriptionId: sub.id,
        billingPeriod: 'MONTHLY',
        amountKopecks: plan.priceMonthlyKopecks + plan.pricePerExtraSeatMonthlyKopecks,
        currency: 'RUB',
        status: 'PENDING',
        isInitial: false,
        savedPaymentMethod: true,
        yookassaIdempotencyKey: `idem-rnw-${owner.id}-${Date.now()}`,
        yookassaPaymentId: `pay-rnw-${owner.id}-${Date.now()}`,
      },
    })
    return { owner, ws, plan, sub, order, periodEnd }
  }

  it('a pending RENEWAL completing via webhook rolls the period AND applies scheduled seats exactly once', async () => {
    const { ws, plan, sub, order, periodEnd } = await setupRenewalFixture('sd')
    await prisma.workspaceSeatAddon.create({
      data: { workspaceId: ws.id, paidSeats: 2, scheduledSeats: 1 },
    })

    const ctx = { yookassa: fakeYookassaFor(order.yookassaPaymentId!), prisma }
    const payment = { id: order.yookassaPaymentId!, status: 'succeeded' } as Payment
    await handlePaymentSucceeded(ctx, payment)

    const rolled = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    expect(rolled.currentPeriodEnd!.getTime()).toBeGreaterThan(periodEnd.getTime())

    const addon = await prisma.workspaceSeatAddon.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(addon.paidSeats).toBe(1)
    expect(addon.scheduledSeats).toBeNull()

    const snapshots = await prisma.workspaceSeatSnapshot.findMany({
      where: { workspaceId: ws.id },
    })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      orderId: order.id,
      subscriptionId: sub.id,
      memberCount: 1,
      includedSeats: plan.maxMembersPerWorkspace,
      extraSeats: 1,
      seatAmountKopecks: plan.pricePerExtraSeatMonthlyKopecks,
    })

    const renewed = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'SEATS_RENEWED' },
    })
    expect(renewed).toHaveLength(1)
    expect(renewed[0]).toMatchObject({
      seatsDelta: -1,
      seatsAfter: 1,
      amountKopecks: plan.pricePerExtraSeatMonthlyKopecks,
      orderId: order.id,
      actorId: null,
    })
    expect(
      await prisma.workspaceAuditLog.count({
        where: { workspaceId: ws.id, action: 'seats.renewal_applied' },
      }),
    ).toBe(1)

    // pinned: non-initial orders never reset addons
    expect(
      await prisma.seatBillingEvent.count({
        where: { workspaceId: ws.id, type: 'ADDONS_RESET' },
      }),
    ).toBe(0)

    // double callback converges: nothing applied twice
    await handlePaymentSucceeded(ctx, payment)
    expect(await prisma.workspaceSeatSnapshot.count({ where: { workspaceId: ws.id } })).toBe(1)
    expect(
      await prisma.seatBillingEvent.count({
        where: { workspaceId: ws.id, type: 'SEATS_RENEWED' },
      }),
    ).toBe(1)
    expect(
      (await prisma.workspaceSeatAddon.findUniqueOrThrow({ where: { workspaceId: ws.id } }))
        .paidSeats,
    ).toBe(1)
  })

  it('a renewal completing without addons writes no seat records (flat-price regression)', async () => {
    const { ws, sub, order, periodEnd } = await setupRenewalFixture('se')

    await handlePaymentSucceeded({ yookassa: fakeYookassaFor(order.yookassaPaymentId!), prisma }, {
      id: order.yookassaPaymentId!,
      status: 'succeeded',
    } as Payment)

    const rolled = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    expect(rolled.currentPeriodEnd!.getTime()).toBeGreaterThan(periodEnd.getTime())
    expect(await prisma.workspaceSeatSnapshot.count({ where: { workspaceId: ws.id } })).toBe(0)
    expect(await prisma.seatBillingEvent.count({ where: { workspaceId: ws.id } })).toBe(0)
  })
})

describe('inviteMember enforces member limit', () => {
  beforeEach(cleanFixtures)

  it('rejects invite when memberCount >= maxMembers', async () => {
    const owner = await makeOwner('k')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'WS' }) // OWNER counts as 1
    // Fill up to maxMembers (5) — add 4 more
    for (let i = 0; i < 4; i++) {
      const u = await prisma.user.create({
        data: {
          email: `inv${i}${EMAIL_SUFFIX}`,
          emailVerified: true,
          name: `Inv${i}`,
          firstName: `Inv${i}`,
          lastName: 'T',
        },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'EDITOR' },
      })
    }
    const extra = await prisma.user.create({
      data: {
        email: `extra${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'Extra',
        firstName: 'Extra',
        lastName: 'T',
      },
    })
    await expect(
      caller.inviteMember({ workspaceId: ws.id, email: extra.email, role: 'EDITOR' }),
    ).rejects.toThrow(/Достигнут лимит участников/)

    // purchased seats lift the legacy pre-check: capacity = maxMembers + paidSeats (8D)
    await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 1 } })
    const member = await caller.inviteMember({
      workspaceId: ws.id,
      email: extra.email,
      role: 'EDITOR',
    })
    expect(member.role).toBe('EDITOR')

    // the actual create wrote exactly one MEMBER_JOINED ledger row (8D)
    const joined = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'MEMBER_JOINED', targetUserId: extra.id },
    })
    expect(joined).toHaveLength(1)
    expect(joined[0]).toMatchObject({ actorId: owner.id })
  })

  it('the capacity re-check runs INSIDE the member tx: a refused invite leaves no member row and no ledger row', async () => {
    const owner = await makeOwner('l')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'WS' }) // OWNER counts as 1
    // Pre-fill to capacity (maxMembers 5): the in-tx re-read sees a FULL
    // workspace and must refuse atomically with the upsert it guards.
    for (let i = 0; i < 4; i++) {
      const u = await prisma.user.create({
        data: {
          email: `fill${i}${EMAIL_SUFFIX}`,
          emailVerified: true,
          name: `Fill${i}`,
          firstName: `Fill${i}`,
          lastName: 'T',
        },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'EDITOR' },
      })
    }
    const late = await prisma.user.create({
      data: {
        email: `late${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'Late',
        firstName: 'Late',
        lastName: 'T',
      },
    })
    await expect(
      caller.inviteMember({ workspaceId: ws.id, email: late.email, role: 'EDITOR' }),
    ).rejects.toThrow(/Достигнут лимит участников/)

    // the FORBIDDEN rollback left nothing behind: no seat taken, no billing record
    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: late.id } },
      }),
    ).toBeNull()
    expect(
      await prisma.seatBillingEvent.count({
        where: { workspaceId: ws.id, type: 'MEMBER_JOINED', targetUserId: late.id },
      }),
    ).toBe(0)
  })

  it('allows role update for existing member even when memberCount equals maxMembers', async () => {
    const owner = await makeOwner('m')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'WS' }) // OWNER counts as 1
    // Fill up to maxMembers (5)
    const editorEmails: string[] = []
    for (let i = 0; i < 4; i++) {
      const email = `mem${i}${EMAIL_SUFFIX}`
      editorEmails.push(email)
      const u = await prisma.user.create({
        data: {
          email,
          emailVerified: true,
          name: `M${i}`,
          firstName: `M${i}`,
          lastName: 'T',
        },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: u.id, role: 'EDITOR' },
      })
    }
    // Re-invite the first existing member with a NEW role — should succeed (role upsert)
    const updated = await caller.inviteMember({
      workspaceId: ws.id,
      email: editorEmails[0]!,
      role: 'ADMIN',
    })
    expect(updated.role).toBe('ADMIN')

    // a role update is NOT a join: no MEMBER_JOINED ledger row for the member (8D)
    const joined = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'MEMBER_JOINED', targetUserId: updated.userId },
    })
    expect(joined).toHaveLength(0)
  })

  it('removeMember writes a MEMBER_REMOVED ledger row in the same tx (8D)', async () => {
    const owner = await makeOwner('n')
    const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
    await prisma.subscription.create({
      data: { userId: owner.id, planId: pro.id, status: 'ACTIVE' },
    })
    const caller = createCallerFactory(workspaceRouter)({
      prisma,
      user: { id: owner.id, email: owner.email },
      headers: new Headers(),
      resHeaders: new Headers(),
      yookassa: {} as never,
      returnUrlBase: 'http://localhost:3000',
    })
    const ws = await caller.create({ name: 'WS' })
    const member = await prisma.user.create({
      data: {
        email: `removee${EMAIL_SUFFIX}`,
        emailVerified: true,
        name: 'Removee',
        firstName: 'Removee',
        lastName: 'T',
      },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    })

    await caller.removeMember({ workspaceId: ws.id, userId: member.id })

    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: member.id } },
      }),
    ).toBeNull()
    const removed = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'MEMBER_REMOVED' },
    })
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ targetUserId: member.id, actorId: owner.id })
  })
})
