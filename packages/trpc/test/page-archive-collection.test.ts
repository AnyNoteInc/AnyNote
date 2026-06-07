import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for archive/unarchive + collection-aware create /
// moveToCollection (router → domain → Prisma). Uses an email-suffix fixture
// namespace so it self-cleans. Requires `docker compose up -d` (postgres) and a
// seeded `personal` plan, like the other integration tests in this folder.

const EMAIL_SUFFIX = '+page-archive-collection-test@anynote.dev'

async function cleanFixtures() {
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
  return createCallerFactory(pageRouter)({
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

// Shared seed: owner + EDITOR member, a TEAM collection, the owner's PERSONAL
// collection, and one page sitting in the TEAM collection.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'ArchiveWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const personal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      ownerId: owner.id,
      title: 'Личное',
    },
    select: { id: true },
  })
  const teamPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'TEXT',
      title: 'Team page',
      createdById: owner.id,
      updatedById: owner.id,
    },
    select: { id: true },
  })
  return {
    wsId: ws.id,
    ownerId: owner.id,
    memberId: member.id,
    teamCollectionId: team.id,
    personalCollectionId: personal.id,
    teamPageId: teamPage.id,
  }
}

describe('page archive / unarchive + listArchived (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('archive hides the page from listByWorkspace and stamps archivedAt', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.archive({ id: ctx.teamPageId, workspaceId: ctx.wsId })

    const row = await prisma.page.findUnique({
      where: { id: ctx.teamPageId },
      select: { archivedAt: true },
    })
    expect(row?.archivedAt).not.toBeNull()

    const list = await caller.listByWorkspace({ workspaceId: ctx.wsId })
    expect(list.map((p) => p.id)).not.toContain(ctx.teamPageId)
  })

  it('listArchived contains the archived page', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.archive({ id: ctx.teamPageId, workspaceId: ctx.wsId })

    const archived = await caller.listArchived({ workspaceId: ctx.wsId })
    expect(archived.map((p) => p.id)).toContain(ctx.teamPageId)
  })

  it('unarchive clears archivedAt and restores the page to listByWorkspace', async () => {
    const ctx = await seed()
    const caller = makeCaller(ctx.ownerId)

    await caller.archive({ id: ctx.teamPageId, workspaceId: ctx.wsId })
    await caller.unarchive({ id: ctx.teamPageId, workspaceId: ctx.wsId })

    const row = await prisma.page.findUnique({
      where: { id: ctx.teamPageId },
      select: { archivedAt: true },
    })
    expect(row?.archivedAt).toBeNull()

    const list = await caller.listByWorkspace({ workspaceId: ctx.wsId })
    expect(list.map((p) => p.id)).toContain(ctx.teamPageId)
  })
})
