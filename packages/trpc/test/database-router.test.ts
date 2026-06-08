import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the database router (router → domain → Prisma).
// Self-cleaning via an email-suffix fixture namespace. Requires
// `docker compose up -d` (postgres) like the other integration tests here, plus
// the additive database_* tables that the Phase-3 migration provides.
//
// Access semantics note: the router guards (assertPageAccess / assertPageEditAccess)
// run before the domain. A *non-member* hits the workspace-member filter and gets
// NOT_FOUND ("не найдена"), matching the kanban-board convention; a *member without
// edit rights* (VIEWER) gets FORBIDDEN on writes.

const EMAIL_SUFFIX = '+database-router-test@anynote.dev'

async function cleanFixtures() {
  // database_* rows + item pages cascade off the page/workspace tree; deleting
  // pages (which cascades sources/views/properties/rows/cells via FK) then the
  // workspace + users is enough for a clean slate.
  await prisma.databaseCellValue.deleteMany({
    where: { property: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } } },
  })
  await prisma.databaseRow.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseProperty.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseView.deleteMany({
    where: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.databaseSource.deleteMany({
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
  return createCallerFactory(databaseRouter)({
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

// Seed: owner (OWNER) + viewer (VIEWER) + outsider (not a member). A workspace, a
// TEAM collection, and a DATABASE page provisioned via the domain seedDefaults
// (one TABLE view "Таблица" + one STATUS property "Статус").
async function seed() {
  const owner = await makeUser('owner')
  const viewer = await makeUser('viewer')
  const outsider = await makeUser('outsider')
  const ws = await prisma.workspace.create({
    data: { name: 'DatabaseWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const dbPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'DATABASE',
      title: 'My Database',
      createdById: owner.id,
    },
    select: { id: true },
  })
  // Provision the source the same way DATABASE page-create would.
  await domainSvc.database.seedDefaults(dbPage.id, ws.id, 'My Database')

  return {
    wsId: ws.id,
    ownerId: owner.id,
    viewerId: viewer.id,
    outsiderId: outsider.id,
    pageId: dbPage.id,
  }
}

describe('database router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('getByPage returns source + views + properties + rows + systemTitleProperty', async () => {
    const fx = await seed()
    const vm = await caller(fx.ownerId).getByPage({ pageId: fx.pageId })

    expect(vm.source.pageId).toBe(fx.pageId)
    expect(vm.source.title).toBe('My Database')
    expect(vm.views).toHaveLength(1)
    expect(vm.views[0]?.type).toBe('TABLE')
    expect(vm.views[0]?.title).toBe('Таблица')
    expect(vm.properties).toHaveLength(1)
    expect(vm.properties[0]?.type).toBe('STATUS')
    expect(vm.properties[0]?.name).toBe('Статус')
    expect(vm.properties[0]?.settings?.options).toHaveLength(3)
    expect(vm.rows).toEqual([])
    expect(vm.systemTitleProperty).toEqual({ key: 'title', name: 'Название' })
  })

  it('listViews returns the seeded view', async () => {
    const fx = await seed()
    const views = await caller(fx.ownerId).listViews({ pageId: fx.pageId })
    expect(views).toHaveLength(1)
    expect(views[0]?.title).toBe('Таблица')
  })

  it('createView / updateView / deleteView round-trip', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const created = await c.createView({ pageId: fx.pageId, title: 'Board 2' })
    expect(created.title).toBe('Board 2')
    let views = await c.listViews({ pageId: fx.pageId })
    expect(views).toHaveLength(2)

    await c.updateView({ pageId: fx.pageId, id: created.id, title: 'Renamed' })
    views = await c.listViews({ pageId: fx.pageId })
    expect(views.find((v) => v.id === created.id)?.title).toBe('Renamed')

    await c.deleteView({ pageId: fx.pageId, id: created.id })
    views = await c.listViews({ pageId: fx.pageId })
    expect(views).toHaveLength(1)
  })

  it('cannot delete the last remaining view', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const views = await c.listViews({ pageId: fx.pageId })
    await expect(
      c.deleteView({ pageId: fx.pageId, id: views[0]!.id }),
    ).rejects.toThrow(/единственное/i)
  })

  it('createProperty / updateProperty / deleteProperty', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const prop = await c.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'Notes' })
    expect(prop.name).toBe('Notes')
    expect(prop.type).toBe('TEXT')

    let props = await c.listProperties({ pageId: fx.pageId })
    expect(props.map((p) => p.name)).toContain('Notes')

    await c.updateProperty({ pageId: fx.pageId, id: prop.id, name: 'Заметки' })
    props = await c.listProperties({ pageId: fx.pageId })
    expect(props.find((p) => p.id === prop.id)?.name).toBe('Заметки')

    await c.deleteProperty({ pageId: fx.pageId, id: prop.id })
    props = await c.listProperties({ pageId: fx.pageId })
    expect(props.map((p) => p.id)).not.toContain(prop.id)
  })

  it('reorderProperties reorders by position', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const a = await c.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'A' })
    const b = await c.createProperty({ pageId: fx.pageId, type: 'NUMBER', name: 'B' })
    // Seeded STATUS prop is also present; reorder all three with B first.
    const status = (await c.listProperties({ pageId: fx.pageId })).find((p) => p.type === 'STATUS')!
    await c.reorderProperties({ pageId: fx.pageId, orderedIds: [b.id, a.id, status.id] })
    const props = await c.listProperties({ pageId: fx.pageId })
    expect(props.map((p) => p.id)).toEqual([b.id, a.id, status.id])
  })

  it('non-member is denied (NOT_FOUND) on read and write', async () => {
    const fx = await seed()
    const c = caller(fx.outsiderId)
    await expect(c.getByPage({ pageId: fx.pageId })).rejects.toThrow(/не найдена/i)
    await expect(
      c.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'X' }),
    ).rejects.toThrow(/не найдена/i)
  })

  it('member without edit rights (VIEWER) is FORBIDDEN on writes but can read', async () => {
    const fx = await seed()
    const c = caller(fx.viewerId)
    // Read is allowed for any workspace member.
    const vm = await c.getByPage({ pageId: fx.pageId })
    expect(vm.source.pageId).toBe(fx.pageId)
    // Writes are rejected.
    await expect(
      c.createProperty({ pageId: fx.pageId, type: 'TEXT', name: 'X' }),
    ).rejects.toThrow(/прав/i)
  })
})
