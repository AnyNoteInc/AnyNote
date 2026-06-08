import { afterAll, describe, it, expect, beforeEach } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'
import { buildPageVisibilityWhere, excludeDatabaseRowPages } from '@repo/domain'

import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

const SUFFIX = '+pagevis-test@anynote.dev'

async function cleanFixtures() {
  // delete pages -> collections -> members -> workspaces -> users for our suffix
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'T',
    },
  })
}

describe('buildPageVisibilityWhere', () => {
  beforeEach(cleanFixtures)

  async function seed() {
    const owner = await makeUser('owner')
    const member = await makeUser('member')
    const ws = await prisma.workspace.create({ data: { name: 'VisWS', createdById: owner.id } })
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
        { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
      ],
    })
    const team = await prisma.collection.create({
      data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    })
    const personal = await prisma.collection.create({
      data: { workspaceId: ws.id, kind: CollectionKind.PERSONAL, ownerId: owner.id, title: 'Личное' },
    })
    const teamPage = await prisma.page.create({
      data: { workspaceId: ws.id, collectionId: team.id, type: 'TEXT', title: 'Team' },
    })
    const privatePage = await prisma.page.create({
      data: { workspaceId: ws.id, collectionId: personal.id, type: 'TEXT', title: 'Private' },
    })
    const sharedPage = await prisma.page.create({
      data: { workspaceId: ws.id, collectionId: personal.id, type: 'TEXT', title: 'Shared' },
    })
    // explicit share of the private 'sharedPage' to member
    const share = await prisma.pageShare.create({
      data: { pageId: sharedPage.id, shareId: `vis-${sharedPage.id.slice(0, 8)}` },
    })
    await prisma.pageShareUser.create({
      data: { pageShareId: share.id, userId: member.id, role: 'READER' },
    })
    return {
      wsId: ws.id,
      ownerId: owner.id,
      memberId: member.id,
      teamPageId: teamPage.id,
      privatePageId: privatePage.id,
      sharedPageId: sharedPage.id,
    }
  }

  it('owner sees team + own private + shared', async () => {
    const ctx = await seed()
    const ids = (
      await prisma.page.findMany({
        where: { workspaceId: ctx.wsId, AND: [buildPageVisibilityWhere(ctx.ownerId)] },
        select: { id: true },
      })
    ).map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([ctx.teamPageId, ctx.privatePageId, ctx.sharedPageId]),
    )
  })

  it('member sees team + shared but NOT owner private', async () => {
    const ctx = await seed()
    const ids = (
      await prisma.page.findMany({
        where: { workspaceId: ctx.wsId, AND: [buildPageVisibilityWhere(ctx.memberId)] },
        select: { id: true },
      })
    ).map((p) => p.id)
    expect(ids).toContain(ctx.teamPageId)
    expect(ids).toContain(ctx.sharedPageId)
    expect(ids).not.toContain(ctx.privatePageId)
  })
})

const DB_SUFFIX = '+dbrowvis-test@anynote.dev'

async function cleanDbFixtures() {
  await prisma.page.deleteMany({
    where: { workspace: { createdBy: { email: { contains: DB_SUFFIX } } } },
  })
  await prisma.collection.deleteMany({
    where: { workspace: { createdBy: { email: { contains: DB_SUFFIX } } } },
  })
  await prisma.workspaceMember.deleteMany({
    where: { workspace: { createdBy: { email: { contains: DB_SUFFIX } } } },
  })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: DB_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: DB_SUFFIX } } })
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

describe('excludeDatabaseRowPages', () => {
  beforeEach(cleanDbFixtures)
  afterAll(cleanDbFixtures)

  // Seed: owner workspace + TEAM collection + a root TEXT page, a DATABASE page,
  // and an item page parented to the DATABASE page (a "database row" page).
  async function seedDb() {
    const owner = await prisma.user.create({
      data: {
        email: `owner${DB_SUFFIX}`,
        emailVerified: true,
        name: 'owner',
        firstName: 'owner',
        lastName: 'T',
      },
    })
    const ws = await prisma.workspace.create({
      data: { name: 'DbVisWS', createdById: owner.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
    })
    const team = await prisma.collection.create({
      data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    })
    const rootPage = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        collectionId: team.id,
        type: 'TEXT',
        title: 'Root',
        createdById: owner.id,
      },
    })
    const databasePage = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        collectionId: team.id,
        type: 'DATABASE',
        title: 'My DB',
        createdById: owner.id,
      },
    })
    const itemPage = await prisma.page.create({
      data: {
        workspaceId: ws.id,
        collectionId: team.id,
        type: 'TEXT',
        title: 'Row item',
        parentId: databasePage.id,
        createdById: owner.id,
      },
    })
    return {
      wsId: ws.id,
      ownerId: owner.id,
      rootPageId: rootPage.id,
      databasePageId: databasePage.id,
      itemPageId: itemPage.id,
    }
  }

  it('predicate excludes a child of a DATABASE page but keeps root pages and DATABASE page itself', async () => {
    const ctx = await seedDb()
    const ids = (
      await prisma.page.findMany({
        where: { workspaceId: ctx.wsId, AND: [excludeDatabaseRowPages()] },
        select: { id: true },
      })
    ).map((p) => p.id)
    expect(ids).toContain(ctx.rootPageId) // parentId null → kept
    expect(ids).toContain(ctx.databasePageId) // parentId null → kept
    expect(ids).not.toContain(ctx.itemPageId) // parent.type === DATABASE → excluded
  })

  it('page.listByWorkspace hides database item pages but keeps roots + the DATABASE page', async () => {
    const ctx = await seedDb()
    const caller = makeCaller(ctx.ownerId)
    const list = await caller.listByWorkspace({ workspaceId: ctx.wsId })
    const ids = list.map((p) => p.id)
    expect(ids).toContain(ctx.rootPageId)
    expect(ids).toContain(ctx.databasePageId)
    expect(ids).not.toContain(ctx.itemPageId)
  })

  it('page.getById can still fetch a database item page directly', async () => {
    const ctx = await seedDb()
    const caller = makeCaller(ctx.ownerId)
    const page = await caller.getById({ id: ctx.itemPageId })
    expect(page.id).toBe(ctx.itemPageId)
    expect(page.parentId).toBe(ctx.databasePageId)
  })
})
