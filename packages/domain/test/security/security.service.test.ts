import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import { DomainError, isDomainError } from '../../src/shared/errors.ts'
import { PEOPLE_AUDIT_ACTIONS } from '../../src/people/index.ts'
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_ERROR_CODES,
  securityError,
  type SecurityGuestInviteCreator,
  type SecurityPolicyPatch,
} from '../../src/security/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the security domain service: policy CRUD with
// diff audits, the four enforcement assert helpers, guest-invite requests
// (gate combos, refresh, approve/reject, races), and the people-side
// createGuestInvite policy gate + bypass. Email-suffix fixture namespace,
// self-cleaning. Requires `docker compose up -d` (postgres).
// All asserts are FIXTURE-SCOPED (per-workspace / per-user) — never global.

const EMAIL_SUFFIX = '+security-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)

const domain = createDomain({ prisma, scheduler: makeScheduler() })

async function cleanFixtures() {
  const createdByContains = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const byCreatorWs = { workspace: createdByContains }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInviteRequest.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInvite.deleteMany({ where: byCreatorWs })
  await prisma.pageShareUser.deleteMany({
    where: { OR: [byUser, { pageShare: { page: byCreatorWs } }] },
  })
  await prisma.pageShare.deleteMany({ where: { page: byCreatorWs } })
  await prisma.page.deleteMany({ where: byCreatorWs })
  await prisma.workspaceSecurityPolicy.deleteMany({ where: byCreatorWs })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({ where: createdByContains })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
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

async function seed() {
  const owner = await makeUser('owner')
  const owner2 = await makeUser('owner2')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'SecurityWS', createdById: owner.id },
  })
  for (const [userId, role] of [
    [owner.id, 'OWNER'],
    [owner2.id, 'OWNER'],
    [member.id, 'EDITOR'],
  ] as const) {
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId, role } })
  }
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, title: 'Secured page', createdById: owner.id },
  })
  return { owner, owner2, member, ws, page }
}

/** Direct policy-row fixture (the state updatePolicy produces). */
async function setPolicy(workspaceId: string, configuredById: string, flags: SecurityPolicyPatch) {
  return prisma.workspaceSecurityPolicy.create({
    data: { workspaceId, configuredById, ...flags },
  })
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

describe('security service', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  it('resolves from the domain container; PeopleService satisfies the guest-invite port', () => {
    expect(domain.security).toBeDefined()
    expect(typeof domain.security.getPolicy).toBe('function')
    expect(typeof domain.security.updatePolicy).toBe('function')
    expect(typeof domain.security.createGuestInviteRequest).toBe('function')
    expect(typeof domain.security.approveGuestInviteRequest).toBe('function')
    // Compile-time pin: the people service is structurally assignable to the
    // port the security module binds it to (no cast can hide a drift here).
    const port: SecurityGuestInviteCreator = domain.people
    expect(typeof port.createGuestInvite).toBe('function')
  })

  it('audit catalog covers spec §2 (page_inspected deliberately skipped)', () => {
    // 'content_search.override' is declared for the admin-search override
    // actions (Task 5/6 wiring) — not yet emitted.
    expect(Object.values(SECURITY_AUDIT_ACTIONS).sort()).toEqual(
      [
        'security.policy_changed',
        'security.search_acknowledged',
        'content_search.performed',
        'content_search.override',
        'guest_request.created',
        'guest_request.approved',
        'guest_request.rejected',
      ].sort(),
    )
  })

  // ── policy CRUD ──────────────────────────────────────────────────────────────

  describe('getPolicy', () => {
    it('returns the zero-value default when no row exists, without creating one', async () => {
      const { ws } = await seed()
      const policy = await domain.security.getPolicy(ws.id)
      expect(policy).toEqual({
        workspaceId: ws.id,
        disableGuestInvites: false,
        allowGuestInviteRequests: true,
        disablePublicLinksSitesForms: false,
        disableExport: false,
        disableMoveDuplicateOutsideWorkspace: false,
        adminContentSearchAcknowledgedAt: null,
        adminContentSearchAcknowledgedById: null,
      })
      expect(
        await prisma.workspaceSecurityPolicy.findUnique({ where: { workspaceId: ws.id } }),
      ).toBeNull()
    })

    it('returns the stored row when present (ack fields included)', async () => {
      const { ws, owner } = await seed()
      const ackAt = new Date('2026-06-01T00:00:00.000Z')
      await prisma.workspaceSecurityPolicy.create({
        data: {
          workspaceId: ws.id,
          configuredById: owner.id,
          disableExport: true,
          adminContentSearchAcknowledgedAt: ackAt,
          adminContentSearchAcknowledgedById: owner.id,
        },
      })
      const policy = await domain.security.getPolicy(ws.id)
      expect(policy.disableExport).toBe(true)
      expect(policy.allowGuestInviteRequests).toBe(true)
      expect(policy.adminContentSearchAcknowledgedAt).toEqual(ackAt)
      expect(policy.adminContentSearchAcknowledgedById).toBe(owner.id)
    })
  })

  describe('updatePolicy', () => {
    it('lazy-creates the row on first change and audits the exact changed-flags diff', async () => {
      const { ws, owner } = await seed()
      const updated = await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner.id,
        patch: { disableExport: true },
      })
      expect(updated.disableExport).toBe(true)
      expect(updated.disableGuestInvites).toBe(false)

      const row = await prisma.workspaceSecurityPolicy.findUniqueOrThrow({
        where: { workspaceId: ws.id },
      })
      expect(row.disableExport).toBe(true)
      expect(row.configuredById).toBe(owner.id)

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.policyChanged)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
      expect(audits[0]!.metadata).toEqual({ changed: { disableExport: [false, true] } })
    })

    it('applies a partial patch without touching the other flags; diff covers only real changes', async () => {
      const { ws, owner, owner2 } = await seed()
      await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner.id,
        patch: { disableGuestInvites: true, allowGuestInviteRequests: true },
      })
      // allowGuestInviteRequests was already true (default) — only the real flip audits.
      const first = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.policyChanged)
      expect(first[0]!.metadata).toEqual({ changed: { disableGuestInvites: [false, true] } })

      const updated = await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner2.id,
        patch: { allowGuestInviteRequests: false, disablePublicLinksSitesForms: true },
      })
      expect(updated.disableGuestInvites).toBe(true) // untouched by the second patch
      expect(updated.allowGuestInviteRequests).toBe(false)
      expect(updated.disablePublicLinksSitesForms).toBe(true)

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.policyChanged)
      expect(audits).toHaveLength(2)
      expect(audits[1]!.actorId).toBe(owner2.id)
      expect(audits[1]!.metadata).toEqual({
        changed: {
          allowGuestInviteRequests: [true, false],
          disablePublicLinksSitesForms: [false, true],
        },
      })
      const row = await prisma.workspaceSecurityPolicy.findUniqueOrThrow({
        where: { workspaceId: ws.id },
      })
      expect(row.configuredById).toBe(owner2.id)
    })

    it('no-op patch with no row: creates nothing and writes no audit', async () => {
      const { ws, owner } = await seed()
      const policy = await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner.id,
        patch: { disableExport: false, allowGuestInviteRequests: true },
      })
      expect(policy.disableExport).toBe(false)
      expect(
        await prisma.workspaceSecurityPolicy.findUnique({ where: { workspaceId: ws.id } }),
      ).toBeNull()
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.policyChanged)).toHaveLength(0)
    })

    it('no-op patch against an existing row: no second audit', async () => {
      const { ws, owner } = await seed()
      await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner.id,
        patch: { disableExport: true },
      })
      await domain.security.updatePolicy({
        workspaceId: ws.id,
        actorId: owner.id,
        patch: { disableExport: true },
      })
      await domain.security.updatePolicy({ workspaceId: ws.id, actorId: owner.id, patch: {} })
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.policyChanged)).toHaveLength(1)
    })
  })

  // ── enforcement assert helpers ───────────────────────────────────────────────

  describe('assert helpers', () => {
    const cases = [
      {
        helper: 'assertGuestInvitesAllowed',
        flag: 'disableGuestInvites',
        code: SECURITY_ERROR_CODES.POLICY_GUEST_INVITES_DISABLED,
      },
      {
        helper: 'assertPublicSharingAllowed',
        flag: 'disablePublicLinksSitesForms',
        code: SECURITY_ERROR_CODES.POLICY_PUBLIC_SHARING_DISABLED,
      },
      {
        helper: 'assertExportAllowed',
        flag: 'disableExport',
        code: SECURITY_ERROR_CODES.POLICY_EXPORT_DISABLED,
      },
      {
        helper: 'assertCrossWorkspaceCopyAllowed',
        flag: 'disableMoveDuplicateOutsideWorkspace',
        code: SECURITY_ERROR_CODES.POLICY_CROSS_WORKSPACE_DISABLED,
      },
    ] as const

    for (const { helper, flag, code } of cases) {
      it(`${helper}: passes with no row and with ${flag}=false, throws ${code} when set`, async () => {
        const { ws, owner } = await seed()
        await expect(domain.security[helper](ws.id)).resolves.toBeUndefined()

        await setPolicy(ws.id, owner.id, { [flag]: false })
        await expect(domain.security[helper](ws.id)).resolves.toBeUndefined()

        await prisma.workspaceSecurityPolicy.update({
          where: { workspaceId: ws.id },
          data: { [flag]: true },
        })
        const err = await expectDomainError(domain.security[helper](ws.id), code, 403)
        expect(err.message).toBe(securityError(code).message)
      })
    }
  })

  // ── guest invite requests: create ────────────────────────────────────────────

  describe('createGuestInviteRequest', () => {
    it('denies when invites are ENABLED (requests are pointless) — POLICY_REQUESTS_DISABLED naming the direct path', async () => {
      const { member, page, ws } = await seed()
      // No policy row at all — the zero-value default allows invites directly.
      const err = await expectDomainError(
        domain.security.createGuestInviteRequest({
          pageId: page.id,
          requesterId: member.id,
          email: email('invitee'),
          role: 'READER',
        }),
        SECURITY_ERROR_CODES.POLICY_REQUESTS_DISABLED,
        403,
      )
      expect(err.message).toContain('доступны напрямую')
      expect(await prisma.pageGuestInviteRequest.findMany({ where: { pageId: page.id } })).toEqual(
        [],
      )
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestCreated)).toHaveLength(0)
    })

    it('denies when invites are disabled AND requests are disallowed', async () => {
      const { owner, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, {
        disableGuestInvites: true,
        allowGuestInviteRequests: false,
      })
      const err = await expectDomainError(
        domain.security.createGuestInviteRequest({
          pageId: page.id,
          requesterId: member.id,
          email: email('invitee'),
          role: 'READER',
        }),
        SECURITY_ERROR_CODES.POLICY_REQUESTS_DISABLED,
        403,
      )
      expect(err.message).toBe(securityError(SECURITY_ERROR_CODES.POLICY_REQUESTS_DISABLED).message)
      expect(await prisma.pageGuestInviteRequest.findMany({ where: { pageId: page.id } })).toEqual(
        [],
      )
    })

    it('creates a PENDING request when invites are disabled and requests allowed: normalizes email, audits, returns ownerIds', async () => {
      const { owner, owner2, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })

      const { request, ownerIds } = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: `  ${email('Invitee').toUpperCase()} `,
        role: 'COMMENTER',
      })
      expect(request.pageId).toBe(page.id)
      expect(request.workspaceId).toBe(ws.id)
      expect(request.email).toBe(email('invitee').toLowerCase())
      expect(request.role).toBe('COMMENTER')
      expect(request.requesterId).toBe(member.id)
      expect(request.status).toBe('PENDING')
      expect(request.decidedById).toBeNull()
      expect(ownerIds.sort()).toEqual([owner.id, owner2.id].sort())

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestCreated)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(member.id)
      expect(audits[0]!.targetEmail).toBe(request.email)
      expect(audits[0]!.metadata).toMatchObject({
        requestId: request.id,
        pageId: page.id,
        role: 'COMMENTER',
        refreshed: false,
      })
    })

    it('refresh-PENDING: a repeat request refreshes role + updatedAt and KEEPS the first requester', async () => {
      const { owner, owner2, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const target = email('invitee')

      const first = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: target,
        role: 'READER',
      })
      const second = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: owner2.id,
        email: target.toUpperCase(),
        role: 'EDITOR',
      })
      expect(second.request.id).toBe(first.request.id)
      expect(second.request.role).toBe('EDITOR')
      // Pinned: the FIRST requester stays on the row — the queue shows who
      // originally asked; later requesters only refresh role/updatedAt.
      expect(second.request.requesterId).toBe(member.id)
      expect(second.request.updatedAt.getTime()).toBeGreaterThanOrEqual(
        first.request.updatedAt.getTime(),
      )
      expect(
        await prisma.pageGuestInviteRequest.findMany({ where: { pageId: page.id } }),
      ).toHaveLength(1)

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestCreated)
      expect(audits).toHaveLength(2)
      expect(audits[1]!.metadata).toMatchObject({ refreshed: true })
    })

    it('a decided request does not block a new PENDING request for the same page+email', async () => {
      const { owner, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const target = email('invitee')
      const { request } = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: target,
        role: 'READER',
      })
      await domain.security.rejectGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      const again = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: target,
        role: 'READER',
      })
      expect(again.request.id).not.toBe(request.id)
      expect(again.request.status).toBe('PENDING')
      expect(
        await prisma.pageGuestInviteRequest.findMany({ where: { pageId: page.id } }),
      ).toHaveLength(2)
    })

    it('unknown or deleted page ⇒ NOT_FOUND', async () => {
      const { owner, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      await expectDomainError(
        domain.security.createGuestInviteRequest({
          pageId: randomUUID(),
          requesterId: member.id,
          email: email('invitee'),
          role: 'READER',
        }),
        'NOT_FOUND',
        404,
      )
      await prisma.page.update({ where: { id: page.id }, data: { deletedAt: new Date() } })
      await expectDomainError(
        domain.security.createGuestInviteRequest({
          pageId: page.id,
          requesterId: member.id,
          email: email('invitee'),
          role: 'READER',
        }),
        'NOT_FOUND',
        404,
      )
    })

    it('the partial unique index forbids a second PENDING row per (page, email) at the DB level', async () => {
      const { owner, member, page, ws } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const target = email('invitee')
      await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: target,
        role: 'READER',
      })
      await expect(
        prisma.pageGuestInviteRequest.create({
          data: {
            pageId: page.id,
            workspaceId: ws.id,
            email: target,
            role: 'READER',
            requesterId: member.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' })
    })
  })

  // ── guest invite requests: approve / reject ──────────────────────────────────

  describe('approveGuestInviteRequest', () => {
    async function seedPendingRequest(label = 'invitee') {
      const fixture = await seed()
      await setPolicy(fixture.ws.id, fixture.owner.id, { disableGuestInvites: true })
      const { request } = await domain.security.createGuestInviteRequest({
        pageId: fixture.page.id,
        requesterId: fixture.member.id,
        email: email(label),
        role: 'COMMENTER',
      })
      return { ...fixture, request }
    }

    it('marks APPROVED, creates the real guest invite under the policy bypass, audits both sides, returns the token', async () => {
      const { ws, page, owner, member, request } = await seedPendingRequest()

      const result = await domain.security.approveGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      expect(result.request.status).toBe('APPROVED')
      expect(result.request.decidedById).toBe(owner.id)
      expect(result.request.decidedAt).not.toBeNull()
      expect(result.token).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(result.invite.email).toBe(request.email)
      expect(result.invite.role).toBe('COMMENTER')
      expect(result.invite.pageId).toBe(page.id)

      // The invite row exists and is active — created while disableGuestInvites
      // was ON: the approval path is the only sanctioned bypass.
      const invites = await prisma.pageGuestInvite.findMany({
        where: { pageId: page.id, email: request.email, acceptedAt: null, revokedAt: null },
      })
      expect(invites).toHaveLength(1)
      expect(invites[0]!.inviterId).toBe(owner.id) // actor = the approving OWNER

      const approvedAudits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestApproved)
      expect(approvedAudits).toHaveLength(1)
      expect(approvedAudits[0]!.actorId).toBe(owner.id)
      expect(approvedAudits[0]!.targetEmail).toBe(request.email)
      expect(approvedAudits[0]!.metadata).toMatchObject({
        requestId: request.id,
        pageId: page.id,
        requesterId: member.id,
      })
      // people.createGuestInvite fired its own audit inside the same flow.
      const invitedAudits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInvited)
      expect(invitedAudits).toHaveLength(1)
      expect(invitedAudits[0]!.actorId).toBe(owner.id)
    })

    it('unknown id or a foreign-workspace id ⇒ REQUEST_NOT_FOUND', async () => {
      const { ws, owner, request } = await seedPendingRequest()
      await expectDomainError(
        domain.security.approveGuestInviteRequest({
          workspaceId: ws.id,
          id: randomUUID(),
          actorId: owner.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_NOT_FOUND,
        404,
      )
      // Same request id, wrong workspace scope.
      const otherWs = await prisma.workspace.create({
        data: { name: 'SecurityWS-2', createdById: owner.id },
      })
      await expectDomainError(
        domain.security.approveGuestInviteRequest({
          workspaceId: otherWs.id,
          id: request.id,
          actorId: owner.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_NOT_FOUND,
        404,
      )
    })

    it('an already-decided request ⇒ REQUEST_ALREADY_DECIDED (409), no second invite', async () => {
      const { ws, page, owner, owner2, request } = await seedPendingRequest()
      await domain.security.approveGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      await expectDomainError(
        domain.security.approveGuestInviteRequest({
          workspaceId: ws.id,
          id: request.id,
          actorId: owner2.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_ALREADY_DECIDED,
        409,
      )
      expect(
        await prisma.pageGuestInvite.findMany({ where: { pageId: page.id, email: request.email } }),
      ).toHaveLength(1)
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestApproved)).toHaveLength(1)
    })

    it('a rejected request cannot be approved afterwards', async () => {
      const { ws, owner, request } = await seedPendingRequest()
      await domain.security.rejectGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      await expectDomainError(
        domain.security.approveGuestInviteRequest({
          workspaceId: ws.id,
          id: request.id,
          actorId: owner.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_ALREADY_DECIDED,
        409,
      )
    })

    it('a deleted page aborts the approval atomically — the request stays PENDING', async () => {
      const { ws, page, owner, request } = await seedPendingRequest()
      await prisma.page.update({ where: { id: page.id }, data: { deletedAt: new Date() } })
      await expectDomainError(
        domain.security.approveGuestInviteRequest({
          workspaceId: ws.id,
          id: request.id,
          actorId: owner.id,
        }),
        'NOT_FOUND',
        404,
      )
      const row = await prisma.pageGuestInviteRequest.findUniqueOrThrow({
        where: { id: request.id },
      })
      expect(row.status).toBe('PENDING') // the APPROVED mark rolled back with the tx
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestApproved)).toHaveLength(0)
    })

    it('concurrent double-approve converges: one winner per round, the loser conflicts, exactly one invite (3 rounds)', async () => {
      const { ws, page, owner, owner2, member } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })

      for (let round = 0; round < 3; round += 1) {
        const target = email(`race-${round}`)
        const { request } = await domain.security.createGuestInviteRequest({
          pageId: page.id,
          requesterId: member.id,
          email: target,
          role: 'READER',
        })
        const results = await Promise.allSettled([
          domain.security.approveGuestInviteRequest({
            workspaceId: ws.id,
            id: request.id,
            actorId: owner.id,
          }),
          domain.security.approveGuestInviteRequest({
            workspaceId: ws.id,
            id: request.id,
            actorId: owner2.id,
          }),
        ])
        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        const rejected = results.filter((r) => r.status === 'rejected')
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        const loser = (rejected[0] as PromiseRejectedResult).reason as unknown
        expect(isDomainError(loser)).toBe(true)
        expect((loser as DomainError).code).toBe(SECURITY_ERROR_CODES.REQUEST_ALREADY_DECIDED)

        const invites = await prisma.pageGuestInvite.findMany({
          where: { pageId: page.id, email: target },
        })
        expect(invites).toHaveLength(1)
        const approvedAudits = await prisma.workspaceAuditLog.findMany({
          where: {
            workspaceId: ws.id,
            action: SECURITY_AUDIT_ACTIONS.guestRequestApproved,
            targetEmail: target,
          },
        })
        expect(approvedAudits).toHaveLength(1)
      }
    })
  })

  describe('rejectGuestInviteRequest', () => {
    it('marks REJECTED + audits; no invite row is created', async () => {
      const { ws, page, owner, member } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const { request } = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('invitee'),
        role: 'READER',
      })
      const rejected = await domain.security.rejectGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      expect(rejected.status).toBe('REJECTED')
      expect(rejected.decidedById).toBe(owner.id)
      expect(rejected.decidedAt).not.toBeNull()

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestRejected)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
      expect(audits[0]!.metadata).toMatchObject({ requestId: request.id, pageId: page.id })
      expect(
        await prisma.pageGuestInvite.findMany({ where: { pageId: page.id, email: request.email } }),
      ).toEqual([])
    })

    it('an already-decided request ⇒ REQUEST_ALREADY_DECIDED; unknown ⇒ REQUEST_NOT_FOUND', async () => {
      const { ws, page, owner, member } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const { request } = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('invitee'),
        role: 'READER',
      })
      await domain.security.rejectGuestInviteRequest({
        workspaceId: ws.id,
        id: request.id,
        actorId: owner.id,
      })
      await expectDomainError(
        domain.security.rejectGuestInviteRequest({
          workspaceId: ws.id,
          id: request.id,
          actorId: owner.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_ALREADY_DECIDED,
        409,
      )
      await expectDomainError(
        domain.security.rejectGuestInviteRequest({
          workspaceId: ws.id,
          id: randomUUID(),
          actorId: owner.id,
        }),
        SECURITY_ERROR_CODES.REQUEST_NOT_FOUND,
        404,
      )
      expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.guestRequestRejected)).toHaveLength(1)
    })
  })

  // ── listings ─────────────────────────────────────────────────────────────────

  describe('listGuestInviteRequests', () => {
    it('returns PENDING first with requester and page context, scoped to the workspace', async () => {
      const { ws, page, owner, member } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })

      const a = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('a'),
        role: 'READER',
      })
      const b = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('b'),
        role: 'EDITOR',
      })
      await domain.security.rejectGuestInviteRequest({
        workspaceId: ws.id,
        id: a.request.id,
        actorId: owner.id,
      })

      const list = await domain.security.listGuestInviteRequests(ws.id)
      expect(list).toHaveLength(2)
      expect(list[0]!.id).toBe(b.request.id) // PENDING first
      expect(list[0]!.status).toBe('PENDING')
      expect(list[0]!.requesterEmail).toBe(email('member').toLowerCase())
      expect(list[0]!.requesterName).toBe('member')
      expect(list[0]!.pageTitle).toBe('Secured page')
      expect(list[1]!.id).toBe(a.request.id)
      expect(list[1]!.status).toBe('REJECTED')
    })
  })

  describe('listMyRequestsForPage', () => {
    it("returns only the requester's own requests for the page, newest first", async () => {
      const { ws, page, owner, owner2, member } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })

      const mine = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('mine'),
        role: 'READER',
      })
      await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: owner2.id,
        email: email('theirs'),
        role: 'READER',
      })
      const mine2 = await domain.security.createGuestInviteRequest({
        pageId: page.id,
        requesterId: member.id,
        email: email('mine2'),
        role: 'EDITOR',
      })

      const list = await domain.security.listMyRequestsForPage(page.id, member.id)
      expect(list.map((r) => r.id)).toEqual([mine2.request.id, mine.request.id])
      expect(list.every((r) => r.requesterId === member.id)).toBe(true)
    })
  })

  // ── people.createGuestInvite under the policy ────────────────────────────────

  describe('people.createGuestInvite policy gate', () => {
    it('denies with POLICY_GUEST_INVITES_DISABLED when the policy disables invites', async () => {
      const { ws, page, owner } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const err = await expectDomainError(
        domain.people.createGuestInvite({
          pageId: page.id,
          actorId: owner.id,
          email: email('guest'),
          role: 'READER',
        }),
        SECURITY_ERROR_CODES.POLICY_GUEST_INVITES_DISABLED,
        403,
      )
      expect(err.message).toBe(
        securityError(SECURITY_ERROR_CODES.POLICY_GUEST_INVITES_DISABLED).message,
      )
      expect(await prisma.pageGuestInvite.findMany({ where: { pageId: page.id } })).toEqual([])
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInvited)).toHaveLength(0)
    })

    it('bypassPolicy: true is honored (the approval path contract)', async () => {
      const { ws, page, owner } = await seed()
      await setPolicy(ws.id, owner.id, { disableGuestInvites: true })
      const { invite, token } = await domain.people.createGuestInvite(
        { pageId: page.id, actorId: owner.id, email: email('guest'), role: 'READER' },
        { bypassPolicy: true },
      )
      expect(invite.email).toBe(email('guest').toLowerCase())
      expect(token).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(await prisma.pageGuestInvite.findMany({ where: { pageId: page.id } })).toHaveLength(1)
    })

    it('a policy row with disableGuestInvites=false (or no row) keeps invites working unchanged', async () => {
      const { ws, page, owner } = await seed()
      // No row: the people suites pin this at length; spot-check here.
      const first = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: email('guest-a'),
        role: 'READER',
      })
      expect(first.invite.state).toBe('PENDING')
      // Row present but the flag off.
      await setPolicy(ws.id, owner.id, { disableExport: true })
      const second = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: email('guest-b'),
        role: 'EDITOR',
      })
      expect(second.invite.state).toBe('PENDING')
    })
  })
})
