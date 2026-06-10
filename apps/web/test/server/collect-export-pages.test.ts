import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { collectExportPages } from '@/server/page-export/bulk/collect-pages'

const EMAIL_SUFFIX = '+export-collect-test@anynote.dev'

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.page.deleteMany({ where })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed() {
  const owner = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'o',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const other = await prisma.user.create({
    data: {
      email: `other${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'x',
      firstName: 'X',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ExpWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: other.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  const otherPersonal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: other.id },
  })
  const mk = (data: Record<string, unknown>) =>
    prisma.page.create({
      data: { workspaceId: ws.id, type: 'TEXT', createdById: owner.id, ...data } as never,
    })
  const teamPage = await mk({ title: 'Team', collectionId: team.id })
  const foreignPersonal = await mk({
    title: 'Secret',
    collectionId: otherPersonal.id,
    createdById: other.id,
  })
  const archived = await mk({ title: 'Archived', collectionId: team.id, archivedAt: new Date() })
  const trashed = await mk({ title: 'Trashed', collectionId: team.id, deletedAt: new Date() })
  const dbPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'DATABASE',
      title: 'DB',
      collectionId: team.id,
      createdById: owner.id,
    },
  })
  const dbRow = await mk({ title: 'Row', parentId: dbPage.id, collectionId: team.id })
  const child = await mk({ title: 'Child', parentId: teamPage.id, collectionId: team.id })
  const hiddenChild = await mk({
    title: 'HiddenChild',
    parentId: teamPage.id,
    collectionId: otherPersonal.id,
    createdById: other.id,
  })
  const grandUnderHidden = await mk({
    title: 'GrandUnderHidden',
    parentId: hiddenChild.id,
    collectionId: team.id,
  })
  return {
    owner,
    ws,
    teamPage,
    foreignPersonal,
    archived,
    trashed,
    dbPage,
    dbRow,
    child,
    hiddenChild,
    grandUnderHidden,
  }
}

describe('collectExportPages', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('workspace scope excludes foreign personal, archived, trashed and database-row pages', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'WORKSPACE',
      scopeId: null,
    })
    const titles = pages.map((p) => p.title)
    expect(titles).toContain('Team')
    expect(titles).toContain('DB') // the DATABASE page itself is exportable
    expect(titles).not.toContain('Secret')
    expect(titles).not.toContain('Archived')
    expect(titles).not.toContain('Trashed')
    expect(titles).not.toContain('Row') // db row pages never enter generic exports
  })

  it('subtree scope prunes the whole branch under an inaccessible page', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'SUBTREE',
      scopeId: f.teamPage.id,
    })
    const titles = pages.map((p) => p.title)
    expect(titles).toEqual(expect.arrayContaining(['Team', 'Child']))
    expect(titles).not.toContain('HiddenChild')
    // The grandchild is itself team-visible, but its parent branch is hidden — pruned.
    expect(titles).not.toContain('GrandUnderHidden')
  })

  it('collection scope returns only that collection', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'COLLECTION',
      scopeId: (
        await prisma.collection.findFirstOrThrow({
          where: { workspaceId: f.ws.id, kind: 'TEAM' },
        })
      ).id,
    })
    expect(pages.map((p) => p.title)).not.toContain('Secret')
  })
})
