import { randomBytes, randomUUID } from 'node:crypto'

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

// Real-DB integration test for the people domain service, part 2: invite link,
// page guests, conversion, role matrix, blocking. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+people-guests-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
const PRO_PLAN_SLUG = 'people-guests-test-pro'

const domain = createDomain({ prisma, scheduler: makeScheduler() })

async function cleanFixtures() {
  const createdByContains = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const byCreatorWs = { workspace: createdByContains }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInvite.deleteMany({ where: byCreatorWs })
  await prisma.pageShareUser.deleteMany({
    where: { OR: [byUser, { pageShare: { page: byCreatorWs } }] },
  })
  await prisma.pageShare.deleteMany({ where: { page: byCreatorWs } })
  await prisma.page.deleteMany({ where: byCreatorWs })
  await prisma.workspaceInviteLink.deleteMany({ where: byCreatorWs })
  await prisma.workspaceInvitation.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({ where: createdByContains })
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

// Race-safe against the sibling people suite running in parallel on a fresh DB.
async function ensurePlans() {
  await prisma.plan.createMany({
    data: [
      { slug: 'personal', name: 'Персональный', maxWorkspaces: 1, sortOrder: 1 },
      { slug: PRO_PLAN_SLUG, name: 'People Guests Pro', maxMembersPerWorkspace: 10, sortOrder: 98 },
    ],
    skipDuplicates: true,
  })
  return prisma.plan.findUniqueOrThrow({ where: { slug: PRO_PLAN_SLUG } })
}

async function seed() {
  const plan = await ensurePlans()
  const owner = await makeUser('owner')
  const guest = await makeUser('guest')
  const outsider = await makeUser('outsider')
  await prisma.subscription.create({
    data: {
      userId: owner.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodEnd: new Date('2027-01-15T00:00:00.000Z'),
    },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'PeopleGuestsWS', createdById: owner.id },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 5, maxFileBytes: 0, syncedAt: new Date() },
  })
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, title: 'Guest page', createdById: owner.id },
  })
  return { owner, guest, outsider, ws, page }
}

async function addMember(workspaceId: string, userId: string, role: RoleType) {
  return prisma.workspaceMember.create({ data: { workspaceId, userId, role } })
}

/** Direct PageShare + grant fixture (the state guest acceptance produces). */
async function grantPage(pageId: string, userId: string, role: 'READER' | 'COMMENTER' | 'EDITOR') {
  const share =
    (await prisma.pageShare.findUnique({ where: { pageId }, select: { id: true } })) ??
    (await prisma.pageShare.create({
      data: { pageId, shareId: randomBytes(32).toString('hex') },
      select: { id: true },
    }))
  return prisma.pageShareUser.create({ data: { pageShareId: share.id, userId, role } })
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

describe('people service — guests, link, roles, blocking', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  // ── invite link ────────────────────────────────────────────────────────────

  describe('enableInviteLink / getInviteLink', () => {
    it('creates an enabled link with the role, returns the plaintext once, stores only the hash, audits', async () => {
      const { ws, owner } = await seed()
      const { link, token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.COMMENTER,
      })
      expect(link.enabled).toBe(true)
      expect(link.role).toBe(RoleType.COMMENTER)
      expect(token).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(JSON.stringify(link)).not.toContain(token)
      expect(JSON.stringify(link)).not.toContain(hashInviteToken(token))

      const row = await prisma.workspaceInviteLink.findUniqueOrThrow({
        where: { workspaceId: ws.id },
      })
      expect(row.tokenHash).toBe(hashInviteToken(token))
      expect(row.enabled).toBe(true)

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkEnabled)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
    })

    it('rejects OWNER, ADMIN and GUEST link roles with FORBIDDEN_ROLE', async () => {
      const { ws, owner } = await seed()
      for (const role of [RoleType.OWNER, RoleType.ADMIN, RoleType.GUEST]) {
        await expectDomainError(
          domain.people.enableInviteLink({ workspaceId: ws.id, actorId: owner.id, role }),
          PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
          403,
        )
      }
      expect(await prisma.workspaceInviteLink.findUnique({ where: { workspaceId: ws.id } })).toBe(
        null,
      )
    })

    it('re-enabling issues a FRESH token on the same single row; the old token is dead', async () => {
      const { ws, owner, guest } = await seed()
      const first = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      const second = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.EDITOR,
      })
      expect(second.token).not.toBe(first.token)
      expect(second.link.role).toBe(RoleType.EDITOR)
      expect(await prisma.workspaceInviteLink.count({ where: { workspaceId: ws.id } })).toBe(1)

      await expectDomainError(
        domain.people.joinViaLink({ token: first.token, userId: guest.id }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('getInviteLink returns the state without any token material, null when absent', async () => {
      const { ws, owner } = await seed()
      expect(await domain.people.getInviteLink(ws.id)).toBeNull()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      const link = await domain.people.getInviteLink(ws.id)
      expect(link).not.toBeNull()
      expect(link!.enabled).toBe(true)
      expect(link!.role).toBe(RoleType.VIEWER)
      expect(JSON.stringify(link)).not.toContain(token)
      expect(JSON.stringify(link)).not.toContain(hashInviteToken(token))
    })
  })

  describe('disableInviteLink', () => {
    it('disables the link, audits, and the token joins like an unknown one (no oracle)', async () => {
      const { ws, owner, guest } = await seed()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.EDITOR,
      })
      await domain.people.disableInviteLink({ workspaceId: ws.id, actorId: owner.id })

      const link = await domain.people.getInviteLink(ws.id)
      expect(link!.enabled).toBe(false)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkDisabled)).toHaveLength(1)

      // disabled and unknown are indistinguishable
      const disabled = await expectDomainError(
        domain.people.joinViaLink({ token, userId: guest.id }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      const unknown = await expectDomainError(
        domain.people.joinViaLink({ token: generateInviteToken(), userId: guest.id }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      expect(disabled.message).toBe(unknown.message)
    })

    it('is idempotent: disabling a disabled or missing link succeeds without extra audit rows', async () => {
      const { ws, owner } = await seed()
      await expect(
        domain.people.disableInviteLink({ workspaceId: ws.id, actorId: owner.id }),
      ).resolves.toBeNull()
      await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      await domain.people.disableInviteLink({ workspaceId: ws.id, actorId: owner.id })
      await domain.people.disableInviteLink({ workspaceId: ws.id, actorId: owner.id })
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkDisabled)).toHaveLength(1)
    })
  })

  describe('rotateInviteLink', () => {
    it('issues a fresh token, kills the old one, sets rotatedAt, audits', async () => {
      const { ws, owner, guest } = await seed()
      const first = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.EDITOR,
      })
      const rotated = await domain.people.rotateInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(rotated.token).not.toBe(first.token)
      expect(rotated.link.rotatedAt).not.toBeNull()

      await expectDomainError(
        domain.people.joinViaLink({ token: first.token, userId: guest.id }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      const joined = await domain.people.joinViaLink({ token: rotated.token, userId: guest.id })
      expect(joined.alreadyMember).toBe(false)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkRotated)).toHaveLength(1)
    })

    it('throws INVITE_NOT_FOUND when the workspace has no link', async () => {
      const { ws, owner } = await seed()
      await expectDomainError(
        domain.people.rotateInviteLink({ workspaceId: ws.id, actorId: owner.id }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })
  })

  describe('joinViaLink', () => {
    it('creates the member with the link role, ensures the personal collection, audits invite_link.joined', async () => {
      const { ws, owner, guest } = await seed()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.COMMENTER,
      })
      const result = await domain.people.joinViaLink({ token, userId: guest.id })
      expect(result).toEqual({
        workspaceId: ws.id,
        role: RoleType.COMMENTER,
        alreadyMember: false,
      })

      const member = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
      })
      expect(member.role).toBe(RoleType.COMMENTER)
      const personal = await prisma.collection.findFirst({
        where: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: guest.id },
      })
      expect(personal).not.toBeNull()

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkJoined)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
    })

    it('refuses a blocked user with USER_BLOCKED and creates nothing', async () => {
      const { ws, owner, guest } = await seed()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: guest.id, blockedById: owner.id },
      })
      await expectDomainError(
        domain.people.joinViaLink({ token, userId: guest.id }),
        PEOPLE_ERROR_CODES.USER_BLOCKED,
        403,
      )
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
        }),
      ).toBeNull()
    })

    it('an existing member joins as a no-op alreadyMember success — and the join is audited', async () => {
      const { ws, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.VIEWER)
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.EDITOR,
      })
      const result = await domain.people.joinViaLink({ token, userId: guest.id })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.VIEWER, alreadyMember: true })
      expect(
        await prisma.workspaceMember.count({ where: { workspaceId: ws.id, userId: guest.id } }),
      ).toBe(1)
      // parity with acceptInvitation: the alreadyMember path writes an audit row too
      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkJoined)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
      expect(audits[0]!.metadata).toEqual({ alreadyMember: true })
    })

    it('two concurrent joins converge: one member row, one normal + one alreadyMember result, both audited', async () => {
      const { ws, owner } = await seed()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      // A few rounds to shake out interleaving luck (the 7B atomic-claim pattern):
      // the loser of the workspace_members unique race must converge on the
      // alreadyMember path instead of surfacing P2002.
      for (let i = 0; i < 3; i++) {
        const user = await makeUser(`linkrace${i}`)
        const results = await Promise.all([
          domain.people.joinViaLink({ token, userId: user.id }),
          domain.people.joinViaLink({ token, userId: user.id }),
        ])

        expect(results.filter((r) => !r.alreadyMember)).toHaveLength(1)
        expect(results.filter((r) => r.alreadyMember)).toHaveLength(1)
        for (const r of results) {
          expect(r.workspaceId).toBe(ws.id)
          expect(r.role).toBe(RoleType.VIEWER)
        }

        const members = await prisma.workspaceMember.findMany({
          where: { workspaceId: ws.id, userId: user.id },
        })
        expect(members).toHaveLength(1)
        expect(members[0]!.role).toBe(RoleType.VIEWER)
        // both the winner and the alreadyMember loser audit invite_link.joined
        const audits = (await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.inviteLinkJoined)).filter(
          (a) => a.targetUserId === user.id,
        )
        expect(audits).toHaveLength(2)
      }
    })

    it('re-checks the seat limit ⇒ SEAT_LIMIT_REACHED', async () => {
      const { ws, owner, guest } = await seed()
      const { token } = await domain.people.enableInviteLink({
        workspaceId: ws.id,
        actorId: owner.id,
        role: RoleType.VIEWER,
      })
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 1 }, // owner holds the only seat
      })
      await expectDomainError(
        domain.people.joinViaLink({ token, userId: guest.id }),
        PEOPLE_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
    })
  })

  // ── guest invites ──────────────────────────────────────────────────────────

  describe('createGuestInvite', () => {
    it('creates a pending invite, lowercases the email, derives workspaceId from the page, audits', async () => {
      const { ws, page, owner, guest } = await seed()
      const { invite, token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email.toUpperCase(),
        role: 'COMMENTER',
      })
      expect(invite.pageId).toBe(page.id)
      expect(invite.workspaceId).toBe(ws.id)
      expect(invite.email).toBe(guest.email.toLowerCase())
      expect(invite.role).toBe('COMMENTER')
      expect(invite.state).toBe('PENDING')
      expect(token).toMatch(/^[A-Za-z0-9]{32}$/)

      const row = await prisma.pageGuestInvite.findUniqueOrThrow({ where: { id: invite.id } })
      expect(row.tokenHash).toBe(hashInviteToken(token))
      expect(JSON.stringify(row)).not.toContain(token)
      const ttlMs = row.expiresAt.getTime() - Date.now()
      expect(ttlMs).toBeGreaterThan(6.9 * 24 * 3600 * 1000)
      expect(ttlMs).toBeLessThan(7.1 * 24 * 3600 * 1000)

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInvited)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetEmail).toBe(guest.email.toLowerCase())
    })

    it('throws NOT_FOUND for an unknown page and for a deleted page', async () => {
      const { page, owner, guest } = await seed()
      await expectDomainError(
        domain.people.createGuestInvite({
          pageId: randomUUID(),
          actorId: owner.id,
          email: guest.email,
          role: 'READER',
        }),
        'NOT_FOUND',
        404,
      )
      await prisma.page.update({ where: { id: page.id }, data: { deletedAt: new Date() } })
      await expectDomainError(
        domain.people.createGuestInvite({
          pageId: page.id,
          actorId: owner.id,
          email: guest.email,
          role: 'READER',
        }),
        'NOT_FOUND',
        404,
      )
    })

    it('re-inviting an active email refreshes the same row: fresh token, new role, old token dead', async () => {
      const { ws, page, owner, guest } = await seed()
      const first = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      const second = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'EDITOR',
      })
      expect(second.invite.id).toBe(first.invite.id)
      expect(second.invite.role).toBe('EDITOR')
      expect(second.token).not.toBe(first.token)
      expect(
        await prisma.pageGuestInvite.count({ where: { pageId: page.id, email: guest.email } }),
      ).toBe(1)

      await expectDomainError(
        domain.people.acceptGuestInvite({
          token: first.token,
          userId: guest.id,
          userEmail: guest.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInvited)).toHaveLength(2)
    })
  })

  describe('revokeGuestInvite', () => {
    it('revokes, audits, and the token stops accepting with INVITE_REVOKED', async () => {
      const { ws, page, owner, guest } = await seed()
      const { invite, token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      await domain.people.revokeGuestInvite({
        workspaceId: ws.id,
        actorId: owner.id,
        inviteId: invite.id,
      })
      const row = await prisma.pageGuestInvite.findUniqueOrThrow({ where: { id: invite.id } })
      expect(row.revokedAt).not.toBeNull()
      expect(row.revokedById).toBe(owner.id)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInviteRevoked)).toHaveLength(1)

      await expectDomainError(
        domain.people.acceptGuestInvite({ token, userId: guest.id, userEmail: guest.email }),
        PEOPLE_ERROR_CODES.INVITE_REVOKED,
        412,
      )
    })

    it('is idempotent and scoped: foreign workspace or unknown id ⇒ INVITE_NOT_FOUND', async () => {
      const { ws, page, owner, guest } = await seed()
      const { invite } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      const input = { workspaceId: ws.id, actorId: owner.id, inviteId: invite.id }
      await domain.people.revokeGuestInvite(input)
      await expect(domain.people.revokeGuestInvite(input)).resolves.toEqual({ id: invite.id })
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestInviteRevoked)).toHaveLength(1)

      await expectDomainError(
        domain.people.revokeGuestInvite({
          workspaceId: ws.id,
          actorId: owner.id,
          inviteId: randomUUID(),
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
      const other = await prisma.workspace.create({
        data: { name: 'OtherWS', createdById: owner.id },
      })
      const otherPage = await prisma.page.create({
        data: { workspaceId: other.id, title: 'Other page', createdById: owner.id },
      })
      const foreign = await domain.people.createGuestInvite({
        pageId: otherPage.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      await expectDomainError(
        domain.people.revokeGuestInvite({
          workspaceId: ws.id,
          actorId: owner.id,
          inviteId: foreign.invite.id,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })
  })

  describe('acceptGuestInvite', () => {
    it('ensures the PageShare row, writes the grant with the invite role, marks accepted, audits guest.joined', async () => {
      const { ws, page, owner, guest } = await seed()
      const { invite, token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'EDITOR',
      })
      // no share row exists yet — acceptance must create it
      expect(await prisma.pageShare.findUnique({ where: { pageId: page.id } })).toBeNull()

      const result = await domain.people.acceptGuestInvite({
        token,
        userId: guest.id,
        userEmail: guest.email,
      })
      expect(result).toEqual({
        pageId: page.id,
        workspaceId: ws.id,
        role: 'EDITOR',
        alreadyMember: false,
      })

      const share = await prisma.pageShare.findUniqueOrThrow({ where: { pageId: page.id } })
      const grant = await prisma.pageShareUser.findUniqueOrThrow({
        where: { pageShareId_userId: { pageShareId: share.id, userId: guest.id } },
      })
      expect(grant.role).toBe('EDITOR')

      const row = await prisma.pageGuestInvite.findUniqueOrThrow({ where: { id: invite.id } })
      expect(row.acceptedAt).not.toBeNull()
      expect(row.acceptedById).toBe(guest.id)

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestJoined)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
    })

    it('reuses an existing PageShare row and upserts the grant role', async () => {
      const { page, owner, guest } = await seed()
      await grantPage(page.id, guest.id, 'READER')
      const before = await prisma.pageShare.findUniqueOrThrow({ where: { pageId: page.id } })

      const { token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'EDITOR',
      })
      await domain.people.acceptGuestInvite({ token, userId: guest.id, userEmail: guest.email })

      expect(await prisma.pageShare.count({ where: { pageId: page.id } })).toBe(1)
      const grant = await prisma.pageShareUser.findUniqueOrThrow({
        where: { pageShareId_userId: { pageShareId: before.id, userId: guest.id } },
      })
      expect(grant.role).toBe('EDITOR')
    })

    it('rejects email mismatch, expiry and blocked users without creating a grant', async () => {
      const { ws, page, owner, guest, outsider } = await seed()
      const { invite, token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      await expectDomainError(
        domain.people.acceptGuestInvite({
          token,
          userId: outsider.id,
          userEmail: outsider.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_EMAIL_MISMATCH,
        403,
      )
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: guest.id, blockedById: owner.id },
      })
      await expectDomainError(
        domain.people.acceptGuestInvite({ token, userId: guest.id, userEmail: guest.email }),
        PEOPLE_ERROR_CODES.USER_BLOCKED,
        403,
      )
      await prisma.workspaceBlockedUser.deleteMany({
        where: { workspaceId: ws.id, userId: guest.id },
      })
      await prisma.pageGuestInvite.update({
        where: { id: invite.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await expectDomainError(
        domain.people.acceptGuestInvite({ token, userId: guest.id, userEmail: guest.email }),
        PEOPLE_ERROR_CODES.INVITE_EXPIRED,
        412,
      )
      expect(await prisma.pageShareUser.count({ where: { userId: guest.id } })).toBe(0)
    })

    it('a workspace MEMBER accepting is a no-op alreadyMember success: invite closes, no grant', async () => {
      const { ws, page, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.EDITOR)
      const { invite, token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      const result = await domain.people.acceptGuestInvite({
        token,
        userId: guest.id,
        userEmail: guest.email,
      })
      expect(result).toEqual({
        pageId: page.id,
        workspaceId: ws.id,
        role: 'READER',
        alreadyMember: true,
      })
      expect(await prisma.pageShareUser.count({ where: { userId: guest.id } })).toBe(0)
      const row = await prisma.pageGuestInvite.findUniqueOrThrow({ where: { id: invite.id } })
      expect(row.acceptedAt).not.toBeNull()
    })

    it('double-accept by the same user is idempotent; the token is dead for anyone else', async () => {
      const { page, owner, guest, outsider } = await seed()
      const { token } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'COMMENTER',
      })
      const input = { token, userId: guest.id, userEmail: guest.email }
      const first = await domain.people.acceptGuestInvite(input)
      const second = await domain.people.acceptGuestInvite(input)
      expect(second.pageId).toBe(first.pageId)
      expect(second.role).toBe('COMMENTER')
      expect(await prisma.pageShareUser.count({ where: { userId: guest.id } })).toBe(1)

      await expectDomainError(
        domain.people.acceptGuestInvite({
          token,
          userId: outsider.id,
          userEmail: guest.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('throws INVITE_NOT_FOUND for an unknown token', async () => {
      const { guest } = await seed()
      await expectDomainError(
        domain.people.acceptGuestInvite({
          token: generateInviteToken(),
          userId: guest.id,
          userEmail: guest.email,
        }),
        PEOPLE_ERROR_CODES.INVITE_NOT_FOUND,
        404,
      )
    })

    it('two concurrent accepts cannot race ensureShareForPage: one share row, one grant, both resolve', async () => {
      const { ws, owner } = await seed()
      // A few rounds to shake out interleaving luck (the 7B atomic-claim pattern):
      // the read-then-create on the unique pageId must not surface P2002.
      for (let i = 0; i < 3; i++) {
        const user = await makeUser(`guestrace${i}`)
        const page = await prisma.page.create({
          data: { workspaceId: ws.id, title: `Race page ${i}`, createdById: owner.id },
        })
        const { invite, token } = await domain.people.createGuestInvite({
          pageId: page.id,
          actorId: owner.id,
          email: user.email,
          role: 'COMMENTER',
        })
        const input = { token, userId: user.id, userEmail: user.email }
        // Promise.all rejects on any rejection — resolution itself asserts no 500
        const results = await Promise.all([
          domain.people.acceptGuestInvite(input),
          domain.people.acceptGuestInvite(input),
        ])
        for (const r of results) {
          expect(r).toEqual({
            pageId: page.id,
            workspaceId: ws.id,
            role: 'COMMENTER',
            alreadyMember: false,
          })
        }

        const shares = await prisma.pageShare.findMany({ where: { pageId: page.id } })
        expect(shares).toHaveLength(1)
        const grants = await prisma.pageShareUser.findMany({
          where: { pageShareId: shares[0]!.id, userId: user.id },
        })
        expect(grants).toHaveLength(1)
        expect(grants[0]!.role).toBe('COMMENTER')
        const row = await prisma.pageGuestInvite.findUniqueOrThrow({ where: { id: invite.id } })
        expect(row.acceptedAt).not.toBeNull()
        expect(row.acceptedById).toBe(user.id)
      }
    })
  })

  // ── listGuests ─────────────────────────────────────────────────────────────

  describe('listGuests', () => {
    it('lists grant-holders without member rows (with counts) plus pending invites; members excluded', async () => {
      const { ws, page, owner, guest, outsider } = await seed()
      const page2 = await prisma.page.create({
        data: { workspaceId: ws.id, title: 'Second page', createdById: owner.id },
      })
      // guest: two grants, no member row → listed with grantCount 2
      await grantPage(page.id, guest.id, 'READER')
      await grantPage(page2.id, guest.id, 'EDITOR')
      // outsider: a grant but ALSO a member row → not a guest
      await addMember(ws.id, outsider.id, RoleType.VIEWER)
      await grantPage(page.id, outsider.id, 'READER')
      // a pending invite for an unregistered email
      const { invite } = await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: email('unregistered'),
        role: 'READER',
      })

      const result = await domain.people.listGuests(ws.id)
      expect(result.guests).toEqual([
        { userId: guest.id, name: guest.name, email: guest.email, grantCount: 2 },
      ])
      expect(result.invites.map((i) => i.id)).toEqual([invite.id])
      expect(result.invites[0]!.state).toBe('PENDING')
    })

    it('ignores grants on deleted pages and other workspaces; empty workspace → empty arrays', async () => {
      const { ws, page, owner, guest } = await seed()
      expect(await domain.people.listGuests(ws.id)).toEqual({ guests: [], invites: [] })

      const other = await prisma.workspace.create({
        data: { name: 'OtherWS', createdById: owner.id },
      })
      const otherPage = await prisma.page.create({
        data: { workspaceId: other.id, title: 'Other page', createdById: owner.id },
      })
      await grantPage(otherPage.id, guest.id, 'READER')
      await grantPage(page.id, guest.id, 'READER')
      await prisma.page.update({ where: { id: page.id }, data: { deletedAt: new Date() } })

      expect((await domain.people.listGuests(ws.id)).guests).toEqual([])
      expect((await domain.people.listGuests(other.id)).guests).toEqual([
        { userId: guest.id, name: guest.name, email: guest.email, grantCount: 1 },
      ])
    })
  })

  // ── revokeGuestAccess ──────────────────────────────────────────────────────

  describe('revokeGuestAccess', () => {
    it('deletes all grants on this workspace, revokes pending invites, audits — other workspaces untouched', async () => {
      const { ws, page, owner, guest } = await seed()
      const page2 = await prisma.page.create({
        data: { workspaceId: ws.id, title: 'Second page', createdById: owner.id },
      })
      await grantPage(page.id, guest.id, 'READER')
      await grantPage(page2.id, guest.id, 'EDITOR')
      await domain.people.createGuestInvite({
        pageId: page.id,
        actorId: owner.id,
        email: guest.email,
        role: 'READER',
      })
      const other = await prisma.workspace.create({
        data: { name: 'OtherWS', createdById: owner.id },
      })
      const otherPage = await prisma.page.create({
        data: { workspaceId: other.id, title: 'Other page', createdById: owner.id },
      })
      await grantPage(otherPage.id, guest.id, 'READER')

      const result = await domain.people.revokeGuestAccess({
        workspaceId: ws.id,
        actorId: owner.id,
        userId: guest.id,
      })
      expect(result).toEqual({ grantsRemoved: 2, invitesRevoked: 1 })

      expect(
        await prisma.pageShareUser.count({
          where: { userId: guest.id, pageShare: { page: { workspaceId: ws.id } } },
        }),
      ).toBe(0)
      expect(
        await prisma.pageShareUser.count({
          where: { userId: guest.id, pageShare: { page: { workspaceId: other.id } } },
        }),
      ).toBe(1)
      expect(
        await prisma.pageGuestInvite.count({
          where: { workspaceId: ws.id, email: guest.email, revokedAt: null },
        }),
      ).toBe(0)
      expect((await domain.people.listGuests(ws.id)).guests).toEqual([])

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestAccessRevoked)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
      expect(audits[0]!.metadata).toEqual({ grantsRemoved: 2, invitesRevoked: 1 })
    })
  })

  // ── convertGuestToMember ───────────────────────────────────────────────────

  describe('convertGuestToMember', () => {
    it('creates the member, ensures the personal collection, keeps the grants, audits', async () => {
      const { ws, page, owner, guest } = await seed()
      await grantPage(page.id, guest.id, 'EDITOR')

      const result = await domain.people.convertGuestToMember({
        workspaceId: ws.id,
        actorId: owner.id,
        userId: guest.id,
        role: RoleType.EDITOR,
      })
      expect(result).toEqual({ workspaceId: ws.id, role: RoleType.EDITOR })

      const member = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
      })
      expect(member.role).toBe(RoleType.EDITOR)
      const personal = await prisma.collection.findFirst({
        where: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: guest.id },
      })
      expect(personal).not.toBeNull()
      // grants kept (harmless for members)
      expect(await prisma.pageShareUser.count({ where: { userId: guest.id } })).toBe(1)
      // no longer a guest
      expect((await domain.people.listGuests(ws.id)).guests).toEqual([])

      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.guestConvertedToMember)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
    })

    it('rejects OWNER/GUEST roles, blocked users, existing members and full workspaces', async () => {
      const { ws, owner, guest, outsider } = await seed()
      for (const role of [RoleType.OWNER, RoleType.GUEST]) {
        await expectDomainError(
          domain.people.convertGuestToMember({
            workspaceId: ws.id,
            actorId: owner.id,
            userId: guest.id,
            role,
          }),
          PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
          403,
        )
      }
      await prisma.workspaceBlockedUser.create({
        data: { workspaceId: ws.id, userId: guest.id, blockedById: owner.id },
      })
      await expectDomainError(
        domain.people.convertGuestToMember({
          workspaceId: ws.id,
          actorId: owner.id,
          userId: guest.id,
          role: RoleType.VIEWER,
        }),
        PEOPLE_ERROR_CODES.USER_BLOCKED,
        403,
      )
      await addMember(ws.id, outsider.id, RoleType.VIEWER)
      await expectDomainError(
        domain.people.convertGuestToMember({
          workspaceId: ws.id,
          actorId: owner.id,
          userId: outsider.id,
          role: RoleType.VIEWER,
        }),
        PEOPLE_ERROR_CODES.ALREADY_MEMBER,
        409,
      )
      await prisma.workspaceBlockedUser.deleteMany({
        where: { workspaceId: ws.id, userId: guest.id },
      })
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 2 }, // owner + outsider already seated
      })
      await expectDomainError(
        domain.people.convertGuestToMember({
          workspaceId: ws.id,
          actorId: owner.id,
          userId: guest.id,
          role: RoleType.VIEWER,
        }),
        PEOPLE_ERROR_CODES.SEAT_LIMIT_REACHED,
        403,
      )
    })
  })

  // ── changeMemberRole ───────────────────────────────────────────────────────

  describe('changeMemberRole', () => {
    it('OWNER changes a member role and audits with from/to metadata', async () => {
      const { ws, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.VIEWER)
      const result = await domain.people.changeMemberRole({
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: guest.id,
        role: RoleType.ADMIN,
      })
      expect(result).toEqual({ userId: guest.id, role: RoleType.ADMIN })
      const member = await prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
      })
      expect(member.role).toBe(RoleType.ADMIN)
      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.memberRoleChanged)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.metadata).toEqual({ from: 'VIEWER', to: 'ADMIN' })
    })

    it('ADMIN can change non-OWNER rows but neither OWNER rows nor grant OWNER', async () => {
      const { ws, owner, guest, outsider } = await seed()
      const admin = await makeUser('admin')
      await addMember(ws.id, admin.id, RoleType.ADMIN)
      await addMember(ws.id, guest.id, RoleType.VIEWER)
      void outsider

      const ok = await domain.people.changeMemberRole({
        workspaceId: ws.id,
        actorId: admin.id,
        actorRole: RoleType.ADMIN,
        userId: guest.id,
        role: RoleType.EDITOR,
      })
      expect(ok.role).toBe(RoleType.EDITOR)

      await expectDomainError(
        domain.people.changeMemberRole({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: owner.id,
          role: RoleType.EDITOR,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
      await expectDomainError(
        domain.people.changeMemberRole({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: guest.id,
          role: RoleType.OWNER,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
    })

    it('rejects the frozen legacy GUEST as a target role and unknown members', async () => {
      const { ws, owner, guest, outsider } = await seed()
      await addMember(ws.id, guest.id, RoleType.VIEWER)
      await expectDomainError(
        domain.people.changeMemberRole({
          workspaceId: ws.id,
          actorId: owner.id,
          actorRole: RoleType.OWNER,
          userId: guest.id,
          role: RoleType.GUEST,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
      await expectDomainError(
        domain.people.changeMemberRole({
          workspaceId: ws.id,
          actorId: owner.id,
          actorRole: RoleType.OWNER,
          userId: outsider.id,
          role: RoleType.EDITOR,
        }),
        'NOT_FOUND',
        404,
      )
    })

    it('demoting the LAST owner ⇒ LAST_OWNER; one of two owners can be demoted', async () => {
      const { ws, owner, guest } = await seed()
      await expectDomainError(
        domain.people.changeMemberRole({
          workspaceId: ws.id,
          actorId: owner.id,
          actorRole: RoleType.OWNER,
          userId: owner.id,
          role: RoleType.ADMIN,
        }),
        PEOPLE_ERROR_CODES.LAST_OWNER,
        409,
      )
      // promote a second owner — now the demotion goes through
      await addMember(ws.id, guest.id, RoleType.OWNER)
      const result = await domain.people.changeMemberRole({
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: owner.id,
        role: RoleType.ADMIN,
      })
      expect(result.role).toBe(RoleType.ADMIN)
    })
  })

  // ── removeMember ───────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('removes the member and audits; grants survive so they become a guest', async () => {
      const { ws, page, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.EDITOR)
      await grantPage(page.id, guest.id, 'COMMENTER')
      // a member with a grant is NOT a guest
      expect((await domain.people.listGuests(ws.id)).guests).toEqual([])

      const result = await domain.people.removeMember({
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: guest.id,
      })
      expect(result).toEqual({ userId: guest.id })
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
        }),
      ).toBeNull()
      // removal keeps grants — the ex-member shows up in the guests list now
      expect((await domain.people.listGuests(ws.id)).guests).toEqual([
        { userId: guest.id, name: guest.name, email: guest.email, grantCount: 1 },
      ])
      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.memberRemoved)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
    })

    it('ADMIN cannot remove an OWNER row ⇒ FORBIDDEN_ROLE; unknown member ⇒ NOT_FOUND', async () => {
      const { ws, owner, outsider } = await seed()
      const admin = await makeUser('admin')
      await addMember(ws.id, admin.id, RoleType.ADMIN)
      await expectDomainError(
        domain.people.removeMember({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: owner.id,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
      await expectDomainError(
        domain.people.removeMember({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: outsider.id,
        }),
        'NOT_FOUND',
        404,
      )
    })

    it('removing the LAST owner ⇒ LAST_OWNER; one of two owners can be removed', async () => {
      const { ws, owner, guest } = await seed()
      await expectDomainError(
        domain.people.removeMember({
          workspaceId: ws.id,
          actorId: owner.id,
          actorRole: RoleType.OWNER,
          userId: owner.id,
        }),
        PEOPLE_ERROR_CODES.LAST_OWNER,
        409,
      )
      await addMember(ws.id, guest.id, RoleType.OWNER)
      await expect(
        domain.people.removeMember({
          workspaceId: ws.id,
          actorId: guest.id,
          actorRole: RoleType.OWNER,
          userId: owner.id,
        }),
      ).resolves.toEqual({ userId: owner.id })
    })
  })

  // ── blockUser / unblockUser ────────────────────────────────────────────────

  describe('blockUser / unblockUser', () => {
    it('blocks a member with a reason, audits; the seat row survives', async () => {
      const { ws, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.EDITOR)
      const result = await domain.people.blockUser({
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: guest.id,
        reason: 'spam',
      })
      expect(result).toEqual({ blocked: true })
      const row = await prisma.workspaceBlockedUser.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
      })
      expect(row.reason).toBe('spam')
      expect(row.blockedById).toBe(owner.id)
      // the member row (seat) survives until explicit removal
      expect(
        await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
        }),
      ).not.toBeNull()
      const audits = await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userBlocked)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.targetUserId).toBe(guest.id)
    })

    it('blocks non-members (guests) too', async () => {
      const { ws, page, owner, guest } = await seed()
      await grantPage(page.id, guest.id, 'READER')
      await domain.people.blockUser({
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: guest.id,
      })
      await expect(domain.people.isWorkspaceBlocked(ws.id, guest.id)).resolves.toBe(true)
    })

    it('cannot block an OWNER nor yourself ⇒ FORBIDDEN_ROLE', async () => {
      const { ws, owner } = await seed()
      const admin = await makeUser('admin')
      await addMember(ws.id, admin.id, RoleType.ADMIN)
      await expectDomainError(
        domain.people.blockUser({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: owner.id,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
      await expectDomainError(
        domain.people.blockUser({
          workspaceId: ws.id,
          actorId: admin.id,
          actorRole: RoleType.ADMIN,
          userId: admin.id,
        }),
        PEOPLE_ERROR_CODES.FORBIDDEN_ROLE,
        403,
      )
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userBlocked)).toHaveLength(0)
    })

    it('re-block is idempotent (single row, single audit); unblock removes and audits, idempotently', async () => {
      const { ws, owner, guest } = await seed()
      await addMember(ws.id, guest.id, RoleType.VIEWER)
      const input = {
        workspaceId: ws.id,
        actorId: owner.id,
        actorRole: RoleType.OWNER,
        userId: guest.id,
      }
      await domain.people.blockUser(input)
      await expect(domain.people.blockUser(input)).resolves.toEqual({ blocked: true })
      expect(
        await prisma.workspaceBlockedUser.count({
          where: { workspaceId: ws.id, userId: guest.id },
        }),
      ).toBe(1)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userBlocked)).toHaveLength(1)

      await expect(
        domain.people.unblockUser({ workspaceId: ws.id, actorId: owner.id, userId: guest.id }),
      ).resolves.toEqual({ blocked: false })
      await expect(domain.people.isWorkspaceBlocked(ws.id, guest.id)).resolves.toBe(false)
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userUnblocked)).toHaveLength(1)
      // idempotent unblock: no extra audit
      await expect(
        domain.people.unblockUser({ workspaceId: ws.id, actorId: owner.id, userId: guest.id }),
      ).resolves.toEqual({ blocked: false })
      expect(await auditRows(ws.id, PEOPLE_AUDIT_ACTIONS.userUnblocked)).toHaveLength(1)
    })
  })
})
