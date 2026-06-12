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
import { hashInviteToken } from '@repo/domain'

import { securityRouter } from '../src/routers/security'
import { searchRouter } from '../src/routers/search'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the security router (Phase 8C Task 5): the
// OWNER-only matrix, the audited admin content search through the router (ack
// flow end-to-end), the member-level guest-request surface with owner
// notifications, the approve-path mail (the ONLY disableGuestInvites bypass),
// and the normal-search privacy regression. Email-suffix fixture namespace,
// self-cleaning. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+security-router-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
/** A single-lexeme FTS marker token, unique per run. */
const MARKER = `zq${RUN}`
const RETURN_URL_BASE = 'http://app.test'
const FORBIDDEN_MESSAGE = 'Недостаточно прав'
const WS_NAME = 'SecurityRouterWS'

type FixtureUser = { id: string; email: string; firstName: string | null; lastName: string | null }

async function cleanFixtures() {
  const createdByContains = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const byCreatorWs = { workspace: createdByContains }
  const byUser = { user: { email: { contains: EMAIL_SUFFIX } } }
  await prisma.notificationEvent.deleteMany({ where: byUser }) // in-app rows cascade
  await prisma.userPreference.deleteMany({ where: byUser })
  await prisma.workspaceAuditLog.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInviteRequest.deleteMany({ where: byCreatorWs })
  await prisma.pageGuestInvite.deleteMany({ where: byCreatorWs })
  await prisma.pageShareUser.deleteMany({
    where: { OR: [byUser, { pageShare: { page: byCreatorWs } }] },
  })
  await prisma.pageShare.deleteMany({ where: { page: byCreatorWs } })
  await prisma.searchHistory.deleteMany({ where: byUser })
  await prisma.page.deleteMany({ where: byCreatorWs })
  await prisma.workspaceSecurityPolicy.deleteMany({ where: byCreatorWs })
  await prisma.collection.deleteMany({ where: byCreatorWs })
  await prisma.workspaceLimit.deleteMany({ where: byCreatorWs })
  await prisma.workspaceBlockedUser.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspaceMember.deleteMany({ where: { OR: [byCreatorWs, byUser] } })
  await prisma.workspace.deleteMany({ where: createdByContains })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
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

function ctxFor(user: FixtureUser) {
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
    yookassa: {},
    returnUrlBase: RETURN_URL_BASE,
    jobs: { kick: vi.fn() },
  } as never
}

const security = (u: FixtureUser) => createCallerFactory(securityRouter)(ctxFor(u))
const search = (u: FixtureUser) => createCallerFactory(searchRouter)(ctxFor(u))

/**
 * Two OWNERS (the all-owners notification pin), an ADMIN (the forbidden
 * matrix), an EDITOR member (the requester), a VIEWER (no edit access), and a
 * TEAM page carrying the run-unique FTS marker.
 */
async function seed() {
  const owner = await makeUser('owner')
  const owner2 = await makeUser('owner2')
  const admin = await makeUser('admin')
  const member = await makeUser('member')
  const viewer = await makeUser('viewer')
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
      { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'TEAM', title: 'Команда' },
  })
  const teamPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      title: `Командная страница ${MARKER}`,
      collectionId: team.id,
      createdById: owner.id,
    },
  })
  return { owner, owner2, admin, member, viewer, ws, teamPage }
}

/** A PERSONAL-collection page — invisible to everyone but its owner. */
async function makePersonalPage(workspaceId: string, userId: string, title: string) {
  const personal = await prisma.collection.create({
    data: { workspaceId, kind: 'PERSONAL', title: 'Личное', ownerId: userId },
  })
  return prisma.page.create({
    data: { workspaceId, title, collectionId: personal.id, createdById: userId },
  })
}

/** Opens the request gap: invites OFF, requests ON (the policy combo). */
async function disableInvites(owner: FixtureUser, workspaceId: string) {
  await security(owner).updatePolicy({
    workspaceId,
    patch: { disableGuestInvites: true, allowGuestInviteRequests: true },
  })
}

const guestInvitationMails = () => mailMock.sent.filter((m) => m.kind === 'guest-invitation')

describe('security router', () => {
  beforeEach(async () => {
    await cleanFixtures()
    mailMock.sent.length = 0
  })

  afterAll(async () => {
    await cleanFixtures()
  })

  // ── OWNER matrix: every managed proc is OWNER-only ──────────────────────────

  it('pins ADMIN ⇒ FORBIDDEN on every managed procedure (all 7)', async () => {
    const { admin, ws } = await seed()
    const caller = security(admin)
    const id = randomUUID()
    const managedCalls: Array<[string, () => Promise<unknown>]> = [
      ['getPolicy', () => caller.getPolicy({ workspaceId: ws.id })],
      [
        'updatePolicy',
        () => caller.updatePolicy({ workspaceId: ws.id, patch: { disableExport: true } }),
      ],
      ['acknowledgeContentSearch', () => caller.acknowledgeContentSearch({ workspaceId: ws.id })],
      ['contentSearch', () => caller.contentSearch({ workspaceId: ws.id, query: MARKER })],
      ['listGuestRequests', () => caller.listGuestRequests({ workspaceId: ws.id })],
      ['approveGuestRequest', () => caller.approveGuestRequest({ workspaceId: ws.id, id })],
      ['rejectGuestRequest', () => caller.rejectGuestRequest({ workspaceId: ws.id, id })],
    ]
    // Count-pinned: a new security.* managed procedure MUST be added here.
    expect(managedCalls).toHaveLength(7)
    for (const [name, call] of managedCalls) {
      await expect(call(), `${name} must be OWNER-only`).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: FORBIDDEN_MESSAGE,
      })
    }
  })

  it('contentSearch is FORBIDDEN for member, viewer, and a non-member grant-holder (spec §7.1)', async () => {
    const { owner, member, viewer, ws, teamPage } = await seed()
    await security(owner).acknowledgeContentSearch({ workspaceId: ws.id })

    // A guest: holds a page grant but has NO WorkspaceMember row.
    const guest = await makeUser('guest')
    await prisma.pageShare.create({
      data: { pageId: teamPage.id, shareId: randomUUID(), users: { create: [{ userId: guest.id }] } },
    })

    for (const user of [member, viewer, guest]) {
      await expect(
        security(user).contentSearch({ workspaceId: ws.id, query: MARKER }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE })
    }
  })

  // ── policy surface ───────────────────────────────────────────────────────────

  it('getPolicy returns the zero-value default; updatePolicy patches flags', async () => {
    const { owner, ws } = await seed()
    const caller = security(owner)

    const zero = await caller.getPolicy({ workspaceId: ws.id })
    expect(zero).toMatchObject({
      workspaceId: ws.id,
      disableGuestInvites: false,
      allowGuestInviteRequests: true,
      disablePublicLinksSitesForms: false,
      disableExport: false,
      disableMoveDuplicateOutsideWorkspace: false,
      adminContentSearchAcknowledgedAt: null,
    })
    // No row is lazily created by a read.
    expect(await prisma.workspaceSecurityPolicy.count({ where: { workspaceId: ws.id } })).toBe(0)

    const updated = await caller.updatePolicy({
      workspaceId: ws.id,
      patch: { disableExport: true, disablePublicLinksSitesForms: true },
    })
    expect(updated.disableExport).toBe(true)
    expect(updated.disablePublicLinksSitesForms).toBe(true)
    expect(updated.disableGuestInvites).toBe(false)

    const readBack = await caller.getPolicy({ workspaceId: ws.id })
    expect(readBack).toEqual(updated)
  })

  // ── admin content search through the router (ack flow end-to-end) ───────────

  it('contentSearch: ack-gated, then finds a foreign PERSONAL page and audits the query', async () => {
    const { owner, member, ws } = await seed()
    const secret = await makePersonalPage(ws.id, member.id, `Секретный план ${MARKER}`)
    const caller = security(owner)

    // Before the acknowledgment: SEARCH_ACK_REQUIRED maps to 412.
    await expect(caller.contentSearch({ workspaceId: ws.id, query: MARKER })).rejects.toMatchObject(
      { code: 'PRECONDITION_FAILED' },
    )

    const acked = await caller.acknowledgeContentSearch({ workspaceId: ws.id })
    expect(acked.adminContentSearchAcknowledgedAt).not.toBeNull()
    expect(acked.adminContentSearchAcknowledgedById).toBe(owner.id)

    const result = await caller.contentSearch({ workspaceId: ws.id, query: MARKER })
    expect(result.mode).toBe('fts')
    const row = result.rows.find((r) => r.pageId === secret.id)
    expect(row).toBeDefined()
    expect(row!.audienceState).toBe('private')
    expect(row!.location.collectionKind).toBe('PERSONAL')

    // The audience filter passes through the router.
    const filtered = await caller.contentSearch({
      workspaceId: ws.id,
      query: MARKER,
      audience: 'private',
    })
    expect(filtered.rows.map((r) => r.pageId)).toEqual([secret.id])

    // Every search audited with the VERBATIM query.
    const audits = await prisma.workspaceAuditLog.findMany({
      where: { workspaceId: ws.id, action: 'content_search.performed' },
      orderBy: { createdAt: 'asc' },
    })
    expect(audits).toHaveLength(2)
    expect(audits[0]!.actorId).toBe(owner.id)
    expect(audits[0]!.metadata).toMatchObject({ query: MARKER, mode: 'fts' })
  })

  // ── requestGuestInvite (member-level) ───────────────────────────────────────

  it('requestGuestInvite requires page edit access: VIEWER ⇒ FORBIDDEN, no row', async () => {
    const { owner, viewer, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)

    await expect(
      security(viewer).requestGuestInvite({
        pageId: teamPage.id,
        email: `invitee-${RUN}@external.example`,
        role: 'READER',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Недостаточно прав на редактирование',
    })
    expect(await prisma.pageGuestInviteRequest.count({ where: { workspaceId: ws.id } })).toBe(0)
  })

  it('requestGuestInvite policy combos: invites ON ⇒ pointless; both OFF ⇒ disabled; the gap succeeds', async () => {
    const { owner, member, ws, teamPage } = await seed()
    const invitee = `invitee-${RUN}@external.example`
    const ask = () =>
      security(member).requestGuestInvite({ pageId: teamPage.id, email: invitee, role: 'READER' })

    // Default policy: invites are ENABLED — a request is pointless.
    await expect(ask()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Запрос не требуется — гостевые приглашения доступны напрямую',
    })

    // Invites disabled AND requests disabled.
    await security(owner).updatePolicy({
      workspaceId: ws.id,
      patch: { disableGuestInvites: true, allowGuestInviteRequests: false },
    })
    await expect(ask()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Запросы на гостевой доступ отключены политикой безопасности пространства',
    })

    // The gap the policy opens: invites OFF, requests ON.
    await security(owner).updatePolicy({
      workspaceId: ws.id,
      patch: { allowGuestInviteRequests: true },
    })
    const request = await ask()
    expect(request).toMatchObject({
      pageId: teamPage.id,
      workspaceId: ws.id,
      email: invitee,
      role: 'READER',
      requesterId: member.id,
      status: 'PENDING',
    })
  })

  it('requestGuestInvite notifies EVERY owner (2-owner fixture) and refresh keeps the row', async () => {
    const { owner, owner2, member, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)
    const invitee = `invitee-${RUN}@external.example`

    const request = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: invitee,
      role: 'EDITOR',
    })
    expect(request.status).toBe('PENDING')

    const events = await prisma.notificationEvent.findMany({
      where: { workspaceId: ws.id, type: 'GUEST_INVITE_REQUESTED' },
    })
    expect(events.map((e) => e.userId).sort()).toEqual([owner.id, owner2.id].sort())
    for (const event of events) {
      expect(event.actorId).toBe(member.id)
      expect(event.payload).toMatchObject({
        requesterName: 'member Test',
        pageTitle: teamPage.title,
        workspaceName: WS_NAME,
      })
      expect((event.payload as { link: string }).link).toContain('/settings')
    }
    // IN_APP is the locked channel — one in-app row per owner.
    expect(
      await prisma.notificationInApp.count({ where: { eventId: { in: events.map((e) => e.id) } } }),
    ).toBe(2)

    // Refresh-PENDING: the same row, role updated, owners notified again.
    const again = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: invitee,
      role: 'READER',
    })
    expect(again.id).toBe(request.id)
    expect(again.role).toBe('READER')
    expect(again.requesterId).toBe(member.id)
    expect(
      await prisma.notificationEvent.count({
        where: { workspaceId: ws.id, type: 'GUEST_INVITE_REQUESTED' },
      }),
    ).toBe(4)
    expect(await prisma.pageGuestInviteRequest.count({ where: { workspaceId: ws.id } })).toBe(1)
  })

  // ── approve / reject (the queue) ────────────────────────────────────────────

  it('approveGuestRequest: APPROVED + invite row + the guest-invitation mail with the token link; never the token in the response', async () => {
    const { owner, member, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)
    const invitee = `Invitee-${RUN}@External.example` // mixed case — normalized on store
    const normalized = invitee.toLowerCase()

    const request = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: invitee,
      role: 'COMMENTER',
    })
    expect(guestInvitationMails()).toHaveLength(0) // request ≠ invite — no invitee mail yet

    const result = await security(owner).approveGuestRequest({ workspaceId: ws.id, id: request.id })
    expect(result.request).toMatchObject({
      id: request.id,
      status: 'APPROVED',
      decidedById: owner.id,
    })
    expect(result.request.decidedAt).not.toBeNull()
    expect(result.invite).toMatchObject({
      pageId: teamPage.id,
      email: normalized,
      role: 'COMMENTER',
      inviterId: owner.id,
      state: 'PENDING',
    })

    // The mail block (the pageShare.inviteGuest mirror): metadata-only payload
    // with the /guest-invite/{token} link — the bypass-path invite still mails.
    const sent = guestInvitationMails()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe(normalized)
    expect(sent[0]!.data.inviterName).toBe('owner Test')
    expect(sent[0]!.data.workspaceName).toBe(WS_NAME)
    const link = sent[0]!.data.link as string
    const linkPrefix = `${RETURN_URL_BASE}/guest-invite/`
    expect(link.startsWith(linkPrefix)).toBe(true)
    const token = link.slice(linkPrefix.length)
    expect(token.length).toBeGreaterThan(20)

    // The plaintext token exists ONLY inside the email link: the DB stores the
    // hash, the router response never carries it.
    const inviteRow = await prisma.pageGuestInvite.findFirstOrThrow({
      where: { pageId: teamPage.id, email: normalized },
    })
    expect(inviteRow.tokenHash).toBe(hashInviteToken(token))
    expect(JSON.stringify(result)).not.toContain(token)

    // Double-approve ⇒ CONFLICT (already decided), no second mail.
    await expect(
      security(owner).approveGuestRequest({ workspaceId: ws.id, id: request.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(guestInvitationMails()).toHaveLength(1)
  })

  it('rejectGuestRequest: REJECTED, no invite row, no mail', async () => {
    const { owner, member, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)
    const invitee = `invitee-${RUN}@external.example`

    const request = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: invitee,
      role: 'READER',
    })
    const rejected = await security(owner).rejectGuestRequest({ workspaceId: ws.id, id: request.id })
    expect(rejected).toMatchObject({ id: request.id, status: 'REJECTED', decidedById: owner.id })

    expect(await prisma.pageGuestInvite.count({ where: { pageId: teamPage.id } })).toBe(0)
    expect(guestInvitationMails()).toHaveLength(0)

    // A decided request cannot be approved afterwards.
    await expect(
      security(owner).approveGuestRequest({ workspaceId: ws.id, id: request.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('listGuestRequests returns the queue with requester/page context for OWNER', async () => {
    const { owner, member, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)
    const invitee = `invitee-${RUN}@external.example`
    const request = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: invitee,
      role: 'READER',
    })

    const queue = await security(owner).listGuestRequests({ workspaceId: ws.id })
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      id: request.id,
      status: 'PENDING',
      email: invitee,
      requesterName: 'member',
      requesterEmail: member.email,
      pageTitle: teamPage.title,
    })
  })

  // ── sharingPolicyState (member-level, the share-dialog policy probe) ────────

  it('sharingPolicyState: member-readable two-flag surface tracking the policy; outsider ⇒ NOT_FOUND', async () => {
    const { owner, viewer, ws, teamPage } = await seed()

    // Any member may probe (VIEWER here), zero-value default included.
    const zero = await security(viewer).sharingPolicyState({ pageId: teamPage.id })
    // toEqual pins the MINIMAL surface: exactly these two flags, nothing else
    // of the OWNER-only policy (no export/copy/links flags, no ack fields).
    expect(zero).toEqual({ guestInvitesDisabled: false, guestRequestsAllowed: true })

    await security(owner).updatePolicy({
      workspaceId: ws.id,
      patch: { disableGuestInvites: true, allowGuestInviteRequests: false },
    })
    expect(await security(viewer).sharingPolicyState({ pageId: teamPage.id })).toEqual({
      guestInvitesDisabled: true,
      guestRequestsAllowed: false,
    })

    // Outsider: the object-hiding NOT_FOUND of the page-access contract.
    const outsider = await makeUser('outsider')
    await expect(
      security(outsider).sharingPolicyState({ pageId: teamPage.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  // ── myGuestRequests scoping ─────────────────────────────────────────────────

  it('myGuestRequests is requester-scoped: another member sees nothing', async () => {
    const { owner, member, admin, ws, teamPage } = await seed()
    await disableInvites(owner, ws.id)

    const request = await security(member).requestGuestInvite({
      pageId: teamPage.id,
      email: `invitee-${RUN}@external.example`,
      role: 'READER',
    })

    const mine = await security(member).myGuestRequests({ pageId: teamPage.id })
    expect(mine.map((r) => r.id)).toEqual([request.id])
    expect(mine[0]!.status).toBe('PENDING')

    // Another member with edit access on the page still sees an empty list.
    expect(await security(admin).myGuestRequests({ pageId: teamPage.id })).toEqual([])
  })

  // ── normal-search regression (spec §7.1 — pinned) ──────────────────────────

  it("normal search.search is UNCHANGED by the feature: a foreign private page stays absent before/after the owner's admin search", async () => {
    const { owner, member, ws, teamPage } = await seed()
    // Foreign to the MEMBER: the owner's PERSONAL-collection page.
    const privatePage = await makePersonalPage(ws.id, owner.id, `Тайный план ${MARKER}`)

    const memberSearch = search(member)
    const before = await memberSearch.search({ workspaceId: ws.id, query: MARKER })
    expect(before.map((r) => r.pageId)).toContain(teamPage.id)
    expect(before.map((r) => r.pageId)).not.toContain(privatePage.id) // pin the absence

    // The owner acknowledges and runs the admin search — IT sees the page…
    await security(owner).acknowledgeContentSearch({ workspaceId: ws.id })
    const adminResult = await security(owner).contentSearch({ workspaceId: ws.id, query: MARKER })
    expect(adminResult.rows.map((r) => r.pageId)).toContain(privatePage.id)

    // …but the member's normal search results are byte-identical.
    const after = await memberSearch.search({ workspaceId: ws.id, query: MARKER })
    expect(after).toEqual(before)
    expect(after.map((r) => r.pageId)).not.toContain(privatePage.id)
  })
})
