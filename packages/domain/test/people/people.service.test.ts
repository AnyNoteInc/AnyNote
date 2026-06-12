import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma, RoleType } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import { DomainError, isDomainError } from '../../src/shared/errors.ts'
import {
  PEOPLE_AUDIT_ACTIONS,
  PEOPLE_ERROR_CODES,
  generateInviteToken,
  hashInviteToken,
} from '../../src/people/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the people domain service. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+people-service-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
// Dedicated plan: flipping flags on the shared dev DB's `personal` plan would
// be a DB-wide change; the owner gets an ACTIVE subscription to this one.
const PRO_PLAN_SLUG = 'people-test-pro'

const domain = createDomain({ prisma, scheduler: makeScheduler() })

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.workspaceInvitation.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.subscription.deleteMany({ where: byUser })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
  await prisma.plan.deleteMany({ where: { slug: PRO_PLAN_SLUG } })
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

// getWorkspaceFeatures falls back to the `personal` plan when the owner has no
// ACTIVE subscription — make it self-contained for a fresh CI DB.
async function ensurePersonalPlan() {
  await prisma.plan.upsert({
    where: { slug: 'personal' },
    update: {},
    create: { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
  })
}

async function ensureProPlan() {
  return prisma.plan.upsert({
    where: { slug: PRO_PLAN_SLUG },
    update: {},
    create: {
      slug: PRO_PLAN_SLUG,
      name: 'People Test Pro',
      maxMembersPerWorkspace: 10,
      sortOrder: 99,
    },
  })
}

const PERIOD_END = new Date('2027-01-15T00:00:00.000Z')

async function seed() {
  await ensurePersonalPlan()
  const plan = await ensureProPlan()
  const owner = await makeUser('owner')
  const invitee = await makeUser('invitee')
  const outsider = await makeUser('outsider')
  await prisma.subscription.create({
    data: {
      userId: owner.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: PERIOD_END,
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'PeopleWS', createdById: owner.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 5, maxFileBytes: 0, syncedAt: new Date() },
  })
  return { owner, invitee, outsider, ws, plan }
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

function auditRows(workspaceId: string, action: string) {
  return prisma.workspaceAuditLog.findMany({
    where: { workspaceId, action },
    orderBy: { createdAt: 'asc' },
  })
}

/** Billable-seat ledger rows (8D): one MEMBER_JOINED per actual member creation. */
function memberEvents(workspaceId: string, type: 'MEMBER_JOINED' | 'MEMBER_REMOVED') {
  return prisma.seatBillingEvent.findMany({
    where: { workspaceId, type },
    orderBy: { createdAt: 'asc' },
  })
}

describe('people service', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  it('resolves from the domain container', () => {
    expect(domain.people).toBeDefined()
    expect(typeof domain.people.createInvitation).toBe('function')
    expect(typeof domain.people.acceptInvitation).toBe('function')
    expect(typeof domain.people.isWorkspaceBlocked).toBe('function')
  })

  // ── token helpers ──────────────────────────────────────────────────────────

  describe('invite tokens', () => {
    it('generateInviteToken returns 32 base62 chars, unique per call', () => {
      const a = generateInviteToken()
      const b = generateInviteToken()
      expect(a).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(b).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(a).not.toBe(b)
    })

    it('hashInviteToken is a deterministic sha256 hex digest', () => {
      const token = generateInviteToken()
      const hash = hashInviteToken(token)
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
      expect(hashInviteToken(token)).toBe(hash)
      expect(hash).not.toContain(token)
    })
  })

  // ── block helpers ──────────────────────────────────────────────────────────

  describe('isWorkspaceBlocked / assertNotBlocked', () => {
    it('is false / passes when no block row exists', async () => {
      const { ws, invitee } = await seed()
      await expect(domain.people.isWorkspaceBlocked(ws.id, invitee.id)).resolves.toBe(false)
      await expect(domain.people.assertNotBlocked(ws.id, invitee.id)).resolves.toBeUndefined()
    })

    it('is true / throws USER_BLOCKED 403 when a block row exists', async () => {
      const { ws, owner, invitee } = await seed()
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: invitee.id, blockedById: owner.id },
      })
      await expect(domain.people.isWorkspaceBlocked(ws.id, invitee.id)).resolves.toBe(true)
      await expectDomainError(
        domain.people.assertNotBlocked(ws.id, invitee.id),
        PEOPLE_ERROR_CODES.USER_BLOCKED,
        403,
      )
    })

    it('blocking is workspace-scoped: another workspace is unaffected', async () => {
      const { ws, owner, invitee } = await seed()
      const other = await prisma.workspace.create({
        data: { name: 'OtherWS', createdById: owner.id },
      })
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: invitee.id, blockedById: owner.id },
      })
      await expect(domain.people.isWorkspaceBlocked(other.id, invitee.id)).resolves.toBe(false)
    })
  })

  // ── createInvitation ───────────────────────────────────────────────────────

  describe('createInvitation', () => {
    it('creates a PENDING invitation, lowercases the email, stores only the hash, audits', async () => {
      const { ws, owner, invitee } = await seed()
      const mixedCase = email('Invitee').replace('invitee', 'Invitee').toUpperCase()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: mixedCase,
        role: RoleType.EDITOR,
      })
      void invitee

      expect(invitation.email).toBe(mixedCase.toLowerCase())
      expect(invitation.role).toBe(RoleType.EDITOR)
      expect(invitation.state).toBe('PENDING')
      expect(token).toMatch(/^[A-Za-z0-9]{32}$/)

      const row = await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.tokenHash).toBe(hashInviteToken(token))
      expect(JSON.stringify(row)).not.toContain(token)
      // ~7 days TTL
      const ttlMs = row.expiresAt.getTime() - Date.now()
      expect(ttlMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000)
      expect(ttlMs).toBeLessThan(7.1 * 24 * 3600 * 1000)

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.memberInvited)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
      expect(audits[0]!.targetEmail).toBe(mixedCase.toLowerCase())
    })

    it('rejects OWNER and GUEST roles with FORBIDDEN_ROLE', async () => {
      const { ws, owner } = await seed()
      for (const role of [RoleType.OWNER, RoleType.GUEST]) {
        await expectDomainError(
          domain.people.createInvitation({
            workspaceId: ws.id,
            actorId: owner.id,
            email: email('anyone'),
            role,
          }),
          PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
          403,
        )
      }
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.memberInvited)).toHaveLength(0)
    })

    it('rejects an email that already belongs to a member (case-insensitive) with ALREADY_MEMBER', async () => {
      const { ws, owner, invitee } = await seed()
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: invitee.id, role: 'VIEWER' },
      })
      await expectDomainError(
        domain.people.createInvitation({
          workspaceId: ws.id,
          actorId: owner.id,
          email: invitee.email.toUpperCase(),
          role: RoleType.EDITOR,
        }),
        PEOPLE_ERROR_CODES.ALREADY_MEMBER,
        409,
      )
    })

    it('re-inviting an active email refreshes the same row: new token, new role, no duplicate', async () => {
      const { ws, owner } = await seed()
      const target = email('refresh')
      const first = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: target,
        role: RoleType.VIEWER,
      })
      const second = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: target,
        role: RoleType.EDITOR,
      })

      expect(second.invitation.id).toBe(first.invitation.id)
      expect(second.invitation.role).toBe(RoleType.EDITOR)
      expect(second.token).not.toBe(first.token)
      const rows = await prisma.workspaceInvitation.findMany({
        where: { workspaceId: ws.id, email: target },
      })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.tokenHash).toBe(hashInviteToken(second.token))

      // the displaced token is dead
      const user = await makeUser('refresh-user')
      await expectDomainError(
        domain.people.acceptInvitation({
          token: first.token,
          userId: user.id,
          userEmail: target,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      // both invites audited
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.memberInvited)).toHaveLength(2)
    })

    it('pre-checks the seat limit: full workspace ⇒ SEAT_LIMIT_REACHED', async () => {
      const { ws, owner } = await seed()
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // owner already holds the only seat
      })
      await expectDomainError(
        domain.people.createInvitation({
          workspaceId: ws.id,
          actorId: owner.id,
          email: email('overflow'),
          role: RoleType.EDITOR,
        }),
        PEOPLE_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
    })

    it('purchased seats grow the capacity: the pre-check passes with an addon (8D)', async () => {
      const { ws, owner } = await seed()
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // owner already holds the only INCLUDED seat
      })
      await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 1 } })
      const { invitation } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: email('paid-seat'),
        role: RoleType.EDITOR,
      })
      expect(invitation.state).toBe('PENDING')
    })
  })

  // ── listInvitations ────────────────────────────────────────────────────────

  describe('listInvitations', () => {
    it('returns open invitations with computed state, PENDING first; hides revoked and accepted', async () => {
      const { ws, owner, invitee } = await seed()
      const expired = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: email('expired'),
        role: RoleType.VIEWER,
      })
      await prisma.workspaceInvitation.update({
        where: { id: expired.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const pending = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: email('pending'),
        role: RoleType.EDITOR,
      })
      const revoked = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: email('revoked'),
        role: RoleType.EDITOR,
      })
      await domain.people.revokeInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        invitationId: revoked.invitation.id,
      })
      const accepted = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await domain.people.acceptInvitation({
        token: accepted.token,
        userId: invitee.id,
        userEmail: invitee.email,
      })

      const list = await domain.people.listInvitations(ws.id)
      expect(list.map((i) => i.id)).toEqual([pending.invitation.id, expired.invitation.id])
      expect(list[0]!.state).toBe('PENDING')
      expect(list[1]!.state).toBe('EXPIRED')
    })
  })

  // ── revokeInvitation ───────────────────────────────────────────────────────

  describe('revokeInvitation', () => {
    it('marks the invitation revoked, audits, and the token stops accepting', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await domain.people.revokeInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        invitationId: invitation.id,
      })

      const row = await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.revokedAt).not.toBeNull()
      expect(row.revokedById).toBe(owner.id)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteRevoked)).toHaveLength(1)

      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_REVOKED,
        412,
      )
    })

    it('throws INVITE_NOT_FOUND for an unknown id and for a foreign workspace', async () => {
      const { ws, owner, invitee } = await seed()
      await expectDomainError(
        domain.people.revokeInvitation({
          workspaceId: ws.id,
          actorId: owner.id,
          invitationId: randomUUID(),
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      // an invitation of another workspace is invisible here
      const other = await prisma.workspace.create({
        data: { name: 'OtherWS', createdById: owner.id },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: other.id, userId: owner.id, role: 'OWNER' },
      })
      const foreign = await domain.people.createInvitation({
        workspaceId: other.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await expectDomainError(
        domain.people.revokeInvitation({
          workspaceId: ws.id,
          actorId: owner.id,
          invitationId: foreign.invitation.id,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('is idempotent: a second revoke succeeds without a second audit row', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      const input = { workspaceId: ws.id, actorId: owner.id, invitationId: invitation.id }
      await domain.people.revokeInvitation(input)
      await expect(domain.people.revokeInvitation(input)).resolves.toEqual({ id: invitation.id })
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteRevoked)).toHaveLength(1)
    })
  })

  // ── acceptInvitation ───────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('creates the member with the invited role, ensures the personal collection, marks accepted, audits', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.COMMENTER,
      })

      const result = await domain.people.acceptInvitation({
        token,
        userId: invitee.id,
        userEmail: invitee.email,
      })
      expect(result).toEqual({
        workspaceId: ws.id,
        role: RoleType.COMMENTER,
        alreadyMember: false,
      })

      const member = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
      })
      expect(member.role).toBe(RoleType.COMMENTER)

      const personal = await prisma.collection.findFirst({
        where: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: invitee.id },
      })
      expect(personal).not.toBeNull()

      const row = await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.acceptedAt).not.toBeNull()
      expect(row.acceptedById).toBe(invitee.id)

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteAccepted)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(invitee.id)

      // the billable-seat ledger records the join in the same tx (8D)
      const joined = await memberEvents(ws.id, 'MEMBER_JOINED')
      expect(joined).toHaveLength(1)
      expect(joined[0]).toMatchObject({ targetUserId: invitee.id, actorId: invitee.id })
    })

    it('throws INVITE_NOT_FOUND for an unknown token', async () => {
      const { invitee } = await seed()
      await expectDomainError(
        domain.people.acceptInvitation({
          token: generateInviteToken(),
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('throws INVITE_EXPIRED for an expired token and does not create a member', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_EXPIRED,
        412,
      )
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
      })
      expect(member).toBeNull()
    })

    it('matches the session email case-insensitively and rejects a different email', async () => {
      const { ws, owner, invitee, outsider } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      // wrong email ⇒ mismatch
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: outsider.id,
          userEmail: outsider.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_EMAIL_MISMATCH,
        403,
      )
      // same email, different case ⇒ accepted
      const result = await domain.people.acceptInvitation({
        token,
        userId: invitee.id,
        userEmail: invitee.email.toUpperCase(),
      })
      expect(result.alreadyMember).toBe(false)
    })

    it('refuses a blocked user with USER_BLOCKED and creates nothing', async () => {
      const { ws, owner, invitee } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: invitee.id, blockedById: owner.id },
      })
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.USER_BLOCKED,
        403,
      )
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
      })
      expect(member).toBeNull()
    })

    it('re-checks the seat limit at acceptance ⇒ SEAT_LIMIT_REACHED', async () => {
      const { ws, owner, invitee, outsider } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      // the last free seat is taken between create and accept
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: outsider.id, role: 'EDITOR' },
      })
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 2 },
      })
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
      const member = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
      })
      expect(member).toBeNull()
    })

    it('the in-tx seat re-check fires atomically: SEAT_LIMIT_REACHED and nothing is written', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      // the workspace fills to the limit between invite-time and acceptance
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // owner already holds the only seat
      })
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: invitee.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
      // the rolled-back transaction left no trace: no member, open invite, no audit
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
        }),
      ).toBeNull()
      const row = await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.acceptedAt).toBeNull()
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteAccepted)).toHaveLength(0)
      // the seat ledger rolled back with the member row (8D)
      expect(await memberEvents(ws.id, 'MEMBER_JOINED')).toHaveLength(0)
    })

    it('purchased seats grow the acceptance capacity: included + paidSeats (8D)', async () => {
      const { ws, owner, invitee } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      // the included limit fills up, but a purchased seat keeps the door open
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // owner already holds the only INCLUDED seat
      })
      await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 1 } })
      const result = await domain.people.acceptInvitation({
        token,
        userId: invitee.id,
        userEmail: invitee.email,
      })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.EDITOR, alreadyMember: false })
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: invitee.id } },
        }),
      ).not.toBeNull()
    })

    it('two concurrent accepts converge: one member row, one normal + one alreadyMember result', async () => {
      const { ws, owner } = await seed()
      // A few rounds to shake out interleaving luck (the 7B atomic-claim pattern):
      // the loser of the workspace_members unique race must converge on the
      // alreadyMember path instead of surfacing P2002.
      for (let i = 0; i < 3; i++) {
        const user = await makeUser(`race${i}`)
        const { invitation, token } = await domain.people.createInvitation({
          workspaceId: ws.id,
          actorId: owner.id,
          email: user.email,
          role: RoleType.EDITOR,
        })
        const input = { token, userId: user.id, userEmail: user.email }
        // Promise.all rejects on any rejection — resolution itself asserts no 500
        const results = await Promise.all([
          domain.people.acceptInvitation(input),
          domain.people.acceptInvitation(input),
        ])

        expect(results.filter((r) => !r.alreadyMember)).toHaveLength(1)
        expect(results.filter((r) => r.alreadyMember)).toHaveLength(1)
        for (const r of results) {
          expect(r.workspaceId).toBe(ws.id)
          expect(r.role).toBe(RoleType.EDITOR)
        }

        const members = await prisma.workspaceMember.findMany({
          where: { workspaceId: ws.id, userId: user.id },
        })
        expect(members).toHaveLength(1)
        expect(members[0]!.role).toBe(RoleType.EDITOR)
        const row = await prisma.workspaceInvitation.findUniqueOrThrow({
          where: { id: invitation.id },
        })
        expect(row.acceptedAt).not.toBeNull()
        expect(row.acceptedById).toBe(user.id)
        // exactly ONE ledger row per actual member creation — the converged
        // alreadyMember loser writes none (8D)
        const joined = (await memberEvents(ws.id, 'MEMBER_JOINED')).filter(
          (e) => e.targetUserId === user.id,
        )
        expect(joined).toHaveLength(1)
      }
    })

    it('double-accept by the same user returns alreadyMember without duplicates', async () => {
      const { ws, owner, invitee } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      const input = { token, userId: invitee.id, userEmail: invitee.email }
      const first = await domain.people.acceptInvitation(input)
      expect(first.alreadyMember).toBe(false)
      const second = await domain.people.acceptInvitation(input)
      expect(second).toEqual({ workspaceId: ws.id, role: RoleType.EDITOR, alreadyMember: true })

      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: ws.id, userId: invitee.id },
      })
      expect(members).toHaveLength(1)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteAccepted)).toHaveLength(1)
      // the idempotent re-accept writes no second ledger row (8D)
      expect(await memberEvents(ws.id, 'MEMBER_JOINED')).toHaveLength(1)
    })

    it('a used token is dead for any other user ⇒ INVITE_NOT_FOUND', async () => {
      const { ws, owner, invitee, outsider } = await seed()
      const { token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await domain.people.acceptInvitation({
        token,
        userId: invitee.id,
        userEmail: invitee.email,
      })
      await expectDomainError(
        domain.people.acceptInvitation({
          token,
          userId: outsider.id,
          userEmail: invitee.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('a user who became a member through another path gets alreadyMember and the invite closes', async () => {
      const { ws, owner, invitee } = await seed()
      const { invitation, token } = await domain.people.createInvitation({
        workspaceId: ws.id,
        actorId: owner.id,
        email: invitee.email,
        role: RoleType.EDITOR,
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: invitee.id, role: 'VIEWER' },
      })
      const result = await domain.people.acceptInvitation({
        token,
        userId: invitee.id,
        userEmail: invitee.email,
      })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.VIEWER, alreadyMember: true })
      const row = await prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id },
      })
      expect(row.acceptedAt).not.toBeNull()
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteAccepted)).toHaveLength(1)
    })
  })

  // ── getInvitePreview ───────────────────────────────────────────────────────

  describe('getInvitePreview', () => {
    it('returns seats, plan and period end through the billing chain', async () => {
      const { ws } = await seed()
      const preview = await domain.people.getInvitePreview(ws.id)
      expect(preview).toEqual({
        currentMembers: 1,
        maxMembers: 5,
        planSlug: PRO_PLAN_SLUG,
        isPaid: true,
        periodEnd: PERIOD_END,
      })
    })

    it('maxMembers reports the full capacity: included limit + purchased seats (8D)', async () => {
      const { ws } = await seed()
      await prisma.workspaceSeatAddon.create({ data: { workspaceId: ws.id, paidSeats: 2 } })
      const preview = await domain.people.getInvitePreview(ws.id)
      expect(preview.currentMembers).toBe(1)
      expect(preview.maxMembers).toBe(7) // 5 included + 2 paid
    })

    it('falls back to the plan member limit and the personal plan without limit row / subscription', async () => {
      const { invitee } = await seed()
      // a workspace owned by a user without any subscription, no WorkspaceLimit row
      const ws = await prisma.workspace.create({
        data: { name: 'FreeWS', createdById: invitee.id },
      })
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.id, userId: invitee.id, role: 'OWNER' },
      })
      const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
      const preview = await domain.people.getInvitePreview(ws.id)
      expect(preview).toEqual({
        currentMembers: 1,
        maxMembers: personal.maxMembersPerWorkspace,
        planSlug: 'personal',
        isPaid: false,
        periodEnd: null,
      })
    })
  })

  // ── writeAudit ─────────────────────────────────────────────────────────────

  describe('writeAudit', () => {
    it('writes a row with actor, target and metadata', async () => {
      const { ws, owner, invitee } = await seed()
      await domain.people.writeAudit({
        workspaceId: ws.id,
        actorId: owner.id,
        action: PEOPLE_AUDIT_ACTIONS.userBlocked,
        targetUserId: invitee.id,
        targetEmail: invitee.email,
        metadata: { reason: 'spam' },
      })
      const rows = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userBlocked)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.actorId).toBe(owner.id)
      expect(rows[0]!.targetUserId).toBe(invitee.id)
      expect(rows[0]!.metadata).toEqual({ reason: 'spam' })
    })
  })
})
