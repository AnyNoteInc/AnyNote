import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for `page.share.publicTree` — the published-subtree
// query backing the public site navigation. Self-contained fixtures (mirrors
// the share-copy harness): a published SITE root with a visible child, an
// archived child, and a child in another user's PERSONAL collection. The public
// (anonymous) caller must see only the published, non-archived, non-personal
// descendants. Requires `docker compose up -d` (postgres).

const EMAIL_SUFFIX = '+public-tree-test@anynote.dev'

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

// publicTree is a publicProcedure — no real session needed, but the context
// still requires a shape. We pass a throwaway user; the procedure never reads it.
function makeCaller() {
  return createCallerFactory(pageShareRouter)({
    prisma,
    user: null as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

let shareIdSeq = 0
function newShareId(): string {
  shareIdSeq += 1
  return `publictreetest${shareIdSeq}${Date.now().toString(16)}`.padEnd(20, '0')
}

async function createShare(
  pageId: string,
  ownerId: string,
  over: {
    mode?: 'LINK' | 'SITE'
    access?: 'PUBLIC' | 'RESTRICTED'
    publishedAt?: Date | null
    publishSubpages?: boolean
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
      publishedAt: over.publishedAt === undefined ? new Date() : over.publishedAt,
      publishSubpages: over.publishSubpages ?? true,
    },
  })
  return shareId
}

async function seed() {
  const owner = await makeUser('owner')
  const other = await makeUser('other')

  const ws = await prisma.workspace.create({
    data: { name: 'TreeWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const otherPersonal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      ownerId: other.id,
      title: 'Личное (other)',
    },
    select: { id: true },
  })

  const root = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Public root',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  const visibleChild = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      parentId: root.id,
      type: 'TEXT',
      title: 'Visible child',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  const grandchild = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      parentId: visibleChild.id,
      type: 'TEXT',
      title: 'Grandchild',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  const archivedChild = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      parentId: root.id,
      type: 'TEXT',
      title: 'Archived child',
      archivedAt: new Date(),
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  const privateChild = await prisma.page.create({
    data: {
      workspaceId: ws.id,
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
    rootId: root.id,
    visibleChildId: visibleChild.id,
    grandchildId: grandchild.id,
    archivedChildId: archivedChild.id,
    privateChildId: privateChild.id,
  }
}

describe('page.share.publicTree (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('returns the published descendants excluding archived + other-PERSONAL', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId)
    const caller = makeCaller()

    const tree = await caller.publicTree({ shareId })

    expect(tree.rootId).toBe(fx.rootId)
    const ids = tree.nodes.map((n) => n.id).sort()
    expect(ids).toEqual([fx.grandchildId, fx.visibleChildId].sort())
    // Archived + private children never appear.
    expect(ids).not.toContain(fx.archivedChildId)
    expect(ids).not.toContain(fx.privateChildId)
    // Parent links preserved for nesting.
    const grandchild = tree.nodes.find((n) => n.id === fx.grandchildId)
    expect(grandchild?.parentId).toBe(fx.visibleChildId)
  })

  it('returns an empty tree for LINK mode', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      mode: 'LINK',
      access: 'PUBLIC',
      publishedAt: null,
    })
    const caller = makeCaller()

    const tree = await caller.publicTree({ shareId })
    expect(tree.nodes).toEqual([])
  })

  it('returns an empty tree for an unpublished SITE', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, {
      mode: 'SITE',
      publishedAt: null,
    })
    const caller = makeCaller()

    const tree = await caller.publicTree({ shareId })
    expect(tree.rootId).toBeNull()
    expect(tree.nodes).toEqual([])
  })

  it('returns an empty tree when publishSubpages is disabled', async () => {
    const fx = await seed()
    const shareId = await createShare(fx.rootId, fx.ownerId, { publishSubpages: false })
    const caller = makeCaller()

    const tree = await caller.publicTree({ shareId })
    expect(tree.nodes).toEqual([])
  })
})
