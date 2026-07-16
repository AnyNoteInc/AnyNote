import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'

import { databaseRouter } from '../src/routers/database'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-4A database views surface:
//  - getByPage is schema-only (no rows);
//  - listRows is view-aware (the active view's filters/sorts drive the query) and
//    paginated (`{ rows, nextCursor }`);
//  - listGroupedRows buckets by the view's groupBy property;
//  - duplicateView copies a view;
//  - updateView accepts the typed viewSettingsSchema and rejects malformed ones;
//  - deleteView blocks the last view AND a view pinned by an embeddedDatabase block.
//
// Self-cleaning via an email-suffix namespace; requires `docker compose up -d`.

const EMAIL_SUFFIX = '+database-views-test@anynote.dev'

async function cleanFixtures() {
  await prisma.databaseCellValue.deleteMany({
    where: {
      property: { source: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
    },
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

// Seed an OWNER + workspace + TEAM collection + a DATABASE page provisioned with
// the default TABLE view "Таблица" and a STATUS property "Статус" (3 options).
async function seed() {
  const owner = await makeUser('owner')
  const ws = await prisma.workspace.create({
    data: { name: 'DatabaseViewsWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
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
  return { wsId: ws.id, ownerId: owner.id, pageId: dbPage.id }
}

describe('database views router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('getByPage returns schema only — no rows key', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    await c.createRow({ pageId: fx.pageId, title: 'X' })

    const vm = await c.getByPage({ pageId: fx.pageId })
    expect('rows' in vm).toBe(false)
    expect(vm.views).toHaveLength(1)
    expect(vm.properties).toHaveLength(1)
    expect(vm.systemTitleProperty).toEqual({ key: 'title', name: 'Название' })
  })

  it('listRows returns rows for the default view', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    await c.createRow({ pageId: fx.pageId, title: 'Alpha' })
    await c.createRow({ pageId: fx.pageId, title: 'Beta' })

    const { rows, nextCursor } = await c.listRows({ pageId: fx.pageId })
    expect(rows.map((r) => r.title).sort()).toEqual(['Alpha', 'Beta'])
    expect(nextCursor).toBeNull()
  })

  it('two views with different filters return different row sets', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const status = (await c.listProperties({ pageId: fx.pageId })).find((p) => p.type === 'STATUS')!
    const [optA, optB] = status.settings!.options!
    const apple = await c.createRow({ pageId: fx.pageId, title: 'Apple' })
    const banana = await c.createRow({ pageId: fx.pageId, title: 'Banana' })
    await c.updateCellValue({
      pageId: fx.pageId,
      rowId: apple.rowId,
      propertyId: status.id,
      value: optA!.id,
    })
    await c.updateCellValue({
      pageId: fx.pageId,
      rowId: banana.rowId,
      propertyId: status.id,
      value: optB!.id,
    })

    // View 1: filter STATUS == optA (only Apple).
    const v1 = (await c.listViews({ pageId: fx.pageId }))[0]!
    await c.updateView({
      pageId: fx.pageId,
      id: v1.id,
      settings: {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: status.id, operator: 'equals', value: optA!.id }],
        },
      },
    })
    // View 2: filter STATUS == optB (only Banana).
    const v2 = await c.createView({ pageId: fx.pageId, title: 'Только Banana' })
    await c.updateView({
      pageId: fx.pageId,
      id: v2.id,
      settings: {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: status.id, operator: 'equals', value: optB!.id }],
        },
      },
    })

    const r1 = await c.listRows({ pageId: fx.pageId, viewId: v1.id })
    const r2 = await c.listRows({ pageId: fx.pageId, viewId: v2.id })
    expect(r1.rows.map((r) => r.title)).toEqual(['Apple'])
    expect(r2.rows.map((r) => r.title)).toEqual(['Banana'])
  })

  // Empirical guard against the Prisma JSON-number-as-text footgun (issue #8224):
  // a NUMBER `gt: 10` filter must compare numerically (20, 100 > 10) NOT
  // lexically (where "9" > "10" as text). If Prisma cast the JSON to text this
  // would wrongly include 9 and exclude 100 — this test would fail.
  it('NUMBER gt filter compares numerically, not as text', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const num = await c.createProperty({ pageId: fx.pageId, type: 'NUMBER', name: 'Сумма' })
    const r9 = await c.createRow({ pageId: fx.pageId, title: 'nine' })
    const r20 = await c.createRow({ pageId: fx.pageId, title: 'twenty' })
    const r100 = await c.createRow({ pageId: fx.pageId, title: 'hundred' })
    await c.updateCellValue({ pageId: fx.pageId, rowId: r9.rowId, propertyId: num.id, value: 9 })
    await c.updateCellValue({ pageId: fx.pageId, rowId: r20.rowId, propertyId: num.id, value: 20 })
    await c.updateCellValue({
      pageId: fx.pageId,
      rowId: r100.rowId,
      propertyId: num.id,
      value: 100,
    })

    const view = (await c.listViews({ pageId: fx.pageId }))[0]!
    await c.updateView({
      pageId: fx.pageId,
      id: view.id,
      settings: {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: num.id, operator: 'gt', value: 10 }],
        },
      },
    })

    const result = await c.listRows({ pageId: fx.pageId, viewId: view.id })
    const titles = result.rows.map((r) => r.title).sort()
    // Numerically correct: 20 and 100 are > 10; 9 is not.
    expect(titles).toEqual(['hundred', 'twenty'])
  })

  it('listRows paginates via nextCursor', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    // 5 rows, page size 2 → pages of 2, 2, 1.
    for (let i = 0; i < 5; i++) {
      await c.createRow({ pageId: fx.pageId, title: `Row ${i}` })
    }

    const page1 = await c.listRows({ pageId: fx.pageId, limit: 2 })
    expect(page1.rows).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await c.listRows({ pageId: fx.pageId, limit: 2, cursor: page1.nextCursor! })
    expect(page2.rows).toHaveLength(2)
    expect(page2.nextCursor).not.toBeNull()

    const page3 = await c.listRows({ pageId: fx.pageId, limit: 2, cursor: page2.nextCursor! })
    expect(page3.rows).toHaveLength(1)
    expect(page3.nextCursor).toBeNull()

    // No overlap and full coverage across pages.
    const ids = [...page1.rows, ...page2.rows, ...page3.rows].map((r) => r.rowId)
    expect(new Set(ids).size).toBe(5)
  })

  it('listGroupedRows buckets rows by the groupBy property', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const status = (await c.listProperties({ pageId: fx.pageId })).find((p) => p.type === 'STATUS')!
    const [optA, optB] = status.settings!.options!
    const a = await c.createRow({ pageId: fx.pageId, title: 'InA' })
    const b = await c.createRow({ pageId: fx.pageId, title: 'InB' })
    await c.createRow({ pageId: fx.pageId, title: 'Ungrouped' })
    await c.updateCellValue({
      pageId: fx.pageId,
      rowId: a.rowId,
      propertyId: status.id,
      value: optA!.id,
    })
    await c.updateCellValue({
      pageId: fx.pageId,
      rowId: b.rowId,
      propertyId: status.id,
      value: optB!.id,
    })

    // A BOARD view groups by the STATUS property (default-seeded on creation).
    const board = await c.createView({ pageId: fx.pageId, type: 'BOARD', title: 'Доска' })

    const { groups } = await c.listGroupedRows({ pageId: fx.pageId, viewId: board.id })
    const byKey = new Map(groups.map((g) => [g.key, g]))
    expect(byKey.get(optA!.id)?.rows.map((r) => r.title)).toEqual(['InA'])
    expect(byKey.get(optB!.id)?.rows.map((r) => r.title)).toEqual(['InB'])
    // The null bucket holds the row with no status value.
    expect(byKey.get(null)?.rows.map((r) => r.title)).toEqual(['Ungrouped'])
  })

  it('duplicateView creates a copy at the next position', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const original = (await c.listViews({ pageId: fx.pageId }))[0]!

    const copy = await c.duplicateView({ pageId: fx.pageId, viewId: original.id })
    expect(copy.id).not.toBe(original.id)
    expect(copy.title).toBe(`${original.title} (копия)`)
    expect(copy.type).toBe(original.type)

    const views = await c.listViews({ pageId: fx.pageId })
    expect(views).toHaveLength(2)
    // The copy sits after the original.
    expect(views.at(-1)?.id).toBe(copy.id)
  })

  it('rejects generic FORM creation and duplicates a FORM through its lifecycle service', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)

    await expect(
      c.createView({ pageId: fx.pageId, type: 'FORM', title: 'Нельзя так' }),
    ).rejects.toThrow(/FORM_REQUIRES_CREATE_FORM/)

    const original = await c.createForm({ pageId: fx.pageId, title: 'Анкета' })
    await c.publishForm({ pageId: fx.pageId, formId: original.id })
    const copy = await c.duplicateView({ pageId: fx.pageId, viewId: original.viewId! })

    expect(copy).toMatchObject({
      state: 'DRAFT',
      customSlug: null,
      publishedVersionId: null,
      acceptedResponses: 0,
    })
    expect(copy.id).not.toBe(original.id)
    expect(copy.viewId).not.toBe(original.viewId)
    expect(copy.routeKey).not.toBe(original.routeKey)
    await expect(c.listFormVersions({ pageId: fx.pageId, formId: copy.id })).resolves.toEqual([])
  })

  it('updateView accepts typed settings and rejects a malformed operator', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const status = (await c.listProperties({ pageId: fx.pageId })).find((p) => p.type === 'STATUS')!
    const view = (await c.listViews({ pageId: fx.pageId }))[0]!

    // Valid typed settings round-trip.
    const updated = await c.updateView({
      pageId: fx.pageId,
      id: view.id,
      settings: {
        filters: {
          conjunction: 'or',
          conditions: [{ propertyId: '__title__', operator: 'contains', value: 'x' }],
        },
        sorts: [{ propertyId: '__title__', direction: 'desc' }],
        visibleProperties: [status.id],
      },
    })
    expect((updated.settings as { sorts?: unknown[] }).sorts).toHaveLength(1)

    // Malformed operator is rejected by the zod input schema (filterOperatorSchema).
    await expect(
      c.updateView({
        pageId: fx.pageId,
        id: view.id,
        settings: {
          filters: {
            conjunction: 'and',
            // @ts-expect-error — invalid operator must fail input validation
            conditions: [{ propertyId: status.id, operator: 'totally_bogus', value: 'x' }],
          },
        },
      }),
    ).rejects.toThrow()
  })

  it('cannot delete the last remaining view', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const view = (await c.listViews({ pageId: fx.pageId }))[0]!
    await expect(c.deleteView({ pageId: fx.pageId, id: view.id })).rejects.toThrow(/единственное/i)
  })

  it('cannot delete a view referenced by an embeddedDatabase block', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    // Two views so the last-view rule does not mask the embed guard.
    const board = await c.createView({ pageId: fx.pageId, type: 'BOARD', title: 'Доска' })
    const source = (await c.getByPage({ pageId: fx.pageId })).source

    // A TEXT page in the same workspace embeds the database, pinning `board.id`.
    await prisma.page.create({
      data: {
        workspaceId: fx.wsId,
        type: 'TEXT',
        title: 'Embeds the board',
        createdById: fx.ownerId,
        content: {
          type: 'doc',
          content: [
            {
              type: 'embeddedDatabase',
              attrs: {
                sourceId: source.id,
                viewId: board.id,
                displayMode: 'table',
                readonly: false,
              },
            },
          ],
        },
      },
    })

    await expect(c.deleteView({ pageId: fx.pageId, id: board.id })).rejects.toThrow(
      /встроенном блоке/i,
    )

    // A view NOT referenced by any embed deletes fine.
    const other = await c.createView({ pageId: fx.pageId, title: 'Свободное' })
    await c.deleteView({ pageId: fx.pageId, id: other.id })
    const views = await c.listViews({ pageId: fx.pageId })
    expect(views.map((v) => v.id)).not.toContain(other.id)
    await expect(
      prisma.databaseView.findUniqueOrThrow({ where: { id: other.id } }),
    ).resolves.toMatchObject({ archivedAt: expect.any(Date) })
  })

  it('checks embedded references before atomically archiving a FORM view', async () => {
    const fx = await seed()
    const c = caller(fx.ownerId)
    const form = await c.createForm({ pageId: fx.pageId, title: 'Встроенная форма' })
    const source = (await c.getByPage({ pageId: fx.pageId })).source
    const embedded = await prisma.page.create({
      data: {
        workspaceId: fx.wsId,
        type: 'TEXT',
        title: 'Embeds the form',
        createdById: fx.ownerId,
        content: {
          type: 'doc',
          content: [
            {
              type: 'embeddedDatabase',
              attrs: {
                sourceId: source.id,
                viewId: form.viewId,
                displayMode: 'table',
                readonly: false,
              },
            },
          ],
        },
      },
    })

    await expect(
      c.archiveForm({ pageId: fx.pageId, formId: form.id }),
    ).rejects.toThrow(/встроенном блоке/i)
    await expect(c.deleteView({ pageId: fx.pageId, id: form.viewId! })).rejects.toThrow(
      /встроенном блоке/i,
    )
    await expect(
      prisma.databaseView.findUniqueOrThrow({ where: { id: form.viewId! } }),
    ).resolves.toMatchObject({ archivedAt: null })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ state: 'DRAFT', viewId: form.viewId })

    await prisma.page.update({ where: { id: embedded.id }, data: { content: { type: 'doc' } } })
    await expect(c.deleteView({ pageId: fx.pageId, id: form.viewId! })).resolves.toEqual({
      ok: true,
    })
    await expect(
      prisma.databaseForm.findUniqueOrThrow({ where: { id: form.id } }),
    ).resolves.toMatchObject({ state: 'ARCHIVED', viewId: null })
    await expect(
      prisma.databaseView.findUniqueOrThrow({ where: { id: form.viewId! } }),
    ).resolves.toMatchObject({ archivedAt: expect.any(Date) })
  })
})
