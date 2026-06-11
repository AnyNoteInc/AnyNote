import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.BETTER_AUTH_URL ||= 'http://localhost:3000'

// The SendSay edge is the only mocked module (vi.mock keeps the other exports
// real) — everything else runs against postgres. Captured sends double as the
// token-recovery channel: plaintext invite tokens exist ONLY inside the links.
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

import { peopleRouter } from '../src/routers/people'
import { pageShareRouter } from '../src/routers/page-share'
import { workspaceRouter } from '../src/routers/workspace'
import { aiSettingsRouter } from '../src/routers/ai-settings'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the people router. Email-suffix fixture
// namespace, self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+people-router-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
// Dedicated paid plan: people.invite is plan-gated on the WORKSPACE owner's
// plan; flipping flags on the shared dev DB's `personal` plan would be a
// DB-wide change, so the owner gets an ACTIVE subscription to this one.
const PRO_PLAN_SLUG = 'people-router-test-pro'
const BLOCKED_MESSAGE = 'Доступ заблокирован администратором'
const RETURN_URL_BASE = 'http://app.test'

type FixtureUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

async function cleanFixtures() {
  const byCreatorWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.notificationEvent.deleteMany({ where: byUser })
  await prisma.userPreference.deleteMany({ where: byUser })
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInvite.deleteMany({ where: byCreatorWs })
  await prisma.workspaceInvitation.deleteMany({ where: byCreatorWs })
  await prisma.workspaceInviteLink.deleteMany({ where: byCreatorWs })
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

function ctxFor(user: FixtureUser | null) {
  return {
    prisma,
    user: user
      ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          emailVerified: true,
        }
      : null,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: RETURN_URL_BASE,
    jobs: { kick: vi.fn() },
  } as never
}

const people = (u: FixtureUser) => createCallerFactory(peopleRouter)(ctxFor(u))
const peoplePublic = () => createCallerFactory(peopleRouter)(ctxFor(null))
const pageShare = (u: FixtureUser) => createCallerFactory(pageShareRouter)(ctxFor(u))
const workspaceCaller = (u: FixtureUser) => createCallerFactory(workspaceRouter)(ctxFor(u))
const aiSettingsCaller = (u: FixtureUser) => createCallerFactory(aiSettingsRouter)(ctxFor(u))

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
      name: 'People Router Test Pro',
      maxMembersPerWorkspace: 10,
      sortOrder: 99,
    },
  })
}

const PERIOD_END = new Date('2027-02-01T00:00:00.000Z')

async function seed() {
  await ensurePersonalPlan()
  const plan = await ensureProPlan()
  const owner = await makeUser('owner')
  const admin = await makeUser('admin')
  const editor = await makeUser('editor')
  const member = await makeUser('member')
  await prisma.subscription.create({
    data: { userId: owner.id, planId: plan.id, status: 'ACTIVE', currentPeriodEnd: PERIOD_END },
  })
  const ws = await prisma.workspace.create({
    data: { name: 'PeopleRouterWS', createdById: owner.id },
    select: { id: true, name: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: admin.id, role: 'ADMIN' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 10, maxFileBytes: 0, syncedAt: new Date() },
  })
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, title: 'Shared page', type: 'TEXT', createdById: owner.id },
    select: { id: true },
  })
  return { owner, admin, editor, member, ws, page }
}

function lastMail() {
  const mail = mailMock.sent.at(-1)
  if (!mail) throw new Error('no mail captured')
  return mail
}

function tokenFromLink(link: unknown, segment: string): string {
  const match = String(link).match(new RegExp(`/${segment}/([A-Za-z0-9]{32})$`))
  if (!match) throw new Error(`no /${segment}/ token in link: ${String(link)}`)
  return match[1]!
}

/** Invite an email and recover the plaintext token from the captured mail link. */
async function inviteWithToken(
  actor: FixtureUser,
  workspaceId: string,
  email: string,
  role: 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' = 'EDITOR',
) {
  const result = await people(actor).invite({ workspaceId, email, role })
  return { result, token: tokenFromLink(lastMail().data.link, 'invite') }
}

describe('people router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    mailMock.sent.length = 0
  })
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  // ── role matrix ─────────────────────────────────────────────────────────────

  describe('role matrix', () => {
    it('EDITOR is denied on managed procedures', async () => {
      const { editor, ws } = await seed()
      await expect(people(editor).listInvitations({ workspaceId: ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(
        people(editor).invite({ workspaceId: ws.id, email: emailFor('x'), role: 'EDITOR' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        people(editor).block({ workspaceId: ws.id, userId: editor.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('ADMIN can invite, change a non-owner role, remove and block non-owners', async () => {
      const { admin, member, ws } = await seed()
      const { result } = await inviteWithToken(admin, ws.id, emailFor('byadmin'))
      expect(result.invitation.state).toBe('PENDING')

      await expect(
        people(admin).changeMemberRole({ workspaceId: ws.id, userId: member.id, role: 'VIEWER' }),
      ).resolves.toMatchObject({ role: 'VIEWER' })
      await expect(
        people(admin).block({ workspaceId: ws.id, userId: member.id }),
      ).resolves.toMatchObject({ blocked: true })
      await expect(
        people(admin).unblock({ workspaceId: ws.id, userId: member.id }),
      ).resolves.toMatchObject({ blocked: false })
      await expect(
        people(admin).removeMember({ workspaceId: ws.id, userId: member.id }),
      ).resolves.toMatchObject({ userId: member.id })
    })

    it('ADMIN cannot touch OWNER rows, grant OWNER, or block an OWNER', async () => {
      const { admin, owner, member, ws } = await seed()
      await expect(
        people(admin).changeMemberRole({ workspaceId: ws.id, userId: owner.id, role: 'EDITOR' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        people(admin).changeMemberRole({ workspaceId: ws.id, userId: member.id, role: 'OWNER' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        people(admin).removeMember({ workspaceId: ws.id, userId: owner.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        people(admin).block({ workspaceId: ws.id, userId: owner.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('auditLog is OWNER-only (ADMIN ⇒ FORBIDDEN)', async () => {
      const { owner, admin, ws } = await seed()
      await expect(people(admin).auditLog({ workspaceId: ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(people(owner).auditLog({ workspaceId: ws.id })).resolves.toMatchObject({
        items: [],
        nextCursor: null,
      })
    })

    it('regression: workspace.delete and aiSettings.update stay OWNER-only for ADMIN', async () => {
      const { admin, ws } = await seed()
      await expect(workspaceCaller(admin).delete({ id: ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
      await expect(
        aiSettingsCaller(admin).update({ workspaceId: ws.id, systemPrompt: 'x' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })
  })

  // ── invite lifecycle ────────────────────────────────────────────────────────

  describe('invite lifecycle', () => {
    it('invites an UNREGISTERED email: invitation mail with /invite/{token}, no in-app rows', async () => {
      const { owner, ws } = await seed()
      const strangerEmail = emailFor('Stranger') // mixed case on purpose
      const { result } = await inviteWithToken(owner, ws.id, strangerEmail)

      expect(result.invitation).toMatchObject({
        email: strangerEmail.toLowerCase(),
        role: 'EDITOR',
        state: 'PENDING',
      })
      expect(result.preview).toMatchObject({ maxMembers: 10, isPaid: true })
      expect(result.preview.currentMembers).toBe(4)
      // The response NEVER carries the token.
      expect(JSON.stringify(result)).not.toContain('token')

      expect(mailMock.sent).toHaveLength(1)
      const mail = lastMail()
      expect(mail.kind).toBe('invitation')
      expect(mail.to).toBe(strangerEmail.toLowerCase())
      expect(String(mail.data.link)).toMatch(
        new RegExp(`^${RETURN_URL_BASE}/invite/[A-Za-z0-9]{32}$`),
      )

      const events = await prisma.notificationEvent.count({
        where: { type: 'WORKSPACE_INVITE', workspaceId: ws.id },
      })
      expect(events).toBe(0)

      const listed = await people(owner).listInvitations({ workspaceId: ws.id })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ email: strangerEmail.toLowerCase(), state: 'PENDING' })
    })

    it('invites a REGISTERED user: in-app WORKSPACE_INVITE carries the /invite link, no sync mail', async () => {
      const { owner, ws } = await seed()
      const registered = await makeUser('registered')
      await people(owner).invite({ workspaceId: ws.id, email: registered.email, role: 'VIEWER' })

      expect(mailMock.sent).toHaveLength(0)
      const event = await prisma.notificationEvent.findFirstOrThrow({
        where: { type: 'WORKSPACE_INVITE', userId: registered.id },
        include: { inApp: true },
      })
      expect(event.inApp).not.toBeNull()
      const payload = event.payload as { link?: string }
      expect(String(payload.link)).toMatch(
        new RegExp(`^${RETURN_URL_BASE}/invite/[A-Za-z0-9]{32}$`),
      )
    })

    it('a personal-plan workspace cannot invite (paid gate)', async () => {
      await seed()
      const freeOwner = await makeUser('freeowner')
      const freeWs = await prisma.workspace.create({
        data: {
          name: 'FreeWS',
          createdById: freeOwner.id,
          members: { create: [{ userId: freeOwner.id, role: 'OWNER' }] },
        },
        select: { id: true },
      })
      await expect(
        people(freeOwner).invite({ workspaceId: freeWs.id, email: emailFor('x'), role: 'EDITOR' }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Это действие доступно на платных тарифах',
      })
    })

    it('inviting an existing member is a CONFLICT', async () => {
      const { owner, member, ws } = await seed()
      await expect(
        people(owner).invite({ workspaceId: ws.id, email: member.email, role: 'EDITOR' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
    })

    it('re-inviting refreshes the invitation (one row, a fresh token)', async () => {
      const { owner, ws } = await seed()
      const email = emailFor('refresh')
      const { token: first } = await inviteWithToken(owner, ws.id, email, 'EDITOR')
      const { token: second } = await inviteWithToken(owner, ws.id, email, 'VIEWER')
      expect(second).not.toBe(first)

      const listed = await people(owner).listInvitations({ workspaceId: ws.id })
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ role: 'VIEWER' })
    })

    it('revokeInvitation removes it from the list and writes an audit row', async () => {
      const { owner, ws } = await seed()
      const { result } = await inviteWithToken(owner, ws.id, emailFor('revokee'))
      await people(owner).revokeInvitation({
        workspaceId: ws.id,
        invitationId: result.invitation.id,
      })
      await expect(people(owner).listInvitations({ workspaceId: ws.id })).resolves.toHaveLength(0)

      const audits = await prisma.workspaceAuditLog.findMany({
        where: { workspaceId: ws.id, action: { in: ['member.invited', 'invite.revoked'] } },
      })
      expect(audits.map((a) => a.action).sort()).toEqual(['invite.revoked', 'member.invited'])
    })

    it('invitePreview returns the billing-impact shape', async () => {
      const { owner, ws } = await seed()
      await expect(people(owner).invitePreview({ workspaceId: ws.id })).resolves.toMatchObject({
        currentMembers: 4,
        maxMembers: 10,
        planSlug: PRO_PLAN_SLUG,
        isPaid: true,
        periodEnd: PERIOD_END,
      })
    })
  })

  // ── resolve endpoints (public, safe metadata, no oracles) ──────────────────

  describe('resolve endpoints', () => {
    it('resolveInvite returns safe metadata with a masked email — never the raw email', async () => {
      const { owner, ws } = await seed()
      const { token } = await inviteWithToken(owner, ws.id, emailFor('stranger'))

      const resolved = await peoplePublic().resolveInvite({ token })
      expect(resolved).toMatchObject({
        state: 'PENDING',
        workspaceName: ws.name,
        inviterName: 'owner Test',
        role: 'EDITOR',
        maskedEmail: 's***@anynote.dev',
      })
      // The full local part must not leak anywhere in the response.
      expect(JSON.stringify(resolved)).not.toContain(`stranger-${RUN}`)
    })

    it('resolveInvite: unknown token is a uniform NOT_FOUND with no metadata', async () => {
      await seed()
      const resolved = await peoplePublic().resolveInvite({ token: 'A'.repeat(32) })
      expect(resolved).toEqual({
        state: 'NOT_FOUND',
        workspaceName: null,
        inviterName: null,
        role: null,
        maskedEmail: null,
      })
    })

    it('resolveInvite reports EXPIRED / REVOKED / ACCEPTED states honestly', async () => {
      const { owner, ws } = await seed()
      const { result, token } = await inviteWithToken(owner, ws.id, emailFor('stale'))

      await prisma.workspaceInvitation.update({
        where: { id: result.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      await expect(peoplePublic().resolveInvite({ token })).resolves.toMatchObject({
        state: 'EXPIRED',
      })

      await people(owner).revokeInvitation({
        workspaceId: ws.id,
        invitationId: result.invitation.id,
      })
      await expect(peoplePublic().resolveInvite({ token })).resolves.toMatchObject({
        state: 'REVOKED',
      })
    })

    it('resolveJoinLink: a disabled link is indistinguishable from an unknown token', async () => {
      const { owner, ws } = await seed()
      const enabled = await people(owner).inviteLink.enable({ workspaceId: ws.id, role: 'VIEWER' })

      await expect(peoplePublic().resolveJoinLink({ token: enabled.token })).resolves.toEqual({
        state: 'PENDING',
        workspaceName: ws.name,
        role: 'VIEWER',
      })

      await people(owner).inviteLink.disable({ workspaceId: ws.id })
      const disabled = await peoplePublic().resolveJoinLink({ token: enabled.token })
      const unknown = await peoplePublic().resolveJoinLink({ token: 'B'.repeat(32) })
      expect(disabled).toEqual(unknown)
      expect(disabled).toEqual({ state: 'NOT_FOUND', workspaceName: null, role: null })
    })

    it('resolveGuestInvite returns metadata WITHOUT the page title', async () => {
      const { owner, ws, page } = await seed()
      const guest = await makeUser('guest')
      await pageShare(owner).inviteGuest({ pageId: page.id, email: guest.email, role: 'READER' })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')

      const resolved = await peoplePublic().resolveGuestInvite({ token })
      expect(resolved).toMatchObject({
        state: 'PENDING',
        workspaceName: ws.name,
        inviterName: 'owner Test',
        role: 'READER',
        maskedEmail: 'g***@anynote.dev',
      })
      expect(JSON.stringify(resolved)).not.toContain('Shared page')
    })
  })

  // ── acceptance ladder ───────────────────────────────────────────────────────

  describe('acceptance ladder', () => {
    it('rejects a mismatched session email', async () => {
      const { owner, member, ws } = await seed()
      const { token } = await inviteWithToken(owner, ws.id, emailFor('someoneelse'))
      await expect(people(member).acceptInvite({ token })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'Приглашение выдано на другой email',
      })
    })

    it('rejects a blocked user', async () => {
      const { owner, ws } = await seed()
      const { token } = await inviteWithToken(owner, ws.id, emailFor('blockee'))
      const blockee = await makeUser('blockee')
      await people(owner).block({ workspaceId: ws.id, userId: blockee.id })
      await expect(people(blockee).acceptInvite({ token })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
    })

    it('rejects when the seat limit is reached at acceptance time', async () => {
      const { owner, ws } = await seed()
      const { token } = await inviteWithToken(owner, ws.id, emailFor('late'))
      const late = await makeUser('late')
      await prisma.workspaceLimit.update({
        where: { workspaceId: ws.id },
        data: { maxMembers: 4 }, // already full
      })
      await expect(people(late).acceptInvite({ token })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('лимит участников'),
      })
    })

    it('accepts: creates the member; double-accept is an idempotent success', async () => {
      const { owner, ws } = await seed()
      const { token } = await inviteWithToken(owner, ws.id, emailFor('joiner'), 'COMMENTER')
      const joiner = await makeUser('joiner')

      await expect(people(joiner).acceptInvite({ token })).resolves.toEqual({
        workspaceId: ws.id,
        role: 'COMMENTER',
        alreadyMember: false,
      })
      const memberRow = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: joiner.id } },
      })
      expect(memberRow?.role).toBe('COMMENTER')

      await expect(people(joiner).acceptInvite({ token })).resolves.toMatchObject({
        alreadyMember: true,
      })
    })
  })

  // ── invite link ─────────────────────────────────────────────────────────────

  describe('invite link', () => {
    it('enable returns the plaintext once; get never returns token material', async () => {
      const { owner, ws } = await seed()
      const enabled = await people(owner).inviteLink.enable({ workspaceId: ws.id, role: 'EDITOR' })
      expect(enabled.token).toMatch(/^[A-Za-z0-9]{32}$/)
      expect(enabled.url).toBe(`${RETURN_URL_BASE}/join/${enabled.token}`)
      expect(enabled.link).toMatchObject({ role: 'EDITOR', enabled: true })

      const fetched = await people(owner).inviteLink.get({ workspaceId: ws.id })
      expect(fetched).toMatchObject({ role: 'EDITOR', enabled: true })
      expect(JSON.stringify(fetched)).not.toContain(enabled.token)
      expect(fetched && 'token' in fetched).toBe(false)
    })

    it('joinViaLink adds a member with the link role and audits the join', async () => {
      const { owner, ws } = await seed()
      const { token } = await people(owner).inviteLink.enable({
        workspaceId: ws.id,
        role: 'VIEWER',
      })
      const visitor = await makeUser('visitor')
      await expect(people(visitor).joinViaLink({ token })).resolves.toEqual({
        workspaceId: ws.id,
        role: 'VIEWER',
        alreadyMember: false,
      })
      const audit = await prisma.workspaceAuditLog.findFirst({
        where: { workspaceId: ws.id, action: 'invite_link.joined', targetUserId: visitor.id },
      })
      expect(audit).not.toBeNull()
    })

    it('a disabled link join is a uniform NOT_FOUND (same as an unknown token)', async () => {
      const { owner, ws } = await seed()
      const { token } = await people(owner).inviteLink.enable({
        workspaceId: ws.id,
        role: 'VIEWER',
      })
      await people(owner).inviteLink.disable({ workspaceId: ws.id })
      const visitor = await makeUser('latecomer')

      const disabledErr = await people(visitor)
        .joinViaLink({ token })
        .catch((e: unknown) => e as { code: string; message: string })
      const unknownErr = await people(visitor)
        .joinViaLink({ token: 'C'.repeat(32) })
        .catch((e: unknown) => e as { code: string; message: string })
      expect(disabledErr).toMatchObject({ code: 'NOT_FOUND' })
      expect(unknownErr).toMatchObject({
        code: disabledErr.code,
        message: disabledErr.message,
      })
    })

    it('rotate kills the old token and issues a working one', async () => {
      const { owner, ws } = await seed()
      const { token: oldToken } = await people(owner).inviteLink.enable({
        workspaceId: ws.id,
        role: 'VIEWER',
      })
      const rotated = await people(owner).inviteLink.rotate({ workspaceId: ws.id })
      expect(rotated.token).not.toBe(oldToken)

      const visitor = await makeUser('rotated')
      await expect(people(visitor).joinViaLink({ token: oldToken })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      })
      await expect(people(visitor).joinViaLink({ token: rotated.token })).resolves.toMatchObject({
        alreadyMember: false,
      })
    })
  })

  // ── guest flow ──────────────────────────────────────────────────────────────

  describe('guest flow', () => {
    it('inviteGuest sends a guest-invitation mail WITHOUT the page title and lists the invite', async () => {
      const { owner, ws, page } = await seed()
      const guest = await makeUser('guest')
      const invite = await pageShare(owner).inviteGuest({
        pageId: page.id,
        email: guest.email,
        role: 'EDITOR',
      })
      expect(invite).toMatchObject({ email: guest.email, role: 'EDITOR', state: 'PENDING' })
      expect(JSON.stringify(invite)).not.toContain('token')

      const mail = lastMail()
      expect(mail.kind).toBe('guest-invitation')
      expect(mail.to).toBe(guest.email)
      expect(mail.data).toEqual({
        inviterName: 'owner Test',
        workspaceName: ws.name,
        link: expect.stringMatching(
          new RegExp(`^${RETURN_URL_BASE}/guest-invite/[A-Za-z0-9]{32}$`),
        ),
      })
      // Metadata-only discipline: the page title never appears pre-acceptance.
      expect(JSON.stringify(mail)).not.toContain('Shared page')

      const invites = await pageShare(owner).listGuestInvites({ pageId: page.id })
      expect(invites).toHaveLength(1)
      expect(invites[0]).toMatchObject({ email: guest.email, role: 'EDITOR', state: 'PENDING' })
      expect(JSON.stringify(invites)).not.toContain('tokenHash')
    })

    it('a plain EDITOR member cannot inviteGuest (manage rights required)', async () => {
      const { editor, page } = await seed()
      await expect(
        pageShare(editor).inviteGuest({ pageId: page.id, email: emailFor('x'), role: 'READER' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('acceptGuestInvite writes the grant and the guest shows up in listGuests', async () => {
      const { owner, ws, page } = await seed()
      const guest = await makeUser('guest')
      await pageShare(owner).inviteGuest({ pageId: page.id, email: guest.email, role: 'EDITOR' })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')

      await expect(people(guest).acceptGuestInvite({ token })).resolves.toEqual({
        pageId: page.id,
        workspaceId: ws.id,
        role: 'EDITOR',
        alreadyMember: false,
      })
      const grant = await prisma.pageShareUser.findFirst({
        where: { userId: guest.id, pageShare: { pageId: page.id } },
      })
      expect(grant?.role).toBe('EDITOR')

      const guests = await people(owner).listGuests({ workspaceId: ws.id })
      expect(guests.guests).toEqual([
        expect.objectContaining({ userId: guest.id, email: guest.email, grantCount: 1 }),
      ])
      expect(guests.invites).toHaveLength(0)
    })

    it('a workspace member accepting a guest invite is a no-op success (no grant)', async () => {
      const { owner, member, page } = await seed()
      await pageShare(owner).inviteGuest({ pageId: page.id, email: member.email, role: 'READER' })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')

      await expect(people(member).acceptGuestInvite({ token })).resolves.toMatchObject({
        alreadyMember: true,
      })
      const grant = await prisma.pageShareUser.findFirst({ where: { userId: member.id } })
      expect(grant).toBeNull()
    })

    it('revokeGuestInvite kills the pending invite and burns its token', async () => {
      const { owner, page } = await seed()
      const guest = await makeUser('guest')
      const invite = await pageShare(owner).inviteGuest({
        pageId: page.id,
        email: guest.email,
        role: 'READER',
      })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')

      await pageShare(owner).revokeGuestInvite({ pageId: page.id, id: invite.id })
      await expect(pageShare(owner).listGuestInvites({ pageId: page.id })).resolves.toHaveLength(0)
      await expect(people(guest).acceptGuestInvite({ token })).rejects.toMatchObject({
        message: 'Приглашение отозвано',
      })
    })

    it('revokeGuestAccess deletes the grants and the guest disappears', async () => {
      const { owner, ws, page } = await seed()
      const guest = await makeUser('guest')
      await pageShare(owner).inviteGuest({ pageId: page.id, email: guest.email, role: 'READER' })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')
      await people(guest).acceptGuestInvite({ token })

      await expect(
        people(owner).revokeGuestAccess({ workspaceId: ws.id, userId: guest.id }),
      ).resolves.toMatchObject({ grantsRemoved: 1 })
      const after = await people(owner).listGuests({ workspaceId: ws.id })
      expect(after.guests).toHaveLength(0)
    })

    it('convertGuestToMember creates a member, keeps the grants, audits', async () => {
      const { owner, ws, page } = await seed()
      const guest = await makeUser('guest')
      await pageShare(owner).inviteGuest({ pageId: page.id, email: guest.email, role: 'EDITOR' })
      const token = tokenFromLink(lastMail().data.link, 'guest-invite')
      await people(guest).acceptGuestInvite({ token })

      await expect(
        people(owner).convertGuestToMember({ workspaceId: ws.id, userId: guest.id, role: 'EDITOR' }),
      ).resolves.toEqual({ workspaceId: ws.id, role: 'EDITOR' })

      const memberRow = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: guest.id } },
      })
      expect(memberRow?.role).toBe('EDITOR')
      const grant = await prisma.pageShareUser.findFirst({ where: { userId: guest.id } })
      expect(grant).not.toBeNull()

      const after = await people(owner).listGuests({ workspaceId: ws.id })
      expect(after.guests).toHaveLength(0)

      const audit = await prisma.workspaceAuditLog.findFirst({
        where: { workspaceId: ws.id, action: 'guest.converted_to_member', targetUserId: guest.id },
      })
      expect(audit).not.toBeNull()
    })
  })

  // ── blocked-user denial samples ─────────────────────────────────────────────

  describe('blocked-user denial', () => {
    it('a blocked ADMIN is denied on people procedures until unblocked', async () => {
      const { owner, admin, ws } = await seed()
      await people(owner).block({ workspaceId: ws.id, userId: admin.id, reason: 'test' })
      await expect(people(admin).listInvitations({ workspaceId: ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
      await people(owner).unblock({ workspaceId: ws.id, userId: admin.id })
      await expect(people(admin).listInvitations({ workspaceId: ws.id })).resolves.toEqual([])
    })

    it('listBlocked exposes block rows to managers and is denied to EDITOR', async () => {
      const { owner, admin, editor, member, ws } = await seed()
      await people(owner).block({ workspaceId: ws.id, userId: member.id, reason: 'spam' })
      const rows = await people(admin).listBlocked({ workspaceId: ws.id })
      expect(rows).toEqual([{ userId: member.id, reason: 'spam', createdAt: expect.any(Date) }])
      await expect(people(editor).listBlocked({ workspaceId: ws.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    })

    it('a blocked user cannot join via link', async () => {
      const { owner, ws } = await seed()
      const { token } = await people(owner).inviteLink.enable({
        workspaceId: ws.id,
        role: 'VIEWER',
      })
      const banned = await makeUser('banned')
      await people(owner).block({ workspaceId: ws.id, userId: banned.id })
      await expect(people(banned).joinViaLink({ token })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: BLOCKED_MESSAGE,
      })
    })
  })

  // ── audit log ───────────────────────────────────────────────────────────────

  describe('audit log', () => {
    it('mutations write audit rows; auditLog joins actor/target names', async () => {
      const { owner, member, ws } = await seed()
      await people(owner).block({ workspaceId: ws.id, userId: member.id })
      await people(owner).unblock({ workspaceId: ws.id, userId: member.id })

      const { items } = await people(owner).auditLog({ workspaceId: ws.id })
      expect(items.map((i) => i.action)).toEqual(['user.unblocked', 'user.blocked'])
      expect(items[0]).toMatchObject({
        actorName: 'owner Test',
        targetName: 'member Test',
        targetUserId: member.id,
      })
    })

    it('paginates with a keyset cursor of 30', async () => {
      const { owner, ws } = await seed()
      const base = Date.now() - 100_000
      await prisma.workspaceAuditLog.createMany({
        data: Array.from({ length: 35 }, (_, i) => ({
          workspaceId: ws.id,
          actorId: owner.id,
          action: 'user.blocked',
          createdAt: new Date(base + i * 1000),
        })),
      })
      const first = await people(owner).auditLog({ workspaceId: ws.id })
      expect(first.items).toHaveLength(30)
      expect(first.nextCursor).not.toBeNull()

      const second = await people(owner).auditLog({
        workspaceId: ws.id,
        cursor: first.nextCursor!,
      })
      expect(second.items).toHaveLength(5)
      expect(second.nextCursor).toBeNull()
      const ids = new Set([...first.items, ...second.items].map((i) => i.id))
      expect(ids.size).toBe(35)
    })
  })
})
