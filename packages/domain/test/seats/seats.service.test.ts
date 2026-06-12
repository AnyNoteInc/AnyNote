import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import type { DomainError } from '../../src/shared/errors.ts'
import { isDomainError } from '../../src/shared/errors.ts'
import { BILLING_AUDIT_ACTIONS } from '../../src/seats/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the seats domain service: billable-seat
// counting, the usage shape, purchase gates + apply semantics (NOT idempotent
// at this layer — the CALLER's order-status guard is the idempotency
// boundary), reduction guards + cancel, scheduled-seat application, the
// multi-workspace owner charge, addon reset idempotency, and invoice-request
// validation. Email-suffix fixture namespace, self-cleaning. Requires
// `docker compose up -d` (postgres).
// All asserts are FIXTURE-SCOPED (per-workspace / per-user) — never global.

const EMAIL_SUFFIX = '+seats-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
const SEATS_PLAN_SLUG = 'seats-test-pro'

const MONTHLY_SEAT_PRICE = 19000
const YEARLY_SEAT_PRICE = 190000
const PLAN_INCLUDED = 5

// RELATIVE dates: canPurchase compares currentPeriodEnd against the real
// clock, so a fixed period end would turn this suite into a time bomb the day
// it passes. Proration stays deterministic — it uses the injected `now`.
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_START = new Date(Date.now() - 15 * DAY_MS)
const PERIOD_END = new Date(PERIOD_START.getTime() + 30 * DAY_MS)
/** Exactly 15 of 30 days remaining — proration halves cleanly. */
const MID_PERIOD = new Date(PERIOD_START.getTime() + 15 * DAY_MS)

const domain = createDomain({ prisma, scheduler: makeScheduler() })

async function cleanFixtures() {
  const createdByContains = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const byCreatorWs = { workspace: createdByContains }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.seatBillingEvent.deleteMany({ where: byCreatorWs })
  await prisma.workspaceSeatSnapshot.deleteMany({ where: byCreatorWs })
  await prisma.invoiceRequest.deleteMany({ where: byCreatorWs })
  await prisma.workspaceSeatAddon.deleteMany({ where: byCreatorWs })
  await prisma.pageShareUser.deleteMany({
    where: { OR: [byUser, { pageShare: { page: byCreatorWs } }] },
  })
  await prisma.pageShare.deleteMany({ where: { page: byCreatorWs } })
  await prisma.page.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({ where: createdByContains })
  await prisma.subscription.deleteMany({ where: byUser })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: SEATS_PLAN_SLUG } })
}

function email(label: string) {
  return `${label}-${RUN}${EMAIL_SUFFIX}`
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: email(label),
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

// getSeatUsage falls back to the `personal` plan when the owner has no
// active-enough subscription — make it self-contained for a fresh CI DB.
async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function ensureSeatsPlan() {
  return prisma.plan.upsert({
    where: { slug: SEATS_PLAN_SLUG },
    update: {
      pricePerExtraSeatMonthlyKopecks: MONTHLY_SEAT_PRICE,
      pricePerExtraSeatYearlyKopecks: YEARLY_SEAT_PRICE,
    },
    create: {
      slug: SEATS_PLAN_SLUG,
      name: 'Seats Test Pro',
      maxMembersPerWorkspace: PLAN_INCLUDED,
      sortOrder: 97,
      pricePerExtraSeatMonthlyKopecks: MONTHLY_SEAT_PRICE,
      pricePerExtraSeatYearlyKopecks: YEARLY_SEAT_PRICE,
    },
  })
}

interface SeedOptions {
  billingPeriod?: 'MONTHLY' | 'YEARLY'
  /** null = no subscription at all (personal-tier owner). */
  subStatus?: 'ACTIVE' | 'PAST_DUE' | 'TRIAL' | null
  /** null = no WorkspaceLimit row. */
  maxMembers?: number | null
  addon?: { paidSeats: number; scheduledSeats?: number | null }
  /** Override the paid period (the ended-period canPurchase pin). */
  period?: { start: Date; end: Date }
}

async function seed(opts: SeedOptions = {}) {
  await ensurePersonalPlan()
  const plan = await ensureSeatsPlan()
  const owner = await makeUser('owner')
  if (opts.subStatus !== null) {
    await prisma.subscription.create({
      data: {
        userId: owner.id,
        planId: plan.id,
        status: opts.subStatus ?? 'ACTIVE',
        billingPeriod: opts.billingPeriod ?? 'MONTHLY',
        currentPeriodStart: opts.period?.start ?? PERIOD_START,
        currentPeriodEnd: opts.period?.end ?? PERIOD_END,
      },
    })
  }
  const ws = await prisma.workspace.create({
    data: { name: 'SeatsWS', createdById: owner.id },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  if (opts.maxMembers !== null) {
    await prisma.workspaceLimit.create({
      data: {
        workspaceId: ws.id,
        maxMembers: opts.maxMembers ?? PLAN_INCLUDED,
        maxFileBytes: 0,
        syncedAt: new Date(),
      },
    })
  }
  if (opts.addon) {
    await prisma.workspaceSeatAddon.create({
      data: {
        workspaceId: ws.id,
        paidSeats: opts.addon.paidSeats,
        scheduledSeats: opts.addon.scheduledSeats ?? null,
      },
    })
  }
  return { owner, ws, plan }
}

async function addMember(
  workspaceId: string,
  label: string,
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST',
) {
  const user = await makeUser(label)
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } })
  return user
}

async function expectDomainError(
  p: Promise<unknown>,
  code: string,
  httpStatus?: number,
): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    if (!isDomainError(e)) throw e
    expect(e.code).toBe(code)
    if (httpStatus !== undefined) expect(e.httpStatus).toBe(httpStatus)
    return e
  }
  throw new Error(`expected DomainError ${code}, but the promise resolved`)
}

function seatEvents(workspaceId: string, type?: string) {
  return prisma.seatBillingEvent.findMany({
    where: { workspaceId, ...(type ? { type: type as never } : {}) },
    orderBy: { createdAt: 'asc' },
  })
}

function auditRows(workspaceId: string, action: string) {
  return prisma.workspaceAuditLog.findMany({
    where: { workspaceId, action },
    orderBy: { createdAt: 'asc' },
  })
}

describe('seats service', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  it('resolves from the domain container', () => {
    expect(domain.seats).toBeDefined()
    expect(typeof domain.seats.countBillableSeats).toBe('function')
    expect(typeof domain.seats.getSeatUsage).toBe('function')
    expect(typeof domain.seats.beginSeatPurchase).toBe('function')
    expect(typeof domain.seats.applySeatPurchase).toBe('function')
    expect(typeof domain.seats.scheduleSeatReduction).toBe('function')
    expect(typeof domain.seats.cancelScheduledReduction).toBe('function')
    expect(typeof domain.seats.applyScheduledSeats).toBe('function')
    expect(typeof domain.seats.computeOwnerSeatCharge).toBe('function')
    expect(typeof domain.seats.resetAddonsForOwner).toBe('function')
    expect(typeof domain.seats.createInvoiceRequest).toBe('function')
    expect(typeof domain.seats.listInvoiceRequests).toBe('function')
  })

  // ── counting (spec §7.1/§7.2) ─────────────────────────────────────────────────

  describe('countBillableSeats', () => {
    it('counts every member role exactly once, owner included', async () => {
      const { ws } = await seed()
      await addMember(ws.id, 'admin', 'ADMIN')
      await addMember(ws.id, 'editor', 'EDITOR')
      await addMember(ws.id, 'commenter', 'COMMENTER')
      await addMember(ws.id, 'viewer', 'VIEWER')
      await addMember(ws.id, 'legacy-guest-role', 'GUEST')
      expect(await domain.seats.countBillableSeats(ws.id)).toBe(6)
    })

    it('excludes page-share guests (grant without a member row)', async () => {
      const { ws, owner } = await seed()
      const guest = await makeUser('guest')
      const page = await prisma.page.create({
        data: { workspaceId: ws.id, title: 'Shared', createdById: owner.id },
      })
      const share = await prisma.pageShare.create({
        data: { pageId: page.id, shareId: `seats-${RUN}` },
      })
      await prisma.pageShareUser.create({
        data: { pageShareId: share.id, userId: guest.id, role: 'READER' },
      })
      expect(await domain.seats.countBillableSeats(ws.id)).toBe(1)
    })

    it('keeps counting blocked members until removal', async () => {
      const { ws, owner } = await seed()
      const blocked = await addMember(ws.id, 'blocked', 'EDITOR')
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: blocked.id, blockedById: owner.id },
      })
      expect(await domain.seats.countBillableSeats(ws.id)).toBe(2)
    })
  })

  // ── usage shape (spec §3) ─────────────────────────────────────────────────────

  describe('getSeatUsage', () => {
    it('returns the full shape for an ACTIVE monthly owner with an addon', async () => {
      const { ws } = await seed({ addon: { paidSeats: 2, scheduledSeats: 1 } })
      await addMember(ws.id, 'editor', 'EDITOR')
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage).toEqual({
        memberCount: 2,
        includedSeats: PLAN_INCLUDED,
        paidSeats: 2,
        scheduledSeats: 1,
        capacity: PLAN_INCLUDED + 2,
        seatPrice: {
          monthlyKopecks: MONTHLY_SEAT_PRICE,
          yearlyKopecks: YEARLY_SEAT_PRICE,
          currentKopecks: MONTHLY_SEAT_PRICE,
          billingPeriod: 'MONTHLY',
        },
        periodEnd: PERIOD_END,
        canPurchase: true,
      })
    })

    it('picks the yearly seat price for a YEARLY owner', async () => {
      const { ws } = await seed({ billingPeriod: 'YEARLY' })
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.seatPrice).toEqual({
        monthlyKopecks: MONTHLY_SEAT_PRICE,
        yearlyKopecks: YEARLY_SEAT_PRICE,
        currentKopecks: YEARLY_SEAT_PRICE,
        billingPeriod: 'YEARLY',
      })
      expect(usage.canPurchase).toBe(true)
    })

    it('reports no seat price and canPurchase=false for a subscription-less (personal) owner', async () => {
      const { ws } = await seed({ subStatus: null, maxMembers: 1 })
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.seatPrice).toBeNull()
      expect(usage.canPurchase).toBe(false)
      expect(usage.periodEnd).toBeNull()
      expect(usage.includedSeats).toBe(1)
      expect(usage.capacity).toBe(1)
    })

    it('keeps the price visible but canPurchase=false when the subscription is PAST_DUE', async () => {
      const { ws } = await seed({ subStatus: 'PAST_DUE' })
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.seatPrice?.currentKopecks).toBe(MONTHLY_SEAT_PRICE)
      expect(usage.canPurchase).toBe(false)
    })

    it('reports canPurchase=false when the paid period has ended — ACTIVE status alone is not enough', async () => {
      // beginSeatPurchase would refuse with PERIOD_ENDED; canPurchase must
      // agree so the UI disables the buy button instead of 409ing.
      const endedPeriod = {
        start: new Date(Date.now() - 45 * DAY_MS),
        end: new Date(Date.now() - 15 * DAY_MS),
      }
      const { ws } = await seed({ period: endedPeriod })
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.seatPrice?.currentKopecks).toBe(MONTHLY_SEAT_PRICE)
      expect(usage.periodEnd).toEqual(endedPeriod.end)
      expect(usage.canPurchase).toBe(false)
    })

    it('defaults to zero paid seats when no addon row exists', async () => {
      const { ws } = await seed()
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.paidSeats).toBe(0)
      expect(usage.scheduledSeats).toBeNull()
      expect(usage.capacity).toBe(PLAN_INCLUDED)
    })

    it('prefers the WorkspaceLimit override over the plan included count', async () => {
      // The OPERATIVE capacity source is WorkspaceLimit (the people module's
      // seat enforcement) — usage must agree with enforcement, not the raw plan.
      const { ws } = await seed({ maxMembers: 3 })
      const usage = await domain.seats.getSeatUsage(ws.id)
      expect(usage.includedSeats).toBe(3)
      expect(usage.capacity).toBe(3)
    })
  })

  // ── purchase begin gates (spec §3/§7.6) ───────────────────────────────────────

  describe('beginSeatPurchase', () => {
    it('computes the prorated amount for the subscription-holding owner', async () => {
      const { ws, owner } = await seed()
      const result = await domain.seats.beginSeatPurchase({
        workspaceId: ws.id,
        actorId: owner.id,
        seats: 2,
        now: MID_PERIOD,
      })
      expect(result).toEqual({
        seats: 2,
        amountKopecks: 2 * (MONTHLY_SEAT_PRICE / 2), // half the period remains
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      })
    })

    it('rejects an OWNER-role member who is not the createdById subscription holder', async () => {
      const { ws } = await seed()
      const coOwner = await addMember(ws.id, 'co-owner', 'OWNER')
      await expectDomainError(
        domain.seats.beginSeatPurchase({
          workspaceId: ws.id,
          actorId: coOwner.id,
          seats: 1,
          now: MID_PERIOD,
        }),
        'NOT_SUBSCRIPTION_OWNER',
        403,
      )
    })

    it('rejects plans without a seat price (personal)', async () => {
      const { ws, owner } = await seed({ subStatus: null })
      await expectDomainError(
        domain.seats.beginSeatPurchase({
          workspaceId: ws.id,
          actorId: owner.id,
          seats: 1,
          now: MID_PERIOD,
        }),
        'SEATS_NOT_AVAILABLE',
        403,
      )
    })

    it('rejects when the subscription is not ACTIVE', async () => {
      const { ws, owner } = await seed({ subStatus: 'PAST_DUE' })
      await expectDomainError(
        domain.seats.beginSeatPurchase({
          workspaceId: ws.id,
          actorId: owner.id,
          seats: 1,
          now: MID_PERIOD,
        }),
        'SEATS_NOT_AVAILABLE',
        403,
      )
    })

    it('rejects seat counts outside 1..50', async () => {
      const { ws, owner } = await seed()
      for (const seats of [0, 51, -1, 1.5]) {
        await expectDomainError(
          domain.seats.beginSeatPurchase({
            workspaceId: ws.id,
            actorId: owner.id,
            seats,
            now: MID_PERIOD,
          }),
          'INVALID_SEAT_COUNT',
          400,
        )
      }
    })

    it('refuses when the paid period has ended', async () => {
      const { ws, owner } = await seed()
      await expectDomainError(
        domain.seats.beginSeatPurchase({
          workspaceId: ws.id,
          actorId: owner.id,
          seats: 1,
          now: new Date(PERIOD_END.getTime() + DAY_MS),
        }),
        'PERIOD_ENDED',
        409,
      )
    })
  })

  // ── purchase apply (spec §3; idempotency = the CALLER's order guard) ──────────

  describe('applySeatPurchase', () => {
    it('upserts the addon, writes the SEATS_PURCHASED ledger row and the audit, all in one tx', async () => {
      const { ws, owner } = await seed()
      const orderId = randomUUID()
      const result = await domain.seats.applySeatPurchase({
        workspaceId: ws.id,
        seats: 3,
        orderId,
        amountKopecks: 28500,
        actorId: owner.id,
      })
      expect(result.paidSeats).toBe(3)

      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.paidSeats).toBe(3)
      expect(addon?.scheduledSeats).toBeNull()

      const events = await seatEvents(ws.id, 'SEATS_PURCHASED')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        seatsDelta: 3,
        seatsAfter: 3,
        amountKopecks: 28500,
        orderId,
        actorId: owner.id,
      })

      const audits = await auditRows(ws.id, BILLING_AUDIT_ACTIONS.seatsPurchased)
      expect(audits).toHaveLength(1)
      expect(audits[0]?.actorId).toBe(owner.id)
      expect(audits[0]?.metadata).toMatchObject({ seats: 3, amountKopecks: 28500, orderId })
    })

    it('increments an existing addon', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 3 } })
      const result = await domain.seats.applySeatPurchase({
        workspaceId: ws.id,
        seats: 2,
        orderId: randomUUID(),
        amountKopecks: 19000,
        actorId: owner.id,
      })
      expect(result.paidSeats).toBe(5)
      const events = await seatEvents(ws.id, 'SEATS_PURCHASED')
      expect(events[0]?.seatsAfter).toBe(5)
    })

    it('is NOT idempotent at this layer: two applies = two ledger rows (the caller’s order-status guard is the boundary)', async () => {
      const { ws, owner } = await seed()
      const orderId = randomUUID()
      const input = {
        workspaceId: ws.id,
        seats: 1,
        orderId,
        amountKopecks: 9500,
        actorId: owner.id,
      }
      await domain.seats.applySeatPurchase(input)
      await domain.seats.applySeatPurchase(input)

      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.paidSeats).toBe(2)
      expect(await seatEvents(ws.id, 'SEATS_PURCHASED')).toHaveLength(2)
    })
  })

  // ── reduction (spec §3/§7.4/§7.5) ────────────────────────────────────────────

  describe('scheduleSeatReduction', () => {
    it('schedules the target, keeps paidSeats untouched, writes ledger + audit', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 3 } })
      const result = await domain.seats.scheduleSeatReduction({
        workspaceId: ws.id,
        actorId: owner.id,
        targetSeats: 1,
      })
      expect(result).toEqual({ paidSeats: 3, scheduledSeats: 1 })

      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.paidSeats).toBe(3)
      expect(addon?.scheduledSeats).toBe(1)

      const events = await seatEvents(ws.id, 'SEATS_REDUCTION_SCHEDULED')
      expect(events).toHaveLength(1)
      // seatsAfter means "paidSeats after the event" — a scheduled reduction
      // changes NOTHING yet, so it is null; the target lives in metadata.
      expect(events[0]).toMatchObject({ seatsDelta: -2, seatsAfter: null, actorId: owner.id })
      expect(events[0]?.metadata).toMatchObject({ targetSeats: 1 })

      expect(await auditRows(ws.id, BILLING_AUDIT_ACTIONS.seatsReductionScheduled)).toHaveLength(1)
    })

    it('rejects targets that are not strictly below paidSeats, or negative', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 2 } })
      for (const targetSeats of [2, 3, -1, 0.5]) {
        await expectDomainError(
          domain.seats.scheduleSeatReduction({
            workspaceId: ws.id,
            actorId: owner.id,
            targetSeats,
          }),
          'REDUCTION_INVALID_TARGET',
          400,
        )
      }
    })

    it('refuses to cut capacity below the current member count', async () => {
      const { ws, owner } = await seed({ maxMembers: 1, addon: { paidSeats: 3 } })
      await addMember(ws.id, 'm1', 'EDITOR')
      await addMember(ws.id, 'm2', 'VIEWER')
      // members = 3, included = 1: target 1 ⇒ capacity 2 < 3 — refused.
      await expectDomainError(
        domain.seats.scheduleSeatReduction({
          workspaceId: ws.id,
          actorId: owner.id,
          targetSeats: 1,
        }),
        'REDUCTION_BELOW_USAGE',
        409,
      )
      // target 2 ⇒ capacity 3 = members — allowed.
      const result = await domain.seats.scheduleSeatReduction({
        workspaceId: ws.id,
        actorId: owner.id,
        targetSeats: 2,
      })
      expect(result.scheduledSeats).toBe(2)
    })
  })

  describe('cancelScheduledReduction', () => {
    it('clears the scheduled value and is idempotent (no ledger rows)', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 3, scheduledSeats: 1 } })
      const first = await domain.seats.cancelScheduledReduction({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(first).toEqual({ paidSeats: 3, scheduledSeats: null })

      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.scheduledSeats).toBeNull()
      expect(addon?.paidSeats).toBe(3)

      // Second cancel: no-op, no throw.
      const second = await domain.seats.cancelScheduledReduction({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(second).toEqual({ paidSeats: 3, scheduledSeats: null })

      // No addon at all: still a calm no-op.
      const { ws: ws2, owner: owner2 } = await (async () => {
        const other = await makeUser('owner-b')
        const w = await prisma.workspace.create({ data: { name: 'B', createdById: other.id } })
        return { ws: w, owner: other }
      })()
      const third = await domain.seats.cancelScheduledReduction({
        workspaceId: ws2.id,
        actorId: owner2.id,
      })
      expect(third).toEqual({ paidSeats: 0, scheduledSeats: null })

      expect(await seatEvents(ws.id)).toHaveLength(0)
    })
  })

  // ── renewal hook (spec §3 — the CALLER writes SEATS_RENEWED) ─────────────────

  describe('applyScheduledSeats', () => {
    it('applies the scheduled value, clears it, returns the effective count, writes NO ledger', async () => {
      const { ws } = await seed({ addon: { paidSeats: 3, scheduledSeats: 1 } })
      const effective = await domain.seats.applyScheduledSeats(ws.id)
      expect(effective).toBe(1)

      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.paidSeats).toBe(1)
      expect(addon?.scheduledSeats).toBeNull()
      expect(await seatEvents(ws.id)).toHaveLength(0)
    })

    it('returns paidSeats unchanged when nothing is scheduled', async () => {
      const { ws } = await seed({ addon: { paidSeats: 4 } })
      expect(await domain.seats.applyScheduledSeats(ws.id)).toBe(4)
      const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws.id } })
      expect(addon?.paidSeats).toBe(4)
    })

    it('returns 0 when no addon row exists', async () => {
      const { ws } = await seed()
      expect(await domain.seats.applyScheduledSeats(ws.id)).toBe(0)
    })
  })

  // ── owner charge (spec §3 — read-only application of scheduled values) ───────

  describe('computeOwnerSeatCharge', () => {
    async function seedSecondWorkspace(
      ownerId: string,
      addon?: { paidSeats: number; scheduledSeats?: number | null },
    ) {
      const ws2 = await prisma.workspace.create({
        data: { name: 'SeatsWS2', createdById: ownerId },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws2.id, userId: ownerId, role: 'OWNER' },
      })
      if (addon) {
        await prisma.workspaceSeatAddon.create({
          data: {
            workspaceId: ws2.id,
            paidSeats: addon.paidSeats,
            scheduledSeats: addon.scheduledSeats ?? null,
          },
        })
      }
      return ws2
    }

    it('totals effective seats (scheduled ?? paid) across all owned workspaces without writing', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 2 } })
      await addMember(ws.id, 'editor', 'EDITOR')
      const ws2 = await seedSecondWorkspace(owner.id, { paidSeats: 5, scheduledSeats: 1 })

      const charge = await domain.seats.computeOwnerSeatCharge(owner.id, 'MONTHLY')
      expect(charge.totalSeatKopecks).toBe((2 + 1) * MONTHLY_SEAT_PRICE)
      expect(charge.perWorkspace).toHaveLength(2)

      const row1 = charge.perWorkspace.find((r) => r.workspaceId === ws.id)
      expect(row1).toEqual({
        workspaceId: ws.id,
        effectiveSeats: 2,
        seatKopecks: 2 * MONTHLY_SEAT_PRICE,
        memberCount: 2,
        includedSeats: PLAN_INCLUDED,
        paidSeats: 2,
        scheduledSeats: null,
      })
      const row2 = charge.perWorkspace.find((r) => r.workspaceId === ws2.id)
      expect(row2).toEqual({
        workspaceId: ws2.id,
        effectiveSeats: 1,
        seatKopecks: 1 * MONTHLY_SEAT_PRICE,
        memberCount: 1,
        includedSeats: PLAN_INCLUDED,
        paidSeats: 5,
        scheduledSeats: 1,
      })

      // READ-ONLY: the scheduled value is still pending.
      const addon2 = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: ws2.id } })
      expect(addon2?.paidSeats).toBe(5)
      expect(addon2?.scheduledSeats).toBe(1)
    })

    it('prices per the requested billing period', async () => {
      const { owner } = await seed({ billingPeriod: 'YEARLY', addon: { paidSeats: 2 } })
      const charge = await domain.seats.computeOwnerSeatCharge(owner.id, 'YEARLY')
      expect(charge.totalSeatKopecks).toBe(2 * YEARLY_SEAT_PRICE)
    })

    it('reports zero for addon-free workspaces (the flat-price regression shape)', async () => {
      const { ws, owner } = await seed()
      const charge = await domain.seats.computeOwnerSeatCharge(owner.id, 'MONTHLY')
      expect(charge.totalSeatKopecks).toBe(0)
      expect(charge.perWorkspace).toEqual([
        {
          workspaceId: ws.id,
          effectiveSeats: 0,
          seatKopecks: 0,
          memberCount: 1,
          includedSeats: PLAN_INCLUDED,
          paidSeats: 0,
          scheduledSeats: null,
        },
      ])
    })
  })

  // ── addon reset (spec §1 plan-change / §3) ────────────────────────────────────

  describe('resetAddonsForOwner', () => {
    it('clears every owned addon with state, one ADDONS_RESET ledger + audit per dirty workspace', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 2, scheduledSeats: 1 } })
      const ws2 = await prisma.workspace.create({
        data: { name: 'SeatsWS2', createdById: owner.id },
      })
      await prisma.workspaceSeatAddon.create({
        data: { workspaceId: ws2.id, paidSeats: 0, scheduledSeats: 3 },
      })
      const ws3 = await prisma.workspace.create({
        data: { name: 'SeatsWS3-clean', createdById: owner.id },
      })

      const result = await domain.seats.resetAddonsForOwner(owner.id, { reason: 'plan_change' })
      expect(result.resetWorkspaceIds.sort()).toEqual([ws.id, ws2.id].sort())

      for (const id of [ws.id, ws2.id]) {
        const addon = await prisma.workspaceSeatAddon.findUnique({ where: { workspaceId: id } })
        expect(addon?.paidSeats).toBe(0)
        expect(addon?.scheduledSeats).toBeNull()
      }

      const events1 = await seatEvents(ws.id, 'ADDONS_RESET')
      expect(events1).toHaveLength(1)
      expect(events1[0]).toMatchObject({ seatsDelta: -2, seatsAfter: 0, actorId: owner.id })
      expect(events1[0]?.metadata).toMatchObject({ reason: 'plan_change' })
      expect(await seatEvents(ws2.id, 'ADDONS_RESET')).toHaveLength(1)
      expect(await seatEvents(ws3.id)).toHaveLength(0)

      expect(await auditRows(ws.id, BILLING_AUDIT_ACTIONS.seatsAddonsReset)).toHaveLength(1)
      expect(await auditRows(ws2.id, BILLING_AUDIT_ACTIONS.seatsAddonsReset)).toHaveLength(1)
      expect(await auditRows(ws3.id, BILLING_AUDIT_ACTIONS.seatsAddonsReset)).toHaveLength(0)
    })

    it('is idempotent: a second reset writes nothing new', async () => {
      const { ws, owner } = await seed({ addon: { paidSeats: 2 } })
      await domain.seats.resetAddonsForOwner(owner.id, { reason: 'plan_change' })
      const second = await domain.seats.resetAddonsForOwner(owner.id, { reason: 'plan_change' })
      expect(second.resetWorkspaceIds).toEqual([])
      expect(await seatEvents(ws.id, 'ADDONS_RESET')).toHaveLength(1)
      expect(await auditRows(ws.id, BILLING_AUDIT_ACTIONS.seatsAddonsReset)).toHaveLength(1)
    })
  })

  // ── invoice requests (spec §3) ────────────────────────────────────────────────

  describe('createInvoiceRequest', () => {
    const validFields = {
      legalName: 'ООО «Ромашка»',
      inn: '7707083893',
      kpp: '770701001',
      legalAddress: 'г. Москва, ул. Тестовая, д. 1',
      contactEmail: 'buh@romashka.ru',
      periodMonths: 12,
      seats: 10,
      comment: 'Счёт на год',
    }

    it('persists the row, audits invoice.requested, returns the operator mail payload', async () => {
      const { ws, owner } = await seed()
      const result = await domain.seats.createInvoiceRequest({
        workspaceId: ws.id,
        actorId: owner.id,
        ...validFields,
      })
      expect(result.request).toMatchObject({
        workspaceId: ws.id,
        userId: owner.id,
        legalName: validFields.legalName,
        inn: validFields.inn,
        kpp: validFields.kpp,
        legalAddress: validFields.legalAddress,
        contactEmail: validFields.contactEmail,
        periodMonths: 12,
        seats: 10,
        comment: validFields.comment,
        status: 'NEW',
      })
      expect(result.mail).toEqual({
        legalName: validFields.legalName,
        inn: validFields.inn,
        workspaceName: 'SeatsWS',
        ownerEmail: email('owner'),
        seats: 10,
        periodMonths: 12,
        comment: validFields.comment,
      })

      const rows = await prisma.invoiceRequest.findMany({ where: { workspaceId: ws.id } })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('NEW')

      const audits = await auditRows(ws.id, BILLING_AUDIT_ACTIONS.invoiceRequested)
      expect(audits).toHaveLength(1)
      expect(audits[0]?.metadata).toMatchObject({ inn: validFields.inn, seats: 10 })
    })

    it('accepts a 12-digit INN and an absent KPP', async () => {
      const { ws, owner } = await seed()
      const result = await domain.seats.createInvoiceRequest({
        workspaceId: ws.id,
        actorId: owner.id,
        ...validFields,
        inn: '500100732259',
        kpp: undefined,
      })
      expect(result.request.inn).toBe('500100732259')
      expect(result.request.kpp).toBeNull()
    })

    it('rejects malformed INN/KPP/period and seats below usage', async () => {
      const { ws, owner } = await seed()
      await addMember(ws.id, 'm1', 'EDITOR')
      await addMember(ws.id, 'm2', 'VIEWER') // memberCount = 3
      const base = { workspaceId: ws.id, actorId: owner.id, ...validFields }

      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, inn: '123' }),
        'INVALID_INN',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, inn: '12345678901' }), // 11 digits
        'INVALID_INN',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, inn: '12345678ab' }),
        'INVALID_INN',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, kpp: '1234' }),
        'INVALID_KPP',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, periodMonths: 0 }),
        'INVALID_INVOICE_PERIOD',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, periodMonths: 13 }),
        'INVALID_INVOICE_PERIOD',
        400,
      )
      await expectDomainError(
        domain.seats.createInvoiceRequest({ ...base, seats: 2 }), // below memberCount 3
        'INVOICE_SEATS_BELOW_USAGE',
        400,
      )

      // Nothing leaked through the failed attempts.
      expect(await prisma.invoiceRequest.count({ where: { workspaceId: ws.id } })).toBe(0)
      expect(await auditRows(ws.id, BILLING_AUDIT_ACTIONS.invoiceRequested)).toHaveLength(0)
    })
  })

  describe('listInvoiceRequests', () => {
    it('returns the workspace requests, newest first', async () => {
      const { ws, owner } = await seed()
      const base = {
        workspaceId: ws.id,
        actorId: owner.id,
        legalName: 'ООО «Ромашка»',
        inn: '7707083893',
        legalAddress: 'адрес',
        contactEmail: 'a@b.ru',
        periodMonths: 6,
        seats: 5,
      }
      const first = await domain.seats.createInvoiceRequest({ ...base, comment: 'первый' })
      const second = await domain.seats.createInvoiceRequest({ ...base, comment: 'второй' })

      const list = await domain.seats.listInvoiceRequests(ws.id)
      expect(list.map((r) => r.id)).toEqual([second.request.id, first.request.id])
      expect(list[0]?.status).toBe('NEW')
    })
  })
})
