import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { syncedBlockRouter } from '../src/routers/synced-block'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-9C synced-block router. Self-contained
// (creates its own users / workspaces / collections / pages / blocks inline) so
// it passes on a fresh CI DB without seed data. Requires `docker compose up -d`.
//
// THE security proof: a foreign PERSONAL-origin block must return 'no_access'
// from getById (never the content), and a block in a workspace the caller does
// not belong to must also be 'no_access'. create / unsyncAll / delete are
// origin-page-edit-gated.

const EMAIL_SUFFIX = '+synced-block-router-test@anynote.dev'

async function cleanFixtures() {
  await prisma.syncedBlock.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
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

function caller(userId: string) {
  return createCallerFactory(syncedBlockRouter)({
    prisma,
    user: {
      id: userId,
      email: 'x',
      firstName: 'T',
      lastName: 'U',
      emailVerified: true,
    } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

const DOC = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

// Grant a named PageShareUser role to a NON-member user on `pageId` (the guest
// arm). Mirrors the share-grant fixture in guest-access.test.ts.
async function grantOn(pageId: string, userId: string, role: 'READER' | 'COMMENTER' | 'EDITOR') {
  const share = await prisma.pageShare.upsert({
    where: { pageId },
    create: { pageId, shareId: `sb-${pageId.slice(0, 8)}-${userId.slice(0, 8)}` },
    update: {},
    select: { id: true },
  })
  await prisma.pageShareUser.create({ data: { pageShareId: share.id, userId, role } })
}

// Seed: a workspace with an OWNER (U1), a plain EDITOR member (U2), and a plain
// VIEWER member (U3). A TEAM collection + a TEAM page everyone can edit/read per
// role. A PERSONAL collection owned by U1 with a PERSONAL page only U1 can see.
async function seed() {
  const owner = await makeUser('owner')
  const editor = await makeUser('editor')
  const viewer = await makeUser('viewer')
  const ws = await prisma.workspace.create({
    data: { name: 'SyncedWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
      { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const teamPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Team page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  const ownerPersonal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      ownerId: owner.id,
      title: 'Личное (owner)',
    },
    select: { id: true },
  })
  const personalPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: ownerPersonal.id,
      type: 'TEXT',
      title: 'Owner personal page',
      createdById: owner.id,
    },
    select: { id: true },
  })
  return {
    wsId: ws.id,
    ownerId: owner.id,
    editorId: editor.id,
    viewerId: viewer.id,
    teamPageId: teamPage.id,
    personalPageId: personalPage.id,
  }
}

// A second workspace + user, isolated from the first — used to prove
// cross-workspace blocks never leak.
async function seedOther() {
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({
    data: { name: 'OtherWS', createdById: stranger.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: stranger.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее (other)' },
    select: { id: true },
  })
  const page = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Other page',
      createdById: stranger.id,
    },
    select: { id: true },
  })
  return { wsId: ws.id, strangerId: stranger.id, pageId: page.id }
}

describe('syncedBlock router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  // ── create ────────────────────────────────────────────────────────────────
  it('create on a TEAM origin page by an EDITOR seeds content + returns a blockId', async () => {
    const fx = await seed()
    const res = await caller(fx.editorId).create({
      originPageId: fx.teamPageId,
      content: DOC('hello'),
    })
    expect(res.id).toBeTruthy()
    const row = await prisma.syncedBlock.findUnique({ where: { id: res.id } })
    expect(row?.workspaceId).toBe(fx.wsId)
    expect(row?.originPageId).toBe(fx.teamPageId)
    expect(row?.createdById).toBe(fx.editorId)
    expect(row?.content).toEqual(DOC('hello'))
  })

  it('create is FORBIDDEN for a VIEWER (no edit access to the origin page)', async () => {
    const fx = await seed()
    await expect(
      caller(fx.viewerId).create({ originPageId: fx.teamPageId, content: DOC('x') }),
    ).rejects.toThrow(/прав/i)
  })

  it('create is NOT_FOUND when the caller is not a workspace member', async () => {
    const fx = await seed()
    const other = await seedOther()
    await expect(
      caller(other.strangerId).create({ originPageId: fx.teamPageId, content: DOC('x') }),
    ).rejects.toThrow(/Страница не найдена/)
  })

  it('create is NOT_FOUND against a TRASHED origin page (active-edit-gated)', async () => {
    const fx = await seed()
    await prisma.page.update({
      where: { id: fx.teamPageId },
      data: { deletedAt: new Date() },
    })
    await expect(
      caller(fx.ownerId).create({ originPageId: fx.teamPageId, content: DOC('x') }),
    ).rejects.toThrow(/Страница не найдена/)
  })

  // ── getById matrix ──────────────────────────────────────────────────────────
  it("getById → 'ok' with content + originPageId + readOnly:false for an editor", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('live'),
    })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') throw new Error('unreachable')
    expect(res.content).toEqual(DOC('live'))
    expect(res.originPageId).toBe(fx.teamPageId)
    expect(res.readOnly).toBe(false)
  })

  it("getById → 'ok' with readOnly:true for a VIEWER member of the origin page", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('live'),
    })
    const res = await caller(fx.viewerId).getById({ id })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') throw new Error('unreachable')
    expect(res.readOnly).toBe(true)
  })

  it("getById → 'no_access' (NEVER content) for a foreign PERSONAL-origin block", async () => {
    const fx = await seed()
    // The block's origin is the OWNER's PERSONAL page → the EDITOR cannot see it.
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('secret'),
    })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('no_access')
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it("getById → 'no_access' for a caller in a different workspace (no leak)", async () => {
    const fx = await seed()
    const other = await seedOther()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('secret'),
    })
    const res = await caller(other.strangerId).getById({ id })
    expect(res.status).toBe('no_access')
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it("getById → 'deleted' after delete", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('gone'),
    })
    await caller(fx.ownerId).delete({ id })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('deleted')
  })

  it("getById → 'unsynced' WITH content after unsyncAll (so instances inline-detach)", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('inline-me'),
    })
    await caller(fx.ownerId).unsyncAll({ id })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('unsynced')
    if (res.status !== 'unsynced') throw new Error('unreachable')
    expect(res.content).toEqual(DOC('inline-me'))
  })

  // (d) Regression for §7: a member who CAN see the origin still gets the content
  // to inline after unsyncAll — the owner here is the origin creator.
  it("getById → 'unsynced' WITH content for a member who can see the origin (regression §7)", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('still-visible'),
    })
    await caller(fx.ownerId).unsyncAll({ id })
    const res = await caller(fx.ownerId).getById({ id })
    expect(res.status).toBe('unsynced')
    if (res.status !== 'unsynced') throw new Error('unreachable')
    expect(res.content).toEqual(DOC('still-visible'))
  })

  // (a) The confidentiality gap the reviewers found: a block sourced from a
  // FOREIGN PERSONAL origin, then unsyncAll'd, must STILL be 'no_access' (NEVER
  // content) for an EDITOR who cannot see that origin page. Pre-fix this leaked
  // because the unsynced branch returned content gated only by membership.
  it("getById → 'no_access' (NEVER content) for an unsyncAll'd FOREIGN-PERSONAL block", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('secret'),
    })
    await caller(fx.ownerId).unsyncAll({ id })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('no_access')
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  // (b) True orphan: the origin page is removed (SetNull → originPageId null) so
  // there is no origin to prove visibility against. The instance must degrade to
  // a content-LESS placeholder, not leak the secret. The caller is still a
  // workspace member (the cross-workspace backstop is a separate test).
  it("getById → 'unsynced' with NO content for a TRUE ORPHAN (origin gone)", async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('secret'),
    })
    // Simulate origin-page removal: Prisma SetNull on page delete → originPageId null.
    await prisma.syncedBlock.update({ where: { id }, data: { originPageId: null } })
    const res = await caller(fx.editorId).getById({ id })
    expect(res.status).toBe('unsynced')
    if (res.status !== 'unsynced') throw new Error('unreachable')
    expect(res.content).toBeNull()
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  // (c) The dead guest arm, now revived to match yjs canAccessSyncedBlock: a
  // PageShareUser EDITOR grant on the origin page admits a NON-member as a guest,
  // who gets content. The block lives on the OWNER's PERSONAL page (a plain member
  // EDITOR cannot see it) — only the explicit grant lets the guest in.
  it("getById → 'ok' WITH content+readOnly for a PageShareUser EDITOR-grant guest (guest arm live)", async () => {
    const fx = await seed()
    const guest = await makeUser('guest')
    await grantOn(fx.personalPageId, guest.id, 'EDITOR')
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('shared'),
    })
    const res = await caller(guest.id).getById({ id })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') throw new Error('unreachable')
    expect(res.content).toEqual(DOC('shared'))
    expect(res.readOnly).toBe(false)
  })

  // (c′) The same guest after unsyncAll: still served WITH content (the origin is
  // still visible to the guest), matching the §7 inline-detach for legit viewers.
  it("getById → 'unsynced' WITH content for a grant guest after unsyncAll", async () => {
    const fx = await seed()
    const guest = await makeUser('guest')
    await grantOn(fx.personalPageId, guest.id, 'READER')
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('shared-then-unsynced'),
    })
    await caller(fx.ownerId).unsyncAll({ id })
    const res = await caller(guest.id).getById({ id })
    expect(res.status).toBe('unsynced')
    if (res.status !== 'unsynced') throw new Error('unreachable')
    expect(res.content).toEqual(DOC('shared-then-unsynced'))
  })

  it("getById → 'no_access' for an unknown block id (object-hiding)", async () => {
    const fx = await seed()
    const res = await caller(fx.editorId).getById({
      id: '00000000-0000-7000-8000-000000000000',
    })
    expect(res.status).toBe('no_access')
  })

  // ── list ──────────────────────────────────────────────────────────────────
  it('list returns only the workspace blocks the caller can access (origin-filtered)', async () => {
    const fx = await seed()
    const teamBlock = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('team'),
    })
    const personalBlock = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('personal'),
    })

    // The owner can see both (creator of the personal page).
    const ownerList = await caller(fx.ownerId).list({ workspaceId: fx.wsId })
    const ownerIds = ownerList.blocks.map((b) => b.id).sort()
    expect(ownerIds).toEqual([teamBlock.id, personalBlock.id].sort())

    // The EDITOR sees only the TEAM-origin block; the PERSONAL one is filtered.
    const editorList = await caller(fx.editorId).list({ workspaceId: fx.wsId })
    const editorIds = editorList.blocks.map((b) => b.id)
    expect(editorIds).toContain(teamBlock.id)
    expect(editorIds).not.toContain(personalBlock.id)
  })

  it('list is NOT_FOUND/FORBIDDEN for a non-member', async () => {
    const fx = await seed()
    const other = await seedOther()
    await expect(
      caller(other.strangerId).list({ workspaceId: fx.wsId }),
    ).rejects.toThrow(/прав|участник/i)
  })

  // ── unsyncAll ───────────────────────────────────────────────────────────────
  it('unsyncAll marks unsyncedAt while KEEPING originPageId (visibility anchor) and is idempotent', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('x'),
    })
    await caller(fx.ownerId).unsyncAll({ id })
    const after = await prisma.syncedBlock.findUnique({ where: { id } })
    // originPageId is INTENTIONALLY retained — it is the origin-visibility anchor
    // getById's access check still needs (the unsynced content must stay gated by
    // who could see the origin). `unsyncedAt` is the detached signal.
    expect(after?.originPageId).toBe(fx.teamPageId)
    expect(after?.unsyncedAt).not.toBeNull()

    // Idempotent: a second call keeps the same unsyncedAt (does not bump it).
    const firstStamp = after?.unsyncedAt
    await expect(caller(fx.ownerId).unsyncAll({ id })).resolves.toBeTruthy()
    const after2 = await prisma.syncedBlock.findUnique({ where: { id } })
    expect(after2?.originPageId).toBe(fx.teamPageId)
    expect(after2?.unsyncedAt?.getTime()).toBe(firstStamp?.getTime())
  })

  it('unsyncAll is FORBIDDEN for a VIEWER (origin-edit-gated)', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('x'),
    })
    await expect(caller(fx.viewerId).unsyncAll({ id })).rejects.toThrow(/прав/i)
  })

  // SHOULD-FIX 3: the edit gate must be VISIBILITY-aware, matching the read gate.
  // The block originates on the OWNER's PERSONAL page (which the workspace EDITOR
  // cannot SEE). The EDITOR has the workspace EDITOR role, so a non-visibility
  // gate (plain assertPageEditAccess) would let them unsync the block anchored on
  // a page they can't read — destructive over-permissiveness. The origin must be
  // both VISIBLE and EDITABLE → an invisible origin is NOT_FOUND.
  it('unsyncAll is NOT_FOUND for a member who cannot SEE a foreign PERSONAL origin', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('secret'),
    })
    await expect(caller(fx.editorId).unsyncAll({ id })).rejects.toThrow(/не найдена|прав/i)
    // The block must NOT have been detached by the denied call.
    const after = await prisma.syncedBlock.findUnique({ where: { id } })
    expect(after?.unsyncedAt).toBeNull()
  })

  it('delete is NOT_FOUND for a member who cannot SEE a foreign PERSONAL origin', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.personalPageId,
      content: DOC('secret'),
    })
    await expect(caller(fx.editorId).delete({ id })).rejects.toThrow(/не найдена|прав/i)
    const after = await prisma.syncedBlock.findUnique({ where: { id } })
    expect(after?.deletedAt).toBeNull()
  })

  // ── delete ──────────────────────────────────────────────────────────────────
  it('delete soft-deletes (deletedAt set) and is idempotent', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('x'),
    })
    await caller(fx.ownerId).delete({ id })
    const after = await prisma.syncedBlock.findUnique({ where: { id } })
    expect(after?.deletedAt).not.toBeNull()

    await expect(caller(fx.ownerId).delete({ id })).resolves.toBeTruthy()
  })

  it('delete is FORBIDDEN for a VIEWER (origin-edit-gated)', async () => {
    const fx = await seed()
    const { id } = await caller(fx.ownerId).create({
      originPageId: fx.teamPageId,
      content: DOC('x'),
    })
    await expect(caller(fx.viewerId).delete({ id })).rejects.toThrow(/прав/i)
  })
})
