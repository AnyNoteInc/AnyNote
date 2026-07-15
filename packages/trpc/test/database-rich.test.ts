import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-4B rich-property surface:
//  - setRelationLinks links rows + the source row's view-model (listRows) shows
//    the RELATION chip; a back-relation mirror appears on the target source's row;
//  - listLinkableRows returns the target source's rows (+ a query filter);
//  - a ROLLUP (count_all over a relation) shows the count in the view-model;
//  - a FORMULA property shows the computed value in the view-model;
//  - validateFormula is parse-only (valid `concat("a","b")`, invalid `1 +`);
//  - updateCellValue: a FILE cell with a bogus fileId → NOT_FOUND (tRPC existence
//    check); a PERSON cell with a non-member userId → BAD_REQUEST (domain); a
//    FORMULA cell write → BAD_REQUEST (read-only, domain).
//
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.
// The shared dev DB already has the relation-link table + the new enum values.

const EMAIL_SUFFIX = '+database-rich-test@anynote.dev'

async function cleanFixtures() {
  await prisma.databaseRelationLink.deleteMany({
    where: { property: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } } },
  })
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
  await prisma.file.deleteMany({
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

async function makeDatabasePage(wsId: string, collectionId: string, ownerId: string, title: string) {
  const page = await prisma.page.create({
    data: {
      workspaceId: wsId,
      collectionId,
      type: 'DATABASE',
      title,
      createdById: ownerId,
    },
    select: { id: true },
  })
  await domainSvc.database.seedDefaults(page.id, wsId, title)
  return page.id
}

// Seed: an OWNER, a workspace, a TEAM collection, and a primary DATABASE page (A).
async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: 'DatabaseRichWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
    select: { id: true },
  })
  const pageA = await makeDatabasePage(ws.id, team.id, owner.id, 'База A')
  return { wsId: ws.id, ownerId: owner.id, teamId: team.id, pageA }
}

describe('database rich-property router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('setRelationLinks links rows → the source row shows a RELATION chip + a back-relation mirror appears on the target', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const pageB = await makeDatabasePage(fx.wsId, fx.teamId, fx.ownerId, 'База B')
    const sourceA = (await c.getByPage({ pageId: fx.pageA })).source
    const sourceB = (await c.getByPage({ pageId: pageB })).source

    // A row in each source.
    const rowA = await c.createRow({ pageId: fx.pageA, title: 'A1' })
    const rowB = await c.createRow({ pageId: pageB, title: 'B1' })

    // A RELATION property on B pointing back to A (the back-relation target).
    const backRel = await c.createProperty({
      pageId: pageB,
      type: 'RELATION',
      name: 'Из A',
      settings: { relation: { targetSourceId: sourceA.id } },
    })
    // A RELATION property on A → B, mirrored by backRel on B.
    const rel = await c.createProperty({
      pageId: fx.pageA,
      type: 'RELATION',
      name: 'В B',
      settings: { relation: { targetSourceId: sourceB.id, backRelationPropertyId: backRel.id } },
    })

    await c.setRelationLinks({
      pageId: fx.pageA,
      rowId: rowA.rowId,
      propertyId: rel.id,
      targetRowIds: [rowB.rowId],
    })

    // Source A's row shows the chip for B1.
    const aRows = (await c.listRows({ pageId: fx.pageA })).rows
    const aChips = aRows.find((r) => r.rowId === rowA.rowId)?.cells[rel.id] as Array<{
      rowId: string
      title: string | null
    }>
    expect(aChips).toHaveLength(1)
    expect(aChips[0]?.rowId).toBe(rowB.rowId)
    expect(aChips[0]?.title).toBe('B1')

    // The back-relation mirror: source B's row now shows A1 in the backRel cell.
    const bRows = (await c.listRows({ pageId: pageB })).rows
    const bChips = bRows.find((r) => r.rowId === rowB.rowId)?.cells[backRel.id] as Array<{
      rowId: string
      title: string | null
    }>
    expect(bChips).toHaveLength(1)
    expect(bChips[0]?.rowId).toBe(rowA.rowId)
    expect(bChips[0]?.title).toBe('A1')
  })

  it('listLinkableRows returns the target source rows and honors a query filter', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const pageB = await makeDatabasePage(fx.wsId, fx.teamId, fx.ownerId, 'База B')
    const sourceB = (await c.getByPage({ pageId: pageB })).source

    await c.createRow({ pageId: pageB, title: 'Apricot' })
    await c.createRow({ pageId: pageB, title: 'Banana' })

    const rel = await c.createProperty({
      pageId: fx.pageA,
      type: 'RELATION',
      name: 'В B',
      settings: { relation: { targetSourceId: sourceB.id } },
    })

    const all = await c.listLinkableRows({ pageId: fx.pageA, propertyId: rel.id })
    expect(all.map((r) => r.title).sort()).toEqual(['Apricot', 'Banana'])

    const filtered = await c.listLinkableRows({ pageId: fx.pageA, propertyId: rel.id, query: 'ban' })
    expect(filtered.map((r) => r.title)).toEqual(['Banana'])
  })

  it('a ROLLUP (count_all over a relation) shows the linked count in the view-model', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const pageB = await makeDatabasePage(fx.wsId, fx.teamId, fx.ownerId, 'База B')
    const sourceB = (await c.getByPage({ pageId: pageB })).source

    const rowA = await c.createRow({ pageId: fx.pageA, title: 'A1' })
    const b1 = await c.createRow({ pageId: pageB, title: 'B1' })
    const b2 = await c.createRow({ pageId: pageB, title: 'B2' })

    const rel = await c.createProperty({
      pageId: fx.pageA,
      type: 'RELATION',
      name: 'В B',
      settings: { relation: { targetSourceId: sourceB.id } },
    })
    const rollup = await c.createProperty({
      pageId: fx.pageA,
      type: 'ROLLUP',
      name: 'Сколько',
      settings: {
        rollup: { relationPropertyId: rel.id, targetPropertyId: '__title__', aggregation: 'count_all' },
      },
    })

    await c.setRelationLinks({
      pageId: fx.pageA,
      rowId: rowA.rowId,
      propertyId: rel.id,
      targetRowIds: [b1.rowId, b2.rowId],
    })

    const aRows = (await c.listRows({ pageId: fx.pageA })).rows
    const cellVal = aRows.find((r) => r.rowId === rowA.rowId)?.cells[rollup.id]
    expect(cellVal).toBe(2)
  })

  it('a FORMULA property shows the computed value in the view-model', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)

    const num = await c.createProperty({ pageId: fx.pageA, type: 'NUMBER', name: 'Сумма' })
    const formula = await c.createProperty({
      pageId: fx.pageA,
      type: 'FORMULA',
      name: 'Удвоено',
      settings: { formula: 'prop("Сумма") * 2' },
    })

    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })
    await c.updateCellValue({ pageId: fx.pageA, rowId: row.rowId, propertyId: num.id, value: 21 })

    const rows = (await c.listRows({ pageId: fx.pageA })).rows
    expect(rows.find((r) => r.rowId === row.rowId)?.cells[formula.id]).toBe(42)
  })

  it('validateFormula returns valid for a parseable formula and invalid for a syntax error', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)

    expect(await c.validateFormula({ expression: 'concat("a","b")' })).toEqual({ valid: true })

    const bad = await c.validateFormula({ expression: '1 +' })
    expect(bad.valid).toBe(false)
    if (!bad.valid) expect(typeof bad.error).toBe('string')
  })

  it('updateCellValue on a FILE cell rejects a missing file id with NOT_FOUND', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const file = await c.createProperty({ pageId: fx.pageA, type: 'FILE', name: 'Вложение' })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })

    await expect(
      c.updateCellValue({
        pageId: fx.pageA,
        rowId: row.rowId,
        propertyId: file.id,
        // A well-formed but non-existent file id.
        value: ['00000000-0000-7000-8000-000000000000'],
      }),
    ).rejects.toThrow(/Файл не найден/i)
  })

  it('updateCellValue on a FILE cell accepts two workspace files in stable order', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const file = await c.createProperty({ pageId: fx.pageA, type: 'FILE', name: 'Вложение' })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })

    const [firstFile, secondFile] = await Promise.all([
      prisma.file.create({
        data: {
          userId: fx.ownerId, workspaceId: fx.wsId, name: 'first.pdf', ext: 'pdf',
          fileSize: BigInt(10), mimeType: 'application/pdf', hash: 'h1', path: 'p1',
        },
        select: { id: true },
      }),
      prisma.file.create({
        data: {
          userId: fx.ownerId, workspaceId: fx.wsId, name: 'second.pdf', ext: 'pdf',
          fileSize: BigInt(20), mimeType: 'application/pdf', hash: 'h2', path: 'p2',
        },
        select: { id: true },
      }),
    ])

    await c.updateCellValue({
      pageId: fx.pageA,
      rowId: row.rowId,
      propertyId: file.id,
      value: [secondFile.id, firstFile.id],
    })

    const rows = (await c.listRows({ pageId: fx.pageA })).rows
    expect(rows.find((r) => r.rowId === row.rowId)?.cells[file.id]).toEqual([
      secondFile.id,
      firstFile.id,
    ])
  })

  it('updateCellValue on a FILE cell rejects duplicates, scalars, and non-string items', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const file = await c.createProperty({ pageId: fx.pageA, type: 'FILE', name: 'Вложение' })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })
    const realFile = await prisma.file.create({
      data: {
        userId: fx.ownerId, workspaceId: fx.wsId, name: 'doc.pdf', ext: 'pdf',
        fileSize: BigInt(10), mimeType: 'application/pdf', hash: 'h', path: 'p',
      },
      select: { id: true },
    })

    await expect(
      c.updateCellValue({
        pageId: fx.pageA, rowId: row.rowId, propertyId: file.id,
        value: [realFile.id, realFile.id],
      }),
    ).rejects.toThrow(/не должны повторяться/i)
    await expect(
      c.updateCellValue({
        pageId: fx.pageA, rowId: row.rowId, propertyId: file.id, value: realFile.id,
      }),
    ).rejects.toThrow(/список файлов/i)
    await expect(
      c.updateCellValue({
        pageId: fx.pageA, rowId: row.rowId, propertyId: file.id, value: [realFile.id, 42],
      }),
    ).rejects.toThrow(/список файлов/i)
  })

  it('updateCellValue on a FILE cell rejects a file from another workspace', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const file = await c.createProperty({ pageId: fx.pageA, type: 'FILE', name: 'Вложение' })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })
    const otherWorkspace = await prisma.workspace.create({
      data: { name: 'Other workspace', createdById: fx.ownerId },
      select: { id: true },
    })
    const foreignFile = await prisma.file.create({
      data: {
        userId: fx.ownerId, workspaceId: otherWorkspace.id, name: 'foreign.pdf', ext: 'pdf',
        fileSize: BigInt(10), mimeType: 'application/pdf', hash: 'foreign', path: 'foreign',
      },
      select: { id: true },
    })

    await expect(
      c.updateCellValue({
        pageId: fx.pageA, rowId: row.rowId, propertyId: file.id, value: [foreignFile.id],
      }),
    ).rejects.toThrow(/Файл не найден/i)
  })

  it('updateCellValue on a PERSON cell rejects a non-member userId (BAD_REQUEST from domain)', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const person = await c.createProperty({ pageId: fx.pageA, type: 'PERSON', name: 'Ответственный' })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })
    const outsider = await makeUser('outsider')

    await expect(
      c.updateCellValue({
        pageId: fx.pageA,
        rowId: row.rowId,
        propertyId: person.id,
        value: outsider.id,
      }),
    ).rejects.toThrow(/участник/i)
  })

  it('updateCellValue on a FORMULA cell is rejected (read-only computed type)', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const formula = await c.createProperty({
      pageId: fx.pageA,
      type: 'FORMULA',
      name: 'Формула',
      settings: { formula: 'concat("x","y")' },
    })
    const row = await c.createRow({ pageId: fx.pageA, title: 'Row' })

    await expect(
      c.updateCellValue({
        pageId: fx.pageA,
        rowId: row.rowId,
        propertyId: formula.id,
        value: 'nope',
      }),
    ).rejects.toThrow(/только для чтения/i)
  })
})
