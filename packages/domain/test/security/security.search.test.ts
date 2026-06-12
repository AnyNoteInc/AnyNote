import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '@repo/db'

import { createDomain } from '../../src/container.ts'
import { DomainError, isDomainError } from '../../src/shared/errors.ts'
import { buildPageVisibilityWhere } from '../../src/pages/index.ts'
import { SECURITY_AUDIT_ACTIONS, SECURITY_ERROR_CODES } from '../../src/security/index.ts'
import { makeScheduler } from '../helpers.ts'

// Real-DB integration test for the OWNER-only audited admin content search
// (spec §3, Task 3): the acknowledgment gate, the privacy-critical
// no-visibility-filter behaviour, the audience-state matrix, filters, the two
// result modes and their PINNED cursor asymmetry, excerpts, audits, and the
// searchPg exclusion parity. Email-suffix fixture namespace (DISTINCT from the
// sibling security.service suite — the files run in parallel against the
// shared dev Postgres), self-cleaning. Requires `docker compose up -d`.
// All asserts are FIXTURE-SCOPED (per-workspace / per-user) — never global.
//
// Cursor design pinned here:
// - FTS mode is a SINGLE page of rank-ordered top-N: `nextCursor` is ALWAYS
//   null, `hasMore` reports truncation, an input cursor is IGNORED (ts_rank
//   cannot keyset cleanly; sacrificing rank for cursor stability would break
//   the spec's "FTS results" contract).
// - Browse mode keysets on (updatedAt DESC, id DESC). The audience filter is
//   applied post-computation per scanned window, so a page may return fewer
//   than pageSize rows while hasMore=true — but the cursor advances over the
//   RAW window, so no rows are ever skipped.

const EMAIL_SUFFIX = '+security-search-test@anynote.dev'
const RUN = randomUUID().slice(0, 8)
/** A single-lexeme FTS marker token, unique per run. */
const MARKER = `zq${RUN}`

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

/**
 * owner+member are workspace members; `guest` is a grant-holder WITHOUT a
 * WorkspaceMember row (the guest definition). `team` / `personal` collections;
 * the personal one belongs to MEMBER — not the searching owner.
 */
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const guest = await makeUser('guest')
  const ws = await prisma.workspace.create({
    data: { name: 'SearchWS', createdById: owner.id },
  })
  for (const [userId, role] of [
    [owner.id, 'OWNER'],
    [member.id, 'EDITOR'],
  ] as const) {
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId, role } })
  }
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'TEAM', title: 'Команда' },
  })
  const personal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'PERSONAL', title: 'Личное', ownerId: member.id },
  })
  return { owner, member, guest, ws, team, personal }
}

/** The acknowledged state acknowledgeContentSearch produces — direct fixture. */
async function ackPolicy(workspaceId: string, byId: string) {
  await prisma.workspaceSecurityPolicy.create({
    data: {
      workspaceId,
      configuredById: byId,
      adminContentSearchAcknowledgedAt: new Date(),
      adminContentSearchAcknowledgedById: byId,
    },
  })
}

type PageOverrides = Partial<{
  collectionId: string | null
  createdById: string
  updatedById: string
  createdAt: Date
  content: object
  parentId: string
  type: 'TEXT' | 'DATABASE'
  isTemplate: 'WORKSPACE' | 'GLOBAL'
  deletedAt: Date
  archivedAt: Date
}>

async function makePage(workspaceId: string, title: string, overrides: PageOverrides = {}) {
  return prisma.page.create({ data: { workspaceId, title, ...overrides } })
}

/** Bullet-proof updatedAt staging (Prisma's @updatedAt fights explicit values). */
async function setUpdatedAt(pageId: string, at: Date) {
  await prisma.$executeRaw`UPDATE "pages" SET "updated_at" = ${at} WHERE "id" = ${pageId}::uuid`
}

async function makeShare(
  pageId: string,
  data: Partial<{
    access: 'RESTRICTED' | 'PUBLIC'
    mode: 'LINK' | 'SITE'
    publishedAt: Date
    unpublishedAt: Date
    grantUserIds: string[]
  }> = {},
) {
  const { grantUserIds = [], ...share } = data
  return prisma.pageShare.create({
    data: {
      pageId,
      shareId: randomUUID(),
      ...share,
      users: { create: grantUserIds.map((userId) => ({ userId })) },
    },
  })
}

async function makeGuestInvite(
  pageId: string,
  workspaceId: string,
  inviterId: string,
  overrides: Partial<{ revokedAt: Date; acceptedAt: Date }> = {},
) {
  return prisma.pageGuestInvite.create({
    data: {
      pageId,
      workspaceId,
      email: email(`invitee-${randomUUID().slice(0, 6)}`),
      role: 'READER',
      tokenHash: randomUUID().replaceAll('-', ''),
      inviterId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      ...overrides,
    },
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

describe('admin content search', () => {
  beforeEach(cleanFixtures)
  afterAll(async () => {
    await cleanFixtures()
    await prisma.$disconnect()
  })

  // ── acknowledgment ───────────────────────────────────────────────────────────

  describe('acknowledgeContentSearch', () => {
    it('lazy-creates the policy row, sets both ack fields, audits once; re-ack is a no-op without a second audit', async () => {
      const { ws, owner } = await seed()
      const first = await domain.security.acknowledgeContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(first.adminContentSearchAcknowledgedAt).not.toBeNull()
      expect(first.adminContentSearchAcknowledgedById).toBe(owner.id)

      const row = await prisma.workspaceSecurityPolicy.findUniqueOrThrow({
        where: { workspaceId: ws.id },
      })
      expect(row.adminContentSearchAcknowledgedAt).not.toBeNull()
      expect(row.adminContentSearchAcknowledgedById).toBe(owner.id)
      expect(row.configuredById).toBe(owner.id) // lazy create stamps the actor
      // The zero-value flags stay untouched.
      expect(row.disableGuestInvites).toBe(false)
      expect(row.disableExport).toBe(false)

      // PINNED: once acknowledged stays — a re-ack (same or another owner) is a
      // no-op success: timestamp and actor unchanged, NO second audit row.
      const again = await domain.security.acknowledgeContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(again.adminContentSearchAcknowledgedAt).toEqual(first.adminContentSearchAcknowledgedAt)
      expect(again.adminContentSearchAcknowledgedById).toBe(owner.id)

      const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.searchAcknowledged)
      expect(audits).toHaveLength(1)
      expect(audits[0]!.actorId).toBe(owner.id)
    })

    it('on an existing policy row: sets only the ack fields — flags and configuredById untouched', async () => {
      const { ws, owner, member } = await seed()
      await prisma.workspaceSecurityPolicy.create({
        data: { workspaceId: ws.id, configuredById: member.id, disableExport: true },
      })
      const policy = await domain.security.acknowledgeContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
      })
      expect(policy.adminContentSearchAcknowledgedById).toBe(owner.id)
      expect(policy.disableExport).toBe(true)
      const row = await prisma.workspaceSecurityPolicy.findUniqueOrThrow({
        where: { workspaceId: ws.id },
      })
      expect(row.configuredById).toBe(member.id) // ack is not policy configuration
      expect(row.disableExport).toBe(true)
    })
  })

  // ── the ack gate ─────────────────────────────────────────────────────────────

  it('adminContentSearch requires the acknowledgment: SEARCH_ACK_REQUIRED (412), nothing audited', async () => {
    const { ws, owner } = await seed()
    await expectDomainError(
      domain.security.adminContentSearch({ workspaceId: ws.id, actorId: owner.id }),
      SECURITY_ERROR_CODES.SEARCH_ACK_REQUIRED,
      412,
    )
    // A policy row WITHOUT the ack fields gates too.
    await prisma.workspaceSecurityPolicy.create({
      data: { workspaceId: ws.id, configuredById: owner.id, disableExport: true },
    })
    await expectDomainError(
      domain.security.adminContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
        query: MARKER,
      }),
      SECURITY_ERROR_CODES.SEARCH_ACK_REQUIRED,
      412,
    )
    expect(await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.contentSearchPerformed)).toHaveLength(0)
  })

  // ── the privacy-critical case ────────────────────────────────────────────────

  it("PRIVACY-CRITICAL: the owner's search returns ANOTHER user's PERSONAL-collection page that buildPageVisibilityWhere hides", async () => {
    const { ws, owner, member, personal } = await seed()
    await ackPolicy(ws.id, owner.id)
    const secret = await makePage(ws.id, `Секретный план ${MARKER}`, {
      collectionId: personal.id,
      createdById: member.id,
    })

    // The control: the normal visibility predicate over the SAME fixture hides
    // the page from the owner (not the personal-collection owner, no grant).
    const control = await prisma.page.findMany({
      where: {
        workspaceId: ws.id,
        title: { contains: MARKER },
        AND: [buildPageVisibilityWhere(owner.id)],
      },
      select: { id: true },
    })
    expect(control.map((p) => p.id)).not.toContain(secret.id)

    // Admin search is the ONLY new visibility path: the page IS found.
    const result = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
    })
    expect(result.mode).toBe('fts')
    const hit = result.rows.find((r) => r.pageId === secret.id)
    expect(hit).toBeDefined()
    expect(hit!.audienceState).toBe('private')
    expect(hit!.location).toEqual({
      collectionId: personal.id,
      collectionTitle: 'Личное',
      collectionKind: 'PERSONAL',
    })
    expect(hit!.createdBy).toEqual({ id: member.id, name: 'member' })
    expect(hit!.lastEditor).toBeNull() // updatedById never set — the documented approximation
  })

  // ── audience matrix ──────────────────────────────────────────────────────────

  it('audience matrix: private / internal (TEAM, null, member grant) / external (guest grant, pending invite) / public (PUBLIC link, published SITE); first match wins', async () => {
    const { ws, owner, member, guest, team, personal } = await seed()
    await ackPolicy(ws.id, owner.id)
    const inPersonal = { collectionId: personal.id, createdById: member.id }

    const pPrivate = await makePage(ws.id, `private ${MARKER}`, inPersonal)
    const pTeam = await makePage(ws.id, `team ${MARKER}`, {
      collectionId: team.id,
      createdById: owner.id,
      updatedById: member.id,
    })
    const pNull = await makePage(ws.id, `nullcoll ${MARKER}`, { createdById: owner.id })
    const pMemberGrant = await makePage(ws.id, `membergrant ${MARKER}`, inPersonal)
    await makeShare(pMemberGrant.id, { grantUserIds: [owner.id] })
    const pGuestGrant = await makePage(ws.id, `guestgrant ${MARKER}`, inPersonal)
    await makeShare(pGuestGrant.id, { grantUserIds: [guest.id] })
    const pInvite = await makePage(ws.id, `invite ${MARKER}`, inPersonal)
    await makeGuestInvite(pInvite.id, ws.id, owner.id)
    const pRevokedInvite = await makePage(ws.id, `revoked ${MARKER}`, inPersonal)
    await makeGuestInvite(pRevokedInvite.id, ws.id, owner.id, { revokedAt: new Date() })
    const pPublicLink = await makePage(ws.id, `publiclink ${MARKER}`, inPersonal)
    await makeShare(pPublicLink.id, { access: 'PUBLIC', mode: 'LINK' })
    const pSite = await makePage(ws.id, `site ${MARKER}`, inPersonal)
    await makeShare(pSite.id, { mode: 'SITE', publishedAt: new Date() })
    // An unpublished SITE (unpublishedAt after publishedAt) is NOT public.
    const pUnpublished = await makePage(ws.id, `unpub ${MARKER}`, inPersonal)
    await makeShare(pUnpublished.id, {
      mode: 'SITE',
      publishedAt: new Date(Date.now() - 1000),
      unpublishedAt: new Date(),
    })

    const result = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
    })
    const byId = new Map(result.rows.map((r) => [r.pageId, r]))
    expect(byId.get(pPrivate.id)?.audienceState).toBe('private')
    expect(byId.get(pTeam.id)?.audienceState).toBe('internal')
    expect(byId.get(pNull.id)?.audienceState).toBe('internal')
    expect(byId.get(pMemberGrant.id)?.audienceState).toBe('internal')
    expect(byId.get(pGuestGrant.id)?.audienceState).toBe('external')
    expect(byId.get(pInvite.id)?.audienceState).toBe('external')
    expect(byId.get(pRevokedInvite.id)?.audienceState).toBe('private') // revoked invite counts for nothing
    expect(byId.get(pPublicLink.id)?.audienceState).toBe('public')
    expect(byId.get(pSite.id)?.audienceState).toBe('public')
    expect(byId.get(pUnpublished.id)?.audienceState).toBe('private')

    // accessSummary: member-grant vs guest-grant split + active invites + public mode.
    expect(byId.get(pMemberGrant.id)?.accessSummary).toEqual({
      memberGrantCount: 1,
      guestCount: 0,
      activeInviteCount: 0,
      publicMode: null,
    })
    expect(byId.get(pGuestGrant.id)?.accessSummary).toEqual({
      memberGrantCount: 0,
      guestCount: 1,
      activeInviteCount: 0,
      publicMode: null,
    })
    expect(byId.get(pInvite.id)?.accessSummary).toMatchObject({ activeInviteCount: 1 })
    expect(byId.get(pPublicLink.id)?.accessSummary).toMatchObject({ publicMode: 'LINK' })
    expect(byId.get(pSite.id)?.accessSummary).toMatchObject({ publicMode: 'SITE' })
    expect(byId.get(pTeam.id)?.lastEditor).toEqual({ id: member.id, name: 'member' })

    // The audience filter narrows post-computation; resultCount audits the
    // FILTERED count (what the owner actually saw).
    const external = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      audience: 'external',
    })
    expect(external.rows.map((r) => r.pageId).sort()).toEqual([pGuestGrant.id, pInvite.id].sort())
    const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.contentSearchPerformed)
    expect(audits).toHaveLength(2)
    expect(audits[1]!.metadata).toMatchObject({ resultCount: 2 })
  })

  // ── filters ──────────────────────────────────────────────────────────────────

  it('creatorId and createdFrom/createdTo narrow both modes', async () => {
    const { ws, owner, member, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    const jan = new Date('2026-01-10T00:00:00.000Z')
    const mar = new Date('2026-03-10T00:00:00.000Z')
    const byOwnerJan = await makePage(ws.id, `ownerdoc ${MARKER}`, {
      collectionId: team.id,
      createdById: owner.id,
      createdAt: jan,
    })
    const byMemberMar = await makePage(ws.id, `memberdoc ${MARKER}`, {
      collectionId: team.id,
      createdById: member.id,
      createdAt: mar,
    })

    const byCreator = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      creatorId: member.id,
    })
    expect(byCreator.rows.map((r) => r.pageId)).toEqual([byMemberMar.id])

    const byDate = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      createdFrom: new Date('2026-02-01T00:00:00.000Z'),
    })
    expect(byDate.rows.map((r) => r.pageId)).toEqual([byMemberMar.id])

    // Browse mode (no query) applies the same filters.
    const browse = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      creatorId: owner.id,
      createdTo: new Date('2026-02-01T00:00:00.000Z'),
    })
    expect(browse.mode).toBe('browse')
    expect(browse.rows.map((r) => r.pageId)).toEqual([byOwnerJan.id])
  })

  // ── browse mode keyset ───────────────────────────────────────────────────────

  it('browse mode keysets on (updatedAt desc, id desc): stable two-page walk, no overlap, exhaustion; null excerpts', async () => {
    const { ws, owner, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    const base = Date.parse('2026-05-01T00:00:00.000Z')
    const ids: string[] = []
    for (let i = 0; i < 5; i += 1) {
      const page = await makePage(ws.id, `browse-${i}`, { collectionId: team.id })
      await setUpdatedAt(page.id, new Date(base + i * 60_000))
      ids.push(page.id)
    }
    const expected = [...ids].reverse() // updatedAt desc

    const page1 = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      pageSize: 2,
    })
    expect(page1.mode).toBe('browse')
    expect(page1.rows.map((r) => r.pageId)).toEqual(expected.slice(0, 2))
    expect(page1.rows.every((r) => r.excerpt === null)).toBe(true) // browse mode: no excerpt
    expect(page1.hasMore).toBe(true)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      pageSize: 2,
      cursor: page1.nextCursor!,
    })
    expect(page2.rows.map((r) => r.pageId)).toEqual(expected.slice(2, 4))
    expect(page2.hasMore).toBe(true)

    const page3 = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      pageSize: 2,
      cursor: page2.nextCursor!,
    })
    expect(page3.rows.map((r) => r.pageId)).toEqual(expected.slice(4))
    expect(page3.hasMore).toBe(false)
    expect(page3.nextCursor).toBeNull()
  })

  it('rejects a malformed cursor with BAD_REQUEST', async () => {
    const { ws, owner } = await seed()
    await ackPolicy(ws.id, owner.id)
    await expectDomainError(
      domain.security.adminContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
        cursor: 'not-a-cursor',
      }),
      'BAD_REQUEST',
      400,
    )
  })

  // ── FTS mode top-N (the pinned asymmetry) ────────────────────────────────────

  it('FTS mode is a single top-N page: hasMore on truncation, nextCursor ALWAYS null, an input cursor is ignored', async () => {
    const { ws, owner, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    for (let i = 0; i < 4; i += 1) {
      await makePage(ws.id, `ftsdoc-${i} ${MARKER}`, { collectionId: team.id })
    }
    const result = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      pageSize: 3,
    })
    expect(result.mode).toBe('fts')
    expect(result.rows).toHaveLength(3)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeNull() // PINNED: rank order is not keyset-pageable

    // An input cursor does not change FTS results (it is browse-mode-only).
    const withCursor = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      pageSize: 3,
      cursor: 'garbage-the-fts-path-never-parses',
    })
    expect(withCursor.rows.map((r) => r.pageId)).toEqual(result.rows.map((r) => r.pageId))

    const all = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
      pageSize: 30,
    })
    expect(all.rows).toHaveLength(4)
    expect(all.hasMore).toBe(false)
  })

  // ── excerpts ─────────────────────────────────────────────────────────────────

  it('FTS computes the first-matching-block excerpt over the content snapshot; a title-only match has a null excerpt', async () => {
    const { ws, owner, member, personal } = await seed()
    await ackPolicy(ws.id, owner.id)
    const contentHit = await makePage(ws.id, 'Заметки без маркера в заголовке', {
      collectionId: personal.id,
      createdById: member.id,
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Первый абзац без совпадения' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `до текста ${MARKER} после текста` }],
          },
        ],
      },
    })
    const titleHit = await makePage(ws.id, `Только заголовок ${MARKER}`, {
      collectionId: personal.id,
      createdById: member.id,
    })

    const result = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
    })
    const byId = new Map(result.rows.map((r) => [r.pageId, r]))
    const excerpt = byId.get(contentHit.id)?.excerpt
    expect(excerpt).toBeTruthy()
    expect(excerpt).toContain(MARKER)
    expect(excerpt).toContain('до текста')
    expect(byId.get(titleHit.id)?.excerpt).toBeNull()
  })

  // ── audit ────────────────────────────────────────────────────────────────────

  it('every search audits content_search.performed with the VERBATIM query, filters, mode and resultCount', async () => {
    const { ws, owner, member, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    await makePage(ws.id, `auditdoc ${MARKER}`, { collectionId: team.id, createdById: member.id })

    const rawQuery = `  ${MARKER} отчёт  `
    const createdFrom = new Date('2026-01-01T00:00:00.000Z')
    const createdTo = new Date('2026-12-31T00:00:00.000Z')
    const fts = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: rawQuery,
      creatorId: member.id,
      createdFrom,
      createdTo,
      audience: 'internal',
    })
    await domain.security.adminContentSearch({ workspaceId: ws.id, actorId: owner.id })

    const audits = await auditRows(ws.id, SECURITY_AUDIT_ACTIONS.contentSearchPerformed)
    expect(audits).toHaveLength(2)
    expect(audits[0]!.actorId).toBe(owner.id)
    // The QUERY is audited verbatim — that is the point (spec §2).
    expect(audits[0]!.metadata).toEqual({
      query: rawQuery,
      filters: {
        creatorId: member.id,
        createdFrom: createdFrom.toISOString(),
        createdTo: createdTo.toISOString(),
        audience: 'internal',
      },
      resultCount: fts.rows.length,
      mode: 'fts',
    })
    expect(audits[1]!.metadata).toEqual({
      query: null,
      filters: { creatorId: null, createdFrom: null, createdTo: null, audience: null },
      resultCount: 1,
      mode: 'browse',
    })
  })

  // ── exclusions (searchPg parity) + workspace scope ───────────────────────────

  it('excludes deleted/archived/template/database-row pages in both modes; other workspaces never leak', async () => {
    const { ws, owner, member, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    const kept = await makePage(ws.id, `kept ${MARKER}`, { collectionId: team.id })
    const deleted = await makePage(ws.id, `deleted ${MARKER}`, {
      collectionId: team.id,
      deletedAt: new Date(),
    })
    const archived = await makePage(ws.id, `archived ${MARKER}`, {
      collectionId: team.id,
      archivedAt: new Date(),
    })
    const template = await makePage(ws.id, `template ${MARKER}`, {
      collectionId: team.id,
      isTemplate: 'WORKSPACE',
    })
    const database = await makePage(ws.id, 'База данных', {
      collectionId: team.id,
      type: 'DATABASE',
    })
    const dbRow = await makePage(ws.id, `dbrow ${MARKER}`, {
      collectionId: team.id,
      parentId: database.id,
    })
    // A marker page in a FOREIGN workspace (same run, different workspace).
    const otherWs = await prisma.workspace.create({
      data: { name: 'OtherWS', createdById: member.id },
    })
    const foreign = await makePage(otherWs.id, `foreign ${MARKER}`, {})

    const excluded = [deleted.id, archived.id, template.id, dbRow.id, foreign.id]

    const fts = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      query: MARKER,
    })
    expect(fts.rows.map((r) => r.pageId)).toContain(kept.id)
    for (const id of excluded) expect(fts.rows.map((r) => r.pageId)).not.toContain(id)

    const browse = await domain.security.adminContentSearch({
      workspaceId: ws.id,
      actorId: owner.id,
      pageSize: 100,
    })
    const browseIds = browse.rows.map((r) => r.pageId)
    expect(browseIds).toContain(kept.id)
    expect(browseIds).toContain(database.id) // DATABASE pages themselves stay listed
    for (const id of excluded) expect(browseIds).not.toContain(id)
  })

  // ── mode detection ───────────────────────────────────────────────────────────

  it('a missing, blank, or sub-2-char query falls back to browse mode (mirrors normal-search normalization)', async () => {
    const { ws, owner, team } = await seed()
    await ackPolicy(ws.id, owner.id)
    await makePage(ws.id, 'Просто страница', { collectionId: team.id })

    for (const query of [undefined, '', '   ', 'z']) {
      const result = await domain.security.adminContentSearch({
        workspaceId: ws.id,
        actorId: owner.id,
        query,
      })
      expect(result.mode).toBe('browse')
      expect(result.rows).toHaveLength(1)
    }
  })
})
