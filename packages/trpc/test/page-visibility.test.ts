import { describe, it, expect, beforeEach } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'

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
