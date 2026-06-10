import { prisma } from '@repo/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))

vi.mock('@/lib/get-session', () => ({
  getSession: async () => (sessionUserId.current ? { user: { id: sessionUserId.current } } : null),
}))

import { domain } from '@/lib/domain'
import { GET } from '@/app/api/pages/[pageId]/export/csv/route'

// Real-DB integration test for the view-aware CSV export route: default-view
// resolution, visibleProperties column narrowing, view filters, and the uniform
// 404 access chain (membership + page visibility predicate). Row-access-rule
// filtering is NOT re-fixtured here — the route reads rows exclusively through
// `domain.database.listRows`, whose rule filtering the Phase 4C suites cover.

const EMAIL_SUFFIX = '+csv-export-route-test@anynote.dev'

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  const wsWhere = { createdBy: { email: { contains: EMAIL_SUFFIX } } }
  const wsIds = (await prisma.workspace.findMany({ where: wsWhere, select: { id: true } })).map(
    (w) => w.id,
  )
  await prisma.databaseCellValue.deleteMany({ where: { row: { source: { workspace: wsWhere } } } })
  await prisma.databaseRow.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseProperty.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseView.deleteMany({ where: { source: { workspace: wsWhere } } })
  await prisma.databaseSource.deleteMany({ where: { workspace: wsWhere } })
  if (wsIds.length > 0) {
    await prisma.outboxEvent.deleteMany({ where: { workspaceId: { in: wsIds } } })
  }
  await prisma.page.deleteMany({ where })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: wsWhere })
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

async function seed() {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({
    data: { name: 'CsvExportWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'TEAM', title: 'Общее' },
    select: { id: true },
  })
  const dbPage = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      collectionId: team.id,
      type: 'DATABASE',
      title: 'Реестр',
      createdById: owner.id,
    },
    select: { id: true },
  })
  // Seeds the default TABLE view «Таблица» + the STATUS property «Статус»
  // (options status-not-started/«Не начато», status-in-progress/«В работе»,
  // status-done/«Готово»).
  await domain.database.seedDefaults(dbPage.id, ws.id, 'Реестр')
  const status = (await domain.database.listProperties(owner.id, dbPage.id)).find(
    (p) => p.type === 'STATUS',
  )!
  const num = await domain.database.createProperty(owner.id, {
    pageId: dbPage.id,
    type: 'NUMBER',
    name: 'Число',
  })

  const r1 = await domain.database.createRow(owner.id, { pageId: dbPage.id, title: 'Раз' })
  await domain.database.updateCellValue(owner.id, {
    pageId: dbPage.id,
    rowId: r1.rowId,
    propertyId: status.id,
    value: 'status-done',
  })
  await domain.database.updateCellValue(owner.id, {
    pageId: dbPage.id,
    rowId: r1.rowId,
    propertyId: num.id,
    value: 5,
  })
  const r2 = await domain.database.createRow(owner.id, { pageId: dbPage.id, title: 'Два' })
  await domain.database.updateCellValue(owner.id, {
    pageId: dbPage.id,
    rowId: r2.rowId,
    propertyId: status.id,
    value: 'status-not-started',
  })

  // Extra views seeded directly (the domain's createView always starts from the
  // default settings shape; the route only READS settings).
  const source = await prisma.databaseSource.findFirstOrThrow({
    where: { pageId: dbPage.id },
    select: { id: true },
  })
  const visibleView = await prisma.databaseView.create({
    data: {
      sourceId: source.id,
      type: 'TABLE',
      title: 'Только статус',
      position: 1024,
      settings: { visibleProperties: ['__title__', status.id] },
    },
    select: { id: true },
  })
  const filteredView = await prisma.databaseView.create({
    data: {
      sourceId: source.id,
      type: 'TABLE',
      title: 'Готовые',
      position: 2048,
      settings: {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: status.id, operator: 'equals', value: 'status-done' }],
        },
      },
    },
    select: { id: true },
  })

  return { owner, member, stranger, ws, pageId: dbPage.id, visibleView, filteredView }
}

function call(pageId: string, viewId?: string) {
  const url = `http://t/api/pages/${pageId}/export/csv${viewId ? `?viewId=${viewId}` : ''}`
  return GET(new Request(url) as never, { params: Promise.resolve({ pageId }) })
}

describe('GET /api/pages/[pageId]/export/csv', () => {
  beforeEach(async () => {
    sessionUserId.current = null
    await cleanFixtures()
  })
  afterAll(cleanFixtures)

  it('exports the default view with BOM, option labels and csv headers', async () => {
    const fx = await seed()
    sessionUserId.current = fx.owner.id
    const res = await call(fx.pageId)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toContain(encodeURIComponent('Реестр.csv'))

    // BOM asserted on the RAW bytes — Response.text() strips a leading BOM per
    // the UTF-8 decode spec, so the string-level check would be vacuous.
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes) // decoder consumes the BOM
    const lines = text.split('\r\n')
    expect(lines[0]).toBe('Название,Статус,Число')
    // Option LABELS, never raw option ids.
    expect(text).toContain('Готово')
    expect(text).not.toContain('status-done')
    expect(lines).toContain('Раз,Готово,5')
    expect(lines).toContain('Два,Не начато,')
  })

  it('narrows columns to the view visibleProperties', async () => {
    const fx = await seed()
    sessionUserId.current = fx.owner.id
    const res = await call(fx.pageId, fx.visibleView.id)
    expect(res.status).toBe(200)
    // res.text() strips the BOM, so lines[0] is the header itself.
    const lines = (await res.text()).split('\r\n')
    expect(lines[0]).toBe('Название,Статус')
    expect(lines[0]).not.toContain('Число')
    expect(lines).toContain('Раз,Готово')
  })

  it('applies the view filters so only matching rows export', async () => {
    const fx = await seed()
    sessionUserId.current = fx.owner.id
    const res = await call(fx.pageId, fx.filteredView.id)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('Раз')
    expect(text).not.toContain('Два')
  })

  it('returns a uniform 404 to non-members and to members outside the visibility predicate', async () => {
    const fx = await seed()

    // Non-member: workspace membership gate.
    sessionUserId.current = fx.stranger.id
    expect((await call(fx.pageId)).status).toBe(404)

    // Member, but the page lives in ANOTHER user's PERSONAL collection:
    // the visibility predicate (not mere membership) must 404.
    const personal = await prisma.collection.create({
      data: { workspaceId: fx.ws.id, kind: 'PERSONAL', ownerId: fx.owner.id },
      select: { id: true },
    })
    const privatePage = await prisma.page.create({
      data: {
        workspaceId: fx.ws.id,
        collectionId: personal.id,
        type: 'DATABASE',
        title: 'Личная база',
        createdById: fx.owner.id,
      },
      select: { id: true },
    })
    await domain.database.seedDefaults(privatePage.id, fx.ws.id, 'Личная база')
    sessionUserId.current = fx.member.id
    expect((await call(privatePage.id)).status).toBe(404)
    // The owner still exports it fine (sanity: the 404 above is the predicate).
    sessionUserId.current = fx.owner.id
    expect((await call(privatePage.id)).status).toBe(200)
  })
})
