import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for `listManagedPublicPages` — the workspace-scoped
// list backing the "Manage public pages" settings section. Self-contained:
// creates its own users, workspace and pages inline so it passes on a fresh CI
// DB. Requires `docker compose up -d` (postgres) like the other integration tests.

const EMAIL_SUFFIX = '+list-managed-public-test@anynote.dev'

async function cleanFixtures() {
  await prisma.pageShare.deleteMany({
    where: { page: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.page.deleteMany({
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

async function makePage(opts: {
  workspaceId: string
  createdById: string
  title: string
}) {
  return prisma.page.create({
    data: {
      workspaceId: opts.workspaceId,
      type: 'TEXT',
      title: opts.title,
      createdById: opts.createdById,
      updatedById: opts.createdById,
    },
    select: { id: true },
  })
}

async function makeShare(opts: {
  pageId: string
  createdById: string
  access?: 'RESTRICTED' | 'PUBLIC'
  mode?: 'LINK' | 'SITE'
  publishedAt?: Date | null
  expiresAt?: Date | null
}) {
  return prisma.pageShare.create({
    data: {
      pageId: opts.pageId,
      shareId: `share-${opts.pageId}`,
      createdById: opts.createdById,
      access: opts.access ?? 'PUBLIC',
      mode: opts.mode ?? 'LINK',
      publishedAt: opts.publishedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true, shareId: true },
  })
}

describe('listManagedPublicPages (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('returns the shares for pages in the workspace the caller manages (as OWNER)', async () => {
    const owner = await makeUser('owner')
    const ws = await prisma.workspace.create({
      data: { name: 'WS', createdById: owner.id },
      select: { id: true },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
    })
    const p1 = await makePage({ workspaceId: ws.id, createdById: owner.id, title: 'Public link' })
    const p2 = await makePage({ workspaceId: ws.id, createdById: owner.id, title: 'Published site' })
    // A third page with no share row — must not appear.
    await makePage({ workspaceId: ws.id, createdById: owner.id, title: 'No share' })

    const s1 = await makeShare({ pageId: p1.id, createdById: owner.id })
    const s2 = await makeShare({
      pageId: p2.id,
      createdById: owner.id,
      mode: 'SITE',
      publishedAt: new Date(),
    })

    const rows = await makeCaller(owner.id).listManagedPublicPages({ workspaceId: ws.id })
    const byShareId = new Map(rows.map((r) => [r.shareId, r]))

    expect(rows).toHaveLength(2)
    expect(byShareId.get(s1.shareId)).toMatchObject({
      pageId: p1.id,
      title: 'Public link',
      mode: 'LINK',
      access: 'PUBLIC',
      published: false,
    })
    expect(byShareId.get(s2.shareId)).toMatchObject({
      pageId: p2.id,
      title: 'Published site',
      mode: 'SITE',
      published: true,
    })
  })

  it('an ADMIN sees every managed share; a plain VIEWER sees only their own pages', async () => {
    const owner = await makeUser('owner2')
    const admin = await makeUser('admin2')
    const viewer = await makeUser('viewer2')
    const ws = await prisma.workspace.create({
      data: { name: 'WS2', createdById: owner.id },
      select: { id: true },
    })
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
        { workspaceId: ws.id, userId: admin.id, role: 'ADMIN' },
        { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
      ],
    })

    const ownerPage = await makePage({ workspaceId: ws.id, createdById: owner.id, title: 'Owner' })
    const viewerPage = await makePage({ workspaceId: ws.id, createdById: viewer.id, title: 'Viewer' })
    await makeShare({ pageId: ownerPage.id, createdById: owner.id })
    await makeShare({ pageId: viewerPage.id, createdById: viewer.id })

    // ADMIN manages everything in the workspace.
    const adminRows = await makeCaller(admin.id).listManagedPublicPages({ workspaceId: ws.id })
    expect(adminRows).toHaveLength(2)

    // VIEWER only manages shares on pages they created.
    const viewerRows = await makeCaller(viewer.id).listManagedPublicPages({ workspaceId: ws.id })
    expect(viewerRows.map((r) => r.title)).toEqual(['Viewer'])
  })

  it('throws FORBIDDEN for a non-member', async () => {
    const owner = await makeUser('owner3')
    const stranger = await makeUser('stranger3')
    const ws = await prisma.workspace.create({
      data: { name: 'WS3', createdById: owner.id },
      select: { id: true },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
    })

    await expect(
      makeCaller(stranger.id).listManagedPublicPages({ workspaceId: ws.id }),
    ).rejects.toThrow(/участником/)
  })
})
