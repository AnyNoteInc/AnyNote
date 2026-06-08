import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'
import { hashSharePassword } from '@repo/domain'

import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for `share.copyToWorkspace` (duplicate-as-template):
// router → ShareAccessService re-validation → domain PublicShareCopyService →
// Prisma. Self-contained: creates its own users, workspaces, collections,
// pages and shares inline so it passes on a fresh CI DB without seed data.
// Requires `docker compose up -d` (postgres) like the other integration tests.

const EMAIL_SUFFIX = '+share-copy-test@anynote.dev'

async function cleanFixtures() {
  await prisma.pageShare.deleteMany({
    where: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
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

function makeCaller(userId: string) {
  return createCallerFactory(pageShareRouter)({
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

let shareIdSeq = 0
function newShareId(): string {
  shareIdSeq += 1
  return `sharecopytest${shareIdSeq}${Date.now().toString(16)}`.padEnd(20, '0')
}

async function createShare(
  pageId: string,
  ownerId: string,
  over: {
    mode?: 'LINK' | 'SITE'
    access?: 'PUBLIC' | 'RESTRICTED'
    allowCopy?: boolean
    publishedAt?: Date | null
    unpublishedAt?: Date | null
    expiresAt?: Date | null
    passwordHash?: string | null
  } = {},
) {
  const shareId = newShareId()
  await prisma.pageShare.create({
    data: {
      pageId,
      shareId,
      createdById: ownerId,
      access: over.access ?? 'PUBLIC',
      mode: over.mode ?? 'SITE',
      allowCopy: over.allowCopy ?? true,
      publishedAt: over.publishedAt === undefined ? new Date() : over.publishedAt,
      unpublishedAt: over.unpublishedAt ?? null,
      expiresAt: over.expiresAt ?? null,
      passwordHash: over.passwordHash ?? null,
    },
  })
  return shareId
}

// Seed a source workspace (owner) with a published, copyable root page plus a
// visible child, an archived child, and a child in another user's PERSONAL
// collection — and a separate target workspace the COPIER belongs to with a
// PERSONAL collection.
async function seed() {
  const owner = await makeUser('owner')
  const other = await makeUser('other')
  const copier = await makeUser('copier')

  // Source workspace + collections.
  const srcWs = await prisma.workspace.create({
    data: { name: 'SourceWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: srcWs.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: srcWs.id, userId: other.id, role: 'EDITOR' },
    ],
  })
  const srcTeam = await prisma.collection.create({
    data: { workspaceId: srcWs.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const otherPersonal = await prisma.collection.create({
    data: {
      workspaceId: srcWs.id,
      kind: CollectionKind.PERSONAL,
      ownerId: other.id,
      title: 'Личное (other)',
    },
    select: { id: true },
  })

  // Target workspace the copier belongs to, with their PERSONAL collection.
  const dstWs = await prisma.workspace.create({
    data: { name: 'TargetWS', createdById: copier.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: dstWs.id, userId: copier.id, role: 'OWNER' },
  })
  const copierPersonal = await prisma.collection.create({
    data: {
      workspaceId: dstWs.id,
      kind: CollectionKind.PERSONAL,
      ownerId: copier.id,
      title: 'Личное (copier)',
    },
    select: { id: true },
  })

  // Root page (TEAM), published + copyable.
  const root = await prisma.page.create({
    data: {
      workspaceId: srcWs.id,
      collectionId: srcTeam.id,
      type: 'TEXT',
      title: 'Public root',
      icon: '🌐',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      contentYjs: Buffer.from([1, 2, 3, 4]),
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  // Visible child (TEAM).
  const visibleChild = await prisma.page.create({
    data: {
      workspaceId: srcWs.id,
      collectionId: srcTeam.id,
      parentId: root.id,
      type: 'TEXT',
      title: 'Visible child',
      content: { type: 'doc', content: [] },
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  // Archived child (must NOT be copied).
  const archivedChild = await prisma.page.create({
    data: {
      workspaceId: srcWs.id,
      collectionId: srcTeam.id,
      parentId: root.id,
      type: 'TEXT',
      title: 'Archived child',
      archivedAt: new Date(),
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  // Child in another user's PERSONAL collection (must NOT be copied).
  const privateChild = await prisma.page.create({
    data: {
      workspaceId: srcWs.id,
      collectionId: otherPersonal.id,
      parentId: root.id,
      type: 'TEXT',
      title: 'Private child',
      createdById: other.id,
      updatedById: other.id,
    },
    select: { id: true },
  })

  return {
    ownerId: owner.id,
    copierId: copier.id,
    srcWsId: srcWs.id,
    dstWsId: dstWs.id,
    copierPersonalId: copierPersonal.id,
    rootId: root.id,
    visibleChildId: visibleChild.id,
    archivedChildId: archivedChild.id,
    privateChildId: privateChild.id,
  }
}

describe('share.copyToWorkspace (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('FORBIDDEN when the share disallows copying', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { allowCopy: false })
    const caller = makeCaller(fx.copierId)

    await expect(
      caller.copyToWorkspace({ shareId, targetWorkspaceId: fx.dstWsId }),
    ).rejects.toThrow(/Копирование/)
  })

  it('FORBIDDEN when the site is unpublished', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      mode: 'SITE',
      allowCopy: true,
      publishedAt: null,
    })
    const caller = makeCaller(fx.copierId)

    await expect(
      caller.copyToWorkspace({ shareId, targetWorkspaceId: fx.dstWsId }),
    ).rejects.toThrow(/Копирование/)
  })

  it('FORBIDDEN when the link share has expired', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      mode: 'LINK',
      access: 'PUBLIC',
      allowCopy: true,
      publishedAt: null,
      expiresAt: new Date(Date.now() - 86400_000),
    })
    const caller = makeCaller(fx.copierId)

    await expect(
      caller.copyToWorkspace({ shareId, targetWorkspaceId: fx.dstWsId }),
    ).rejects.toThrow(/Копирование/)
  })

  it('FORBIDDEN when the caller is not a member of the target workspace', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { allowCopy: true })
    // owner is not a member of the target workspace
    const caller = makeCaller(fx.ownerId)

    await expect(
      caller.copyToWorkspace({ shareId, targetWorkspaceId: fx.dstWsId }),
    ).rejects.toThrow(/участником/)
  })

  // Regression: a password-protected SITE must still be copyable once the
  // visitor supplies the password (previously copyToWorkspace always passed
  // password: undefined, so password-protected sites could never be copied).
  it('FORBIDDEN when a password-protected site is copied without the password', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      allowCopy: true,
      passwordHash: await hashSharePassword('s3cret'),
    })
    const caller = makeCaller(fx.copierId)

    await expect(
      caller.copyToWorkspace({ shareId, targetWorkspaceId: fx.dstWsId }),
    ).rejects.toThrow(/Копирование/)
  })

  it('copies a password-protected site when the correct password is supplied', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      allowCopy: true,
      passwordHash: await hashSharePassword('s3cret'),
    })
    const caller = makeCaller(fx.copierId)

    const res = await caller.copyToWorkspace({
      shareId,
      targetWorkspaceId: fx.dstWsId,
      password: 's3cret',
    })
    expect(res.pageId).toBeTruthy()
    const copied = await prisma.page.findUnique({ where: { id: res.pageId } })
    expect(copied?.workspaceId).toBe(fx.dstWsId)
    expect(copied?.copiedFromShareId).toBe(shareId)
  })

  it('copies the root into the target workspace + default PERSONAL collection with provenance, excluding subtree', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { allowCopy: true })
    const caller = makeCaller(fx.copierId)

    const res = await caller.copyToWorkspace({
      shareId,
      targetWorkspaceId: fx.dstWsId,
      includeSubtree: false,
    })

    const copy = await prisma.page.findUnique({
      where: { id: res.pageId },
      select: {
        workspaceId: true,
        collectionId: true,
        parentId: true,
        title: true,
        icon: true,
        content: true,
        contentYjs: true,
        copiedFromShareId: true,
        copiedFromPageId: true,
        copiedAt: true,
        createdById: true,
      },
    })
    expect(copy).not.toBeNull()
    expect(copy?.workspaceId).toBe(fx.dstWsId)
    expect(copy?.collectionId).toBe(fx.copierPersonalId) // defaulted to PERSONAL
    expect(copy?.parentId).toBeNull()
    expect(copy?.title).toBe('Public root')
    expect(copy?.icon).toBe('🌐')
    expect(copy?.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(copy?.contentYjs).not.toBeNull()
    expect(copy?.copiedFromShareId).toBe(shareId)
    expect(copy?.copiedFromPageId).toBe(fx.rootId)
    expect(copy?.copiedAt).not.toBeNull()
    expect(copy?.createdById).toBe(fx.copierId)

    // includeSubtree:false → exactly one new page in the target workspace.
    const count = await prisma.page.count({ where: { workspaceId: fx.dstWsId } })
    expect(count).toBe(1)
  })

  it('subtree copy includes the visible child but skips archived + other-PERSONAL children', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { allowCopy: true })
    const caller = makeCaller(fx.copierId)

    const res = await caller.copyToWorkspace({
      shareId,
      targetWorkspaceId: fx.dstWsId,
      includeSubtree: true,
    })

    const copies = await prisma.page.findMany({
      where: { workspaceId: fx.dstWsId },
      select: { id: true, parentId: true, title: true, copiedFromPageId: true },
    })

    // Root + visible child only — archived + private children excluded.
    expect(copies).toHaveLength(2)
    const titles = copies.map((c) => c.title).sort()
    expect(titles).toEqual(['Public root', 'Visible child'])

    const rootCopy = copies.find((c) => c.id === res.pageId)
    const childCopy = copies.find((c) => c.title === 'Visible child')
    expect(rootCopy?.parentId).toBeNull()
    // The child copy is re-parented under the copied root.
    expect(childCopy?.parentId).toBe(res.pageId)
    expect(childCopy?.copiedFromPageId).toBe(fx.visibleChildId)

    const copiedSources = copies.map((c) => c.copiedFromPageId)
    expect(copiedSources).not.toContain(fx.archivedChildId)
    expect(copiedSources).not.toContain(fx.privateChildId)
  })

  it('does not copy share grants or comment threads onto the copies', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { allowCopy: true })
    const caller = makeCaller(fx.copierId)

    const res = await caller.copyToWorkspace({
      shareId,
      targetWorkspaceId: fx.dstWsId,
      includeSubtree: true,
    })

    // None of the copied pages have their own PageShare row.
    const shares = await prisma.pageShare.count({
      where: { page: { workspaceId: fx.dstWsId } },
    })
    expect(shares).toBe(0)

    const threads = await prisma.pageCommentThread.count({
      where: { pageId: res.pageId },
    })
    expect(threads).toBe(0)
  })
})
