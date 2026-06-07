import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { collectionRouter } from '../src/routers/collection'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the collection router `list` procedure
// (router → domain → Prisma). Uses an email-suffix fixture namespace so it
// self-cleans. Requires `docker compose up -d` (postgres) like the other
// integration tests in this folder.

const EMAIL_SUFFIX = '+collection-router-test@anynote.dev'

async function cleanFixtures() {
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

function ctx(userId: string) {
  return {
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
  }
}

// Seed: owner + second member, a workspace, a TEAM collection (ownerId null),
// owner's PERSONAL collection, member's PERSONAL collection.
async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const ws = await prisma.workspace.create({
    data: { name: 'CollectionWS', createdById: owner.id },
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
  const ownerPersonal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      ownerId: owner.id,
      title: 'Личное (owner)',
    },
    select: { id: true },
  })
  const memberPersonal = await prisma.collection.create({
    data: {
      workspaceId: ws.id,
      kind: CollectionKind.PERSONAL,
      ownerId: member.id,
      title: 'Личное (member)',
    },
    select: { id: true },
  })
  return {
    wsId: ws.id,
    ownerId: owner.id,
    memberId: member.id,
    teamCollectionId: team.id,
    ownerPersonalId: ownerPersonal.id,
    memberPersonalId: memberPersonal.id,
  }
}

describe('collection router list (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('list returns the TEAM collection and the actor PERSONAL collection, but not other members private collections', async () => {
    const fx = await seed()
    const caller = createCallerFactory(collectionRouter)(ctx(fx.ownerId))

    const list = await caller.list({ workspaceId: fx.wsId })
    const ids = list.map((c) => c.id)

    expect(ids).toContain(fx.teamCollectionId)
    expect(ids).toContain(fx.ownerPersonalId)
    expect(ids).not.toContain(fx.memberPersonalId)
  })
})
