import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the database router rows + cells flow. Asserts that
// createRow materializes a real item Page (child of the DATABASE page), updateRow
// writes Page.title, updateCellValue round-trips + validates, and reorderRows
// reorders. Rows are read via the paginated, view-aware `listRows` (returns
// `{ rows, nextCursor }`) — `getByPage` is schema-only. Self-cleaning via an
// email-suffix namespace.

const EMAIL_SUFFIX = '+database-rows-test@anynote.dev'

async function cleanFixtures() {
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

async function seed() {
  const owner = await makeUser('owner')
  const viewer = await makeUser('viewer')
  const ws = await prisma.workspace.create({
    data: { name: 'DatabaseRowsWS', createdById: owner.id },
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
  await domainSvc.database.seedDefaults(dbPage.id, ws.id, 'My Database')
  return { wsId: ws.id, ownerId: owner.id, viewerId: viewer.id, pageId: dbPage.id }
}

describe('database router rows + cells (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('createRow materializes a real item Page parented to the DATABASE page', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const { rowId, pageId } = await c.createRow({ pageId: fx.pageId })
    expect(rowId).toBeTruthy()
    expect(pageId).toBeTruthy()

    // The item page is a real child Page of the DATABASE page.
    const itemPage = await prisma.page.findUnique({
      where: { id: pageId },
      select: { id: true, parentId: true, type: true, workspaceId: true, deletedAt: true },
    })
    expect(itemPage).not.toBeNull()
    expect(itemPage?.parentId).toBe(fx.pageId)
    expect(itemPage?.type).toBe('TEXT')
    expect(itemPage?.workspaceId).toBe(fx.wsId)
    expect(itemPage?.deletedAt).toBeNull()

    // And it shows up in the view-aware row list.
    const { rows } = await c.listRows({ pageId: fx.pageId })
    expect(rows.map((r) => r.rowId)).toContain(rowId)
  })

  it('createRow with title + updateRow write Page.title', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const { rowId, pageId } = await c.createRow({ pageId: fx.pageId, title: 'First' })
    let page = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } })
    expect(page?.title).toBe('First')

    await c.updateRow({ pageId: fx.pageId, rowId, title: 'Renamed' })
    page = await prisma.page.findUnique({ where: { id: pageId }, select: { title: true } })
    expect(page?.title).toBe('Renamed')
  })

  it('deleteRow soft-deletes row + item page; restoreRow restores both', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const { rowId, pageId } = await c.createRow({ pageId: fx.pageId, title: 'Temp' })

    await c.deleteRow({ pageId: fx.pageId, rowId })
    let page = await prisma.page.findUnique({ where: { id: pageId }, select: { deletedAt: true } })
    expect(page?.deletedAt).not.toBeNull()
    let listed = await c.listRows({ pageId: fx.pageId })
    expect(listed.rows.map((r) => r.rowId)).not.toContain(rowId)

    await c.restoreRow({ pageId: fx.pageId, rowId })
    page = await prisma.page.findUnique({ where: { id: pageId }, select: { deletedAt: true } })
    expect(page?.deletedAt).toBeNull()
    listed = await c.listRows({ pageId: fx.pageId })
    expect(listed.rows.map((r) => r.rowId)).toContain(rowId)
  })

  it('updateCellValue round-trips a valid STATUS option and rejects an unknown one', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const { rowId } = await c.createRow({ pageId: fx.pageId })
    const status = (await c.listProperties({ pageId: fx.pageId })).find((p) => p.type === 'STATUS')!
    const optionId = status.settings!.options![0]!.id

    await c.updateCellValue({ pageId: fx.pageId, rowId, propertyId: status.id, value: optionId })
    const { rows } = await c.listRows({ pageId: fx.pageId })
    const row = rows.find((r) => r.rowId === rowId)!
    expect(row.cells[status.id]).toBe(optionId)

    await expect(
      c.updateCellValue({ pageId: fx.pageId, rowId, propertyId: status.id, value: 'no-such-option' }),
    ).rejects.toThrow(/вариант/i)
  })

  it('updateCellValue rejects a non-number for a NUMBER property', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const { rowId } = await c.createRow({ pageId: fx.pageId })
    const num = await c.createProperty({ pageId: fx.pageId, type: 'NUMBER', name: 'Count' })

    await c.updateCellValue({ pageId: fx.pageId, rowId, propertyId: num.id, value: 42 })
    let listed = await c.listRows({ pageId: fx.pageId })
    expect(listed.rows.find((r) => r.rowId === rowId)?.cells[num.id]).toBe(42)

    await expect(
      c.updateCellValue({ pageId: fx.pageId, rowId, propertyId: num.id, value: 'not-a-number' }),
    ).rejects.toThrow(/число/i)
    // The valid value is unchanged after the rejected write.
    listed = await c.listRows({ pageId: fx.pageId })
    expect(listed.rows.find((r) => r.rowId === rowId)?.cells[num.id]).toBe(42)
  })

  // Row search by `query` was superseded by view filters (see database-views.test.ts).
  // listRows now returns every row of the default view as `{ rows, nextCursor }`.
  it('listRows returns all rows of the default view', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    await c.createRow({ pageId: fx.pageId, title: 'Apple' })
    await c.createRow({ pageId: fx.pageId, title: 'Banana' })

    const { rows, nextCursor } = await c.listRows({ pageId: fx.pageId })
    expect(rows.map((r) => r.title).sort()).toEqual(['Apple', 'Banana'])
    expect(nextCursor).toBeNull()
  })

  it('reorderRows reorders by position', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const r1 = await c.createRow({ pageId: fx.pageId, title: 'One' })
    const r2 = await c.createRow({ pageId: fx.pageId, title: 'Two' })

    await c.reorderRows({ pageId: fx.pageId, orderedIds: [r2.rowId, r1.rowId] })
    const { rows } = await c.listRows({ pageId: fx.pageId })
    expect(rows.map((r) => r.rowId)).toEqual([r2.rowId, r1.rowId])
  })

  it('a VIEWER member cannot create a row', async () => {
    const fx = await seed()
    await expect(
      caller(fx.viewerId).createRow({ pageId: fx.pageId, title: 'X' }),
    ).rejects.toThrow(/прав/i)
  })
})
