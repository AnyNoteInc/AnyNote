import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'

// The SendSay edge is the only mocked module (vi.mock keeps the other exports
// real) — everything else runs against postgres. Captured sends pin the
// operator-mail contract of createInvoiceRequest.
const { mailMock } = vi.hoisted(() => ({
  mailMock: {
    sent: [] as Array<{ kind: string; to: string; data: Record<string, unknown> }>,
  },
}))

vi.mock('@repo/mail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/mail')>()
  return {
    ...actual,
    sendMailNow: vi.fn(async (args: { kind: string; to: string; data: Record<string, unknown> }) => {
      mailMock.sent.push(args)
    }),
  }
})

import { prisma } from '@repo/db'
import { YookassaApiError, type Payment } from '@repo/yookassa'

import { billingRouter } from '../src/routers/billing'
import { peopleRouter } from '../src/routers/people'
import { subscriptionRouter } from '../src/routers/subscription'
import { handlePaymentSucceeded } from '../src/services/billing'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the billing router (Phase 8D Task 5): the gate
// matrix (member nowhere, ADMIN view-only, money procs subscription-holder
// only), purchaseSeats end-to-end against a faked YooKassa (order amount =
// the proration expectation, idempotent success callback), reduction guards,
// the seat-events keyset, the invoice-request workflow with the operator mail,
// the invite-preview extension, and subscription.nextChargePreview.
// Email-suffix fixture namespace, self-cleaning. Requires `docker compose up
// -d` (postgres).

const EMAIL_SUFFIX = '+billing-router-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
// Dedicated paid plan: flipping seat prices on the shared dev DB's seeded
// plans would be a DB-wide change (the people-router-suite precedent).
const PLAN_SLUG = 'billing-router-test-pro'
const RETURN_URL_BASE = 'http://app.test'
const FORBIDDEN_MESSAGE = 'Недостаточно прав'
const NOT_HOLDER_MESSAGE = 'Управлять платными местами может только владелец подписки пространства'
const WS_NAME = 'BillingRouterWS'
const SEAT_PRICE_MONTHLY = 19000
const SEAT_PRICE_YEARLY = 190000
const TIER_PRICE_MONTHLY = 39000
const DAY_MS = 24 * 60 * 60 * 1000

const ORIGINAL_INVOICE_EMAIL = process.env.BILLING_INVOICE_EMAIL
const OPERATOR_EMAIL = 'billing-ops@anynote.test'

type FixtureUser = { id: string; email: string; firstName: string | null; lastName: string | null }

async function cleanFixtures() {
  const createdByContains = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const byCreatorWs = { workspace: createdByContains }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  // Orders reference the plan AND the user (restrictive FKs) — delete first.
  await prisma.order.deleteMany({ where: byUser })
  await prisma.subscription.deleteMany({ where: byUser })
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  // Seat addons / events / snapshots / invoice requests cascade with the workspace.
  await prisma.workspace.deleteMany({ where: createdByContains })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: PLAN_SLUG } })
}

function emailFor(label: string) {
  return `${label}-${RUN}${EMAIL_SUFFIX}`
}

async function makeUser(label: string): Promise<FixtureUser> {
  return prisma.user.create({
    data: {
      email: emailFor(label),
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
    select: { id: true, email: true, firstName: true, lastName: true },
  })
}

type MockYookassa = {
  createPayment?: ReturnType<typeof vi.fn>
  getPayment?: ReturnType<typeof vi.fn>
}

function ctxFor(user: FixtureUser, yookassa: MockYookassa = {}) {
  return {
    prisma,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerified: true,
    },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa,
    returnUrlBase: RETURN_URL_BASE,
    jobs: { kick: vi.fn() },
  } as never
}

const billing = (u: FixtureUser, yookassa: MockYookassa = {}) =>
  createCallerFactory(billingRouter)(ctxFor(u, yookassa))
const people = (u: FixtureUser) => createCallerFactory(peopleRouter)(ctxFor(u))
const subscription = (u: FixtureUser) => createCallerFactory(subscriptionRouter)(ctxFor(u))

async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function ensureSeatPlan() {
  return prisma.plan.upsert({
    where: { slug: PLAN_SLUG },
    update: {},
    create: {
      slug: PLAN_SLUG,
      name: 'Billing Router Test Pro',
      maxMembersPerWorkspace: 5,
      priceMonthlyKopecks: TIER_PRICE_MONTHLY,
      pricePerExtraSeatMonthlyKopecks: SEAT_PRICE_MONTHLY,
      pricePerExtraSeatYearlyKopecks: SEAT_PRICE_YEARLY,
      sortOrder: 98,
    },
  })
}

/**
 * A FUTURE-dated billing period: `now < periodStart` clamps the proration to
 * the full period (`prorateSeatPurchase` spec) so the expected order amount is
 * EXACTLY `seats × SEAT_PRICE_MONTHLY` — deterministic regardless of when the
 * test runs. Mid-period math is table-pinned in the domain proration suite.
 */
function futurePeriod() {
  const start = new Date(Date.now() + DAY_MS)
  return { start, end: new Date(start.getTime() + 30 * DAY_MS) }
}

/**
 * One holder OWNER (createdById + ACTIVE sub), a second OWNER-role member who
 * is NOT the subscription holder (the NOT_SUBSCRIPTION_OWNER matrix), an ADMIN
 * (view-only), and an EDITOR member — 4 member rows.
 */
async function seed() {
  await ensurePersonalPlan()
  const plan = await ensureSeatPlan()
  const owner = await makeUser('owner')
  const owner2 = await makeUser('owner2')
  const admin = await makeUser('admin')
  const member = await makeUser('member')
  const period = futurePeriod()
  await prisma.subscription.create({
    data: {
      userId: owner.id,
      planId: plan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: WS_NAME, createdById: owner.id },
    select: { id: true, name: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: owner2.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: admin.id, role: 'ADMIN' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  return { plan, owner, owner2, admin, member, ws, period }
}

/** A workspace whose owner has NO subscription — the personal-plan fallback. */
async function seedFreeWorkspace() {
  const freeOwner = await makeUser('free-owner')
  const ws = await prisma.workspace.create({
    data: { name: 'BillingFreeWS', createdById: freeOwner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: freeOwner.id, role: 'OWNER' },
  })
  return { freeOwner, ws }
}

function succeededPayment(paymentId: string): Payment {
  return {
    id: paymentId,
    status: 'succeeded',
    paid: true,
    amount: { value: '380.00', currency: 'RUB' },
    payment_method: { id: 'pm_1', type: 'bank_card', saved: true, card: { last4: '4242' } },
    created_at: '2026-06-12T00:00:00Z',
  } as Payment
}

function pendingPaymentFor(paymentId: string, confirmationUrl: string) {
  return {
    id: paymentId,
    status: 'pending',
    paid: false,
    amount: { value: '380.00', currency: 'RUB' },
    confirmation: { type: 'redirect', confirmation_url: confirmationUrl },
    created_at: '2026-06-12T00:00:00Z',
  }
}

const validInvoiceInput = (workspaceId: string) => ({
  workspaceId,
  legalName: 'ООО Ромашка',
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'г. Москва, ул. Тверская, д. 1',
  contactEmail: 'buh@romashka.example',
  periodMonths: 12,
  seats: 10,
  comment: 'Нужен счёт на год',
})

describe('billing router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    mailMock.sent.length = 0
    delete process.env.BILLING_INVOICE_EMAIL
  })

  afterAll(async () => {
    await cleanFixtures()
    if (ORIGINAL_INVOICE_EMAIL === undefined) delete process.env.BILLING_INVOICE_EMAIL
    else process.env.BILLING_INVOICE_EMAIL = ORIGINAL_INVOICE_EMAIL
  })

  // ── the gate matrix (spec §7.6) ─────────────────────────────────────────────

  it('pins member ⇒ FORBIDDEN on every billing procedure (all 7)', async () => {
    const { member, ws } = await seed()
    const caller = billing(member)
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['seatUsage', () => caller.seatUsage({ workspaceId: ws.id })],
      ['purchaseSeats', () => caller.purchaseSeats({ workspaceId: ws.id, seats: 1 })],
      ['scheduleReduction', () => caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 0 })],
      ['cancelReduction', () => caller.cancelReduction({ workspaceId: ws.id })],
      ['seatEvents', () => caller.seatEvents({ workspaceId: ws.id })],
      ['createInvoiceRequest', () => caller.createInvoiceRequest(validInvoiceInput(ws.id))],
      ['listInvoiceRequests', () => caller.listInvoiceRequests({ workspaceId: ws.id })],
    ]
    // Count-pinned: a new billing.* procedure MUST be added here.
    expect(calls).toHaveLength(7)
    for (const [name, call] of calls) {
      await expect(call(), `${name} must reject a plain member`).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
      })
    }
  })

  it('ADMIN may view seatUsage but nothing else (the other 6 FORBIDDEN)', async () => {
    const { admin, ws } = await seed()
    const caller = billing(admin)

    await expect(caller.seatUsage({ workspaceId: ws.id })).resolves.toMatchObject({
      memberCount: 4,
      paidSeats: 0,
    })

    const ownerOnly: Array<[string, () => Promise<unknown>]> = [
      ['purchaseSeats', () => caller.purchaseSeats({ workspaceId: ws.id, seats: 1 })],
      ['scheduleReduction', () => caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 0 })],
      ['cancelReduction', () => caller.cancelReduction({ workspaceId: ws.id })],
      ['seatEvents', () => caller.seatEvents({ workspaceId: ws.id })],
      ['createInvoiceRequest', () => caller.createInvoiceRequest(validInvoiceInput(ws.id))],
      ['listInvoiceRequests', () => caller.listInvoiceRequests({ workspaceId: ws.id })],
    ]
    expect(ownerOnly).toHaveLength(6)
    for (const [name, call] of ownerOnly) {
      await expect(call(), `${name} must be OWNER-only`).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
      })
    }
  })

  it('money procs are subscription-holder-only: a non-holder OWNER gets NOT_SUBSCRIPTION_OWNER; view stays open', async () => {
    const { owner2, ws } = await seed()
    await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 2 } })
    const caller = billing(owner2)

    const money: Array<[string, () => Promise<unknown>]> = [
      ['purchaseSeats', () => caller.purchaseSeats({ workspaceId: ws.id, seats: 1 })],
      ['scheduleReduction', () => caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 1 })],
      ['cancelReduction', () => caller.cancelReduction({ workspaceId: ws.id })],
    ]
    expect(money).toHaveLength(3)
    for (const [name, call] of money) {
      await expect(call(), `${name} must be holder-only`).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: NOT_HOLDER_MESSAGE,
      })
    }

    // OWNER-role view surfaces stay open to a non-holder owner (spec §5).
    await expect(caller.seatUsage({ workspaceId: ws.id })).resolves.toMatchObject({ paidSeats: 2 })
    await expect(caller.seatEvents({ workspaceId: ws.id })).resolves.toMatchObject({ items: [] })
    await expect(caller.listInvoiceRequests({ workspaceId: ws.id })).resolves.toEqual([])
  })

  // ── seatUsage ───────────────────────────────────────────────────────────────

  it('seatUsage returns the full usage shape', async () => {
    const { owner, ws, period } = await seed()
    await prisma.workspaceSeatAddon.create({
      data: { workspaceId: ws.id, paidSeats: 2, scheduledSeats: 1 },
    })

    await expect(billing(owner).seatUsage({ workspaceId: ws.id })).resolves.toEqual({
      memberCount: 4,
      includedSeats: 5,
      paidSeats: 2,
      scheduledSeats: 1,
      capacity: 7,
      seatPrice: {
        monthlyKopecks: SEAT_PRICE_MONTHLY,
        yearlyKopecks: SEAT_PRICE_YEARLY,
        currentKopecks: SEAT_PRICE_MONTHLY,
        billingPeriod: 'MONTHLY',
      },
      periodEnd: period.end,
      canPurchase: true,
    })
  })

  // ── purchaseSeats (spec §4.1) ───────────────────────────────────────────────

  it('purchaseSeats creates the PENDING seat order with the prorated amount and returns the confirmation url', async () => {
    const { plan, owner, ws } = await seed()
    const yookassa: MockYookassa = {
      createPayment: vi
        .fn()
        .mockResolvedValue(pendingPaymentFor('pmt_seat_1', 'https://yookassa.ru/pay/pmt_seat_1')),
    }

    const result = await billing(owner, yookassa).purchaseSeats({ workspaceId: ws.id, seats: 2 })
    expect(result.confirmationUrl).toBe('https://yookassa.ru/pay/pmt_seat_1')

    // The future-start fixture clamps the proration to the FULL period price.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orderId } })
    expect(order).toMatchObject({
      userId: owner.id,
      planId: plan.id,
      billingPeriod: 'MONTHLY',
      amountKopecks: 2 * SEAT_PRICE_MONTHLY,
      status: 'PENDING',
      isInitial: false,
      yookassaPaymentId: 'pmt_seat_1',
      metadata: { kind: 'seat_purchase', workspaceId: ws.id, seats: 2 },
    })

    const [payload, idempotencyKey] = yookassa.createPayment!.mock.calls[0]!
    expect(payload.amount).toEqual({ value: '380.00', currency: 'RUB' })
    expect(payload.description).toBe('Доплата за места')
    expect(payload.confirmation).toEqual({
      type: 'redirect',
      return_url: `${RETURN_URL_BASE}/billing/return?orderId=${result.orderId}`,
    })
    expect(payload.metadata).toMatchObject({ orderId: result.orderId, userId: owner.id })
    expect(typeof idempotencyKey).toBe('string')

    // No seats applied before the payment succeeds.
    expect(await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })).toBeNull()
  })

  it('the success callback applies the seats exactly once — a double callback converges', async () => {
    const { owner, ws } = await seed()
    const yookassa: MockYookassa = {
      createPayment: vi
        .fn()
        .mockResolvedValue(pendingPaymentFor('pmt_seat_2', 'https://yookassa.ru/pay/pmt_seat_2')),
    }
    const { orderId } = await billing(owner, yookassa).purchaseSeats({
      workspaceId: ws.id,
      seats: 2,
    })

    const successCtx = {
      prisma,
      yookassa: { getPayment: vi.fn().mockResolvedValue(succeededPayment('pmt_seat_2')) },
    }
    await handlePaymentSucceeded(successCtx, { id: 'pmt_seat_2' } as Payment)
    await handlePaymentSucceeded(successCtx, { id: 'pmt_seat_2' } as Payment)

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
    expect(order.status).toBe('PAID')
    // The seat-purchase path never touches subscription rows (spec §7.8).
    expect(order.subscriptionId).toBeNull()

    const addon = await prisma.workspaceSeatAddon.findUniqueOrThrow({
      where: { workspaceId: ws.id },
    })
    expect(addon).toMatchObject({ paidSeats: 2, scheduledSeats: null })

    const ledger = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'SEATS_PURCHASED' },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      seatsDelta: 2,
      seatsAfter: 2,
      amountKopecks: 2 * SEAT_PRICE_MONTHLY,
      orderId,
      actorId: owner.id,
    })

    const audits = await prisma.workspaceAuditLog.findMany({
      where: { workspaceId: ws.id, action: 'seats.purchased' },
    })
    expect(audits).toHaveLength(1)
  })

  it('purchaseSeats is refused when the holder has no seat-selling ACTIVE subscription', async () => {
    await seed()
    const { freeOwner, ws } = await seedFreeWorkspace()
    await expect(
      billing(freeOwner).purchaseSeats({ workspaceId: ws.id, seats: 1 }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'На текущем тарифе докупка мест недоступна — обновите тариф',
    })
    expect(await prisma.order.count({ where: { userId: freeOwner.id } })).toBe(0)
  })

  it('purchaseSeats marks the order FAILED when YooKassa rejects the payment', async () => {
    const { owner, ws } = await seed()
    const yookassa: MockYookassa = {
      createPayment: vi
        .fn()
        .mockRejectedValue(
          new YookassaApiError('forbidden: операция запрещена', 403, { code: 'forbidden' }),
        ),
    }

    await expect(
      billing(owner, yookassa).purchaseSeats({ workspaceId: ws.id, seats: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'forbidden: операция запрещена' })

    const orders = await prisma.order.findMany({ where: { userId: owner.id } })
    expect(orders).toHaveLength(1)
    expect(orders[0]!.status).toBe('FAILED')
    expect(await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })).toBeNull()
  })

  // ── reductions (spec §3/§7.4/§7.5) ──────────────────────────────────────────

  it('scheduleReduction guards via the router; schedule + cancel round-trip', async () => {
    const { owner, ws } = await seed()
    await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 3 } })
    const caller = billing(owner)

    // Target must be strictly below paidSeats.
    await expect(
      caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 5 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // Capacity after the reduction must still fit the 4 current members:
    // included 1 + target 2 = 3 < 4 ⇒ refused.
    await prisma.workspaceLimit.create({
      data: { workspaceId: ws.id, maxMembers: 1, maxFileBytes: 0, syncedAt: new Date() },
    })
    await expect(
      caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 2 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Нельзя сократить места ниже текущего числа участников — сначала удалите участников',
    })

    // included 5 + target 2 = 7 ≥ 4 ⇒ scheduled; paidSeats untouched (no mid-cycle refunds).
    await prisma.workspaceLimit.update({
      where: { workspaceId: ws.id },
      data: { maxMembers: 5 },
    })
    await expect(
      caller.scheduleReduction({ workspaceId: ws.id, targetSeats: 2 }),
    ).resolves.toEqual({ paidSeats: 3, scheduledSeats: 2 })

    const ledger = await prisma.seatBillingEvent.findMany({
      where: { workspaceId: ws.id, type: 'SEATS_REDUCTION_SCHEDULED' },
    })
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ seatsDelta: -1, actorId: owner.id })

    await expect(caller.cancelReduction({ workspaceId: ws.id })).resolves.toEqual({
      paidSeats: 3,
      scheduledSeats: null,
    })
  })

  // ── seatEvents (keyset 30) ──────────────────────────────────────────────────

  it('seatEvents pages the ledger keyset-style and maps actor names', async () => {
    const { owner, ws } = await seed()
    const base = Date.now() - 1000 * 1000
    await prisma.seatBillingEvent.createMany({
      data: Array.from({ length: 31 }, (_, i) => ({
        workspaceId: ws.id,
        type: 'SEATS_PURCHASED' as const,
        seatsDelta: 1,
        seatsAfter: i + 1,
        amountKopecks: SEAT_PRICE_MONTHLY,
        actorId: owner.id,
        createdAt: new Date(base + i * 1000),
      })),
    })

    const page1 = await billing(owner).seatEvents({ workspaceId: ws.id })
    expect(page1.items).toHaveLength(30)
    expect(page1.nextCursor).not.toBeNull()
    expect(page1.items[0]).toMatchObject({
      type: 'SEATS_PURCHASED',
      seatsDelta: 1,
      seatsAfter: 31,
      amountKopecks: SEAT_PRICE_MONTHLY,
      actorName: 'owner Test',
      targetName: null,
    })

    const page2 = await billing(owner).seatEvents({
      workspaceId: ws.id,
      cursor: page1.nextCursor!,
    })
    expect(page2.items).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()
    expect(page2.items[0]!.seatsAfter).toBe(1)
    const ids1 = new Set(page1.items.map((i) => i.id))
    expect(page2.items.some((i) => ids1.has(i.id))).toBe(false)
  })

  // ── invoice requests (spec §3) ──────────────────────────────────────────────

  it('createInvoiceRequest persists the row, audits, and mails the operator when BILLING_INVOICE_EMAIL is set', async () => {
    const { owner, ws } = await seed()
    process.env.BILLING_INVOICE_EMAIL = OPERATOR_EMAIL

    const request = await billing(owner).createInvoiceRequest(validInvoiceInput(ws.id))
    expect(request).toMatchObject({
      workspaceId: ws.id,
      userId: owner.id,
      legalName: 'ООО Ромашка',
      inn: '7707083893',
      kpp: '770701001',
      periodMonths: 12,
      seats: 10,
      status: 'NEW',
    })

    expect(mailMock.sent).toEqual([
      {
        kind: 'invoice-request',
        to: OPERATOR_EMAIL,
        data: {
          legalName: 'ООО Ромашка',
          inn: '7707083893',
          workspaceName: WS_NAME,
          ownerEmail: owner.email,
          seats: 10,
          periodMonths: 12,
          comment: 'Нужен счёт на год',
        },
      },
    ])

    expect(
      await prisma.invoiceRequest.count({ where: { workspaceId: ws.id, status: 'NEW' } }),
    ).toBe(1)
    expect(
      await prisma.workspaceAuditLog.count({
        where: { workspaceId: ws.id, action: 'invoice.requested', actorId: owner.id },
      }),
    ).toBe(1)
  })

  it('createInvoiceRequest skips the operator mail when the env is unset — the row is the record', async () => {
    const { owner, ws } = await seed()

    const request = await billing(owner).createInvoiceRequest(validInvoiceInput(ws.id))
    expect(request.status).toBe('NEW')
    expect(mailMock.sent).toHaveLength(0)
    expect(await prisma.invoiceRequest.count({ where: { workspaceId: ws.id } })).toBe(1)
  })

  it('invoice validation errors surface and nothing is persisted or mailed', async () => {
    const { owner, ws } = await seed()
    process.env.BILLING_INVOICE_EMAIL = OPERATOR_EMAIL
    const caller = billing(owner)

    await expect(
      caller.createInvoiceRequest({ ...validInvoiceInput(ws.id), inn: '12345' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'ИНН должен содержать ровно 10 или 12 цифр',
    })
    await expect(
      caller.createInvoiceRequest({ ...validInvoiceInput(ws.id), kpp: '77' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'КПП должен содержать ровно 9 цифр' })
    // 4 member rows occupy 4 seats — an invoice for fewer is refused.
    await expect(
      caller.createInvoiceRequest({ ...validInvoiceInput(ws.id), seats: 3 }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Количество мест в счёте не может быть меньше текущего числа участников',
    })

    expect(mailMock.sent).toHaveLength(0)
    expect(await prisma.invoiceRequest.count({ where: { workspaceId: ws.id } })).toBe(0)
  })

  it('listInvoiceRequests returns the workspace requests newest-first for any OWNER', async () => {
    const { owner, owner2, ws } = await seed()
    await billing(owner).createInvoiceRequest(validInvoiceInput(ws.id))
    await billing(owner).createInvoiceRequest({
      ...validInvoiceInput(ws.id),
      legalName: 'ООО Лютик',
      seats: 12,
    })

    const rows = await billing(owner2).listInvoiceRequests({ workspaceId: ws.id })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.legalName).toBe('ООО Лютик')
    expect(rows[1]!.legalName).toBe('ООО Ромашка')
  })

  // ── people.invitePreview extension (spec §5) ────────────────────────────────

  it('invitePreview reports atCapacity and the purchasable seat price', async () => {
    const { owner, ws } = await seed()

    // 4 members < 5 plan seats — not at capacity yet; the seat price is live.
    await expect(people(owner).invitePreview({ workspaceId: ws.id })).resolves.toMatchObject({
      currentMembers: 4,
      maxMembers: 5,
      atCapacity: false,
      seatPriceKopecks: SEAT_PRICE_MONTHLY,
    })

    // The operative limit drops to 4 ⇒ at capacity.
    await prisma.workspaceLimit.create({
      data: { workspaceId: ws.id, maxMembers: 4, maxFileBytes: 0, syncedAt: new Date() },
    })
    await expect(people(owner).invitePreview({ workspaceId: ws.id })).resolves.toMatchObject({
      currentMembers: 4,
      maxMembers: 4,
      atCapacity: true,
      seatPriceKopecks: SEAT_PRICE_MONTHLY,
    })

    // A purchased seat reopens the capacity.
    await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 1 } })
    await expect(people(owner).invitePreview({ workspaceId: ws.id })).resolves.toMatchObject({
      maxMembers: 5,
      atCapacity: false,
    })
  })

  it('invitePreview reports a null seat price when the plan sells no seats', async () => {
    await seed()
    const { freeOwner, ws } = await seedFreeWorkspace()
    const preview = await people(freeOwner).invitePreview({ workspaceId: ws.id })
    expect(preview.seatPriceKopecks).toBeNull()
  })

  // ── subscription.nextChargePreview (spec §6) ────────────────────────────────

  it('nextChargePreview returns the seat-aware renewal breakdown for the holder', async () => {
    const { owner, ws, period } = await seed()
    await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 2 } })

    const preview = await subscription(owner).nextChargePreview()
    expect(preview).not.toBeNull()
    expect(preview).toMatchObject({
      tierKopecks: TIER_PRICE_MONTHLY,
      totalSeatKopecks: 2 * SEAT_PRICE_MONTHLY,
      totalKopecks: TIER_PRICE_MONTHLY + 2 * SEAT_PRICE_MONTHLY,
    })
    expect(preview!.periodEnd).toEqual(period.end)
    expect(preview!.seatRows).toEqual([
      {
        workspaceId: ws.id,
        effectiveSeats: 2,
        seatKopecks: 2 * SEAT_PRICE_MONTHLY,
        memberCount: 4,
        includedSeats: 5,
      },
    ])

    // A scheduled reduction prices the NEXT renewal (scheduled ?? paid).
    await prisma.workspaceSeatAddon.update({
      where: { workspaceId: ws.id },
      data: { scheduledSeats: 1 },
    })
    await expect(subscription(owner).nextChargePreview()).resolves.toMatchObject({
      totalSeatKopecks: SEAT_PRICE_MONTHLY,
      totalKopecks: TIER_PRICE_MONTHLY + SEAT_PRICE_MONTHLY,
    })
  })

  it('nextChargePreview is null without an ACTIVE subscription', async () => {
    const { member } = await seed()
    await expect(subscription(member).nextChargePreview()).resolves.toBeNull()
  })
})
