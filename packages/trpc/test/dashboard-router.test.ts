import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'
import { MAX_WIDGETS_PER_DASHBOARD } from '@repo/domain'

import { dashboardRouter } from '../src/routers/dashboard'
import { databaseRouter } from '../src/routers/database'
import { pageRouter } from '../src/routers/page'
import { domain as domainSvc } from '../src/domain'
import { createCallerFactory } from '../src/trpc'

// Real-DB integration test for the Phase-9F dashboard router (spec §5 + §7).
// Self-contained (creates its own users / workspaces / collections / DATABASE
// pages + rows / DASHBOARD pages inline) so it passes on a fresh CI DB. The
// authoritative proofs are the SECURITY invariants: object-hiding reads
// (non-member → no_access, never content), the EDIT gate on every mutation (a
// viewer → FORBIDDEN), the cross-workspace source check (NOT_FOUND, no attach),
// the widget cap, and per-viewer dashboardData. Requires `docker compose up -d`.

const EMAIL_SUFFIX = '+dashboard-router-test@anynote.dev'

async function cleanFixtures() {
  // Dashboard widgets/global-filters cascade from Dashboard which cascades from
  // its DASHBOARD page; delete dashboards explicitly first to avoid relying on
  // ordering with the database/page deletes below.
  await prisma.dashboardWidget.deleteMany({
    where: { dashboard: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.dashboardGlobalFilter.deleteMany({
    where: { dashboard: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } } },
  })
  await prisma.dashboard.deleteMany({
    where: { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } },
  })
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

function callerCtx(userId: string) {
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

function dashboardCaller(userId: string) {
  return createCallerFactory(dashboardRouter)(callerCtx(userId))
}

function databaseCaller(userId: string) {
  return createCallerFactory(databaseRouter)(callerCtx(userId))
}

function pageCaller(userId: string) {
  return createCallerFactory(pageRouter)(callerCtx(userId))
}

// A workspace with an OWNER, an EDITOR member, and a VIEWER member + a TEAM
// collection. The VIEWER is used to prove the EDIT gate (a viewer cannot mutate)
// and the read object-hiding boundary.
async function seed() {
  const owner = await makeUser('owner')
  const editor = await makeUser('editor')
  const viewer = await makeUser('viewer')
  const ws = await prisma.workspace.create({
    data: { name: 'DashWS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: editor.id, role: 'EDITOR' },
      { workspaceId: ws.id, userId: viewer.id, role: 'VIEWER' },
    ],
  })
  await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
  })
  return { wsId: ws.id, ownerId: owner.id, editorId: editor.id, viewerId: viewer.id }
}

// A stranger in an isolated workspace — for cross-workspace + non-member proofs.
async function seedStranger() {
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({
    data: { name: 'OtherWS', createdById: stranger.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: stranger.id, role: 'OWNER' },
  })
  await prisma.collection.create({
    data: { workspaceId: ws.id, kind: CollectionKind.TEAM, title: 'Общее' },
  })
  return { wsId: ws.id, strangerId: stranger.id }
}

// Build a real DATABASE in `wsId` owned by `ownerId`: a NUMBER property "Сумма"
// + a STATUS property "Статус" + two rows with values. Returns the sourceId, the
// default view id, the property ids, and the page id. We go through the database
// router so the source/properties/rows/cells are wired exactly as in production.
async function seedDatabase(wsId: string, ownerId: string, label = 'DB') {
  const dbPage = await prisma.page.create({
    data: { workspaceId: wsId, type: 'DATABASE', title: label, createdById: ownerId },
    select: { id: true },
  })
  await domainSvc.database.seedDefaults(dbPage.id, wsId, label)
  const db = databaseCaller(ownerId)
  const num = await db.createProperty({ pageId: dbPage.id, type: 'NUMBER', name: 'Сумма' })
  const status = await db.createProperty({ pageId: dbPage.id, type: 'STATUS', name: 'Статус' })
  const r1 = await db.createRow({ pageId: dbPage.id, title: 'R1' })
  const r2 = await db.createRow({ pageId: dbPage.id, title: 'R2' })
  await db.updateCellValue({ pageId: dbPage.id, rowId: r1.rowId, propertyId: num.id, value: 10 })
  await db.updateCellValue({ pageId: dbPage.id, rowId: r2.rowId, propertyId: num.id, value: 30 })

  const schema = await db.getByPage({ pageId: dbPage.id })
  return {
    pageId: dbPage.id,
    sourceId: schema.source.id,
    viewId: schema.views[0]!.id,
    numId: num.id,
    statusId: status.id,
  }
}

describe('dashboard router (integration)', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  // ── create ───────────────────────────────────────────────────────────────────
  it('create makes a DASHBOARD Page + Dashboard row; returns {pageId, dashboardId}', async () => {
    const fx = await seed()
    const res = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId, title: 'Метрики' })
    expect(res.pageId).toBeTruthy()
    expect(res.dashboardId).toBeTruthy()

    const page = await prisma.page.findUnique({ where: { id: res.pageId } })
    expect(page?.type).toBe('DASHBOARD')
    expect(page?.workspaceId).toBe(fx.wsId)

    const dashboard = await prisma.dashboard.findUnique({ where: { id: res.dashboardId } })
    expect(dashboard?.pageId).toBe(res.pageId)
    expect(dashboard?.workspaceId).toBe(fx.wsId)
    expect(dashboard?.title).toBe('Метрики')
  })

  it('create is FORBIDDEN for a non-member of the workspace', async () => {
    const fx = await seed()
    const other = await seedStranger()
    await expect(
      dashboardCaller(other.strangerId).create({ workspaceId: fx.wsId }),
    ).rejects.toThrow(/участ|прав|FORBIDDEN/i)
  })

  // ── getByPage / getById object-hiding ────────────────────────────────────────
  it("getByPage → 'ok' (editable) for an editor, 'no_access' for a non-member", async () => {
    const fx = await seed()
    const other = await seedStranger()
    const created = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId, title: 'Sec' })

    const memberRes = await dashboardCaller(fx.editorId).getByPage({ pageId: created.pageId })
    expect(memberRes.status).toBe('ok')
    if (memberRes.status !== 'ok') throw new Error('unreachable')
    expect(memberRes.dashboard?.id).toBe(created.dashboardId)
    expect(memberRes.editable).toBe(true)
    expect(Array.isArray(memberRes.widgets)).toBe(true)
    expect(Array.isArray(memberRes.globalFilters)).toBe(true)

    const strangerRes = await dashboardCaller(other.strangerId).getByPage({
      pageId: created.pageId,
    })
    expect(strangerRes.status).toBe('no_access')
    expect(JSON.stringify(strangerRes)).not.toContain('Sec')
  })

  it('getByPage → editable:false for a VIEWER member (read-only)', async () => {
    const fx = await seed()
    const created = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const viewerRes = await dashboardCaller(fx.viewerId).getByPage({ pageId: created.pageId })
    expect(viewerRes.status).toBe('ok')
    if (viewerRes.status !== 'ok') throw new Error('unreachable')
    expect(viewerRes.editable).toBe(false)
  })

  it("getById → 'ok' for a member, 'no_access' for a non-member, 'not_found' for unknown", async () => {
    const fx = await seed()
    const other = await seedStranger()
    const created = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })

    const memberRes = await dashboardCaller(fx.editorId).getById({ id: created.dashboardId })
    expect(memberRes.status).toBe('ok')

    const strangerRes = await dashboardCaller(other.strangerId).getById({ id: created.dashboardId })
    expect(strangerRes.status).toBe('no_access')

    const unknownRes = await dashboardCaller(fx.ownerId).getById({
      id: '00000000-0000-7000-8000-000000000000',
    })
    expect(unknownRes.status).toBe('not_found')
  })

  // ── addWidget: edit gate ─────────────────────────────────────────────────────
  it('addWidget adds a widget for an editor', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const widget = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
    })
    expect(widget.id).toBeTruthy()
    expect(widget.sourceId).toBe(db.sourceId)
    expect(widget.type).toBe('METRIC')
    const persisted = await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })
    expect(persisted?.dashboardId).toBe(dash.dashboardId)
  })

  it('addWidget is FORBIDDEN for a VIEWER (view-only cannot edit)', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    await expect(
      dashboardCaller(fx.viewerId).addWidget({
        dashboardId: dash.dashboardId,
        sourceId: db.sourceId,
        type: 'METRIC',
      }),
    ).rejects.toThrow(/прав|FORBIDDEN|редакт/i)
  })

  // ── addWidget: cross-workspace source ────────────────────────────────────────
  it('addWidget rejects a source from another workspace (NOT_FOUND, no cross-workspace attach)', async () => {
    const fx = await seed()
    const other = await seedStranger()
    // A real database in the OTHER workspace.
    const foreignDb = await seedDatabase(other.wsId, other.strangerId, 'ForeignDB')
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    await expect(
      dashboardCaller(fx.ownerId).addWidget({
        dashboardId: dash.dashboardId,
        sourceId: foreignDb.sourceId,
        type: 'METRIC',
      }),
    ).rejects.toThrow(/найден|not found|NOT_FOUND/i)
    expect(await prisma.dashboardWidget.count({ where: { dashboardId: dash.dashboardId } })).toBe(0)
  })

  // ── addWidget: cap ───────────────────────────────────────────────────────────
  it('addWidget rejects beyond MAX_WIDGETS_PER_DASHBOARD', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    // Fill to the cap directly via Prisma (fast — the gate counts persisted rows).
    await prisma.dashboardWidget.createMany({
      data: Array.from({ length: MAX_WIDGETS_PER_DASHBOARD }, (_, i) => ({
        dashboardId: dash.dashboardId,
        sourceId: db.sourceId,
        type: 'METRIC' as const,
        position: i,
      })),
    })
    await expect(
      dashboardCaller(fx.ownerId).addWidget({
        dashboardId: dash.dashboardId,
        sourceId: db.sourceId,
        type: 'METRIC',
      }),
    ).rejects.toThrow(/лимит|максим|cap|too many|превыш/i)
    expect(await prisma.dashboardWidget.count({ where: { dashboardId: dash.dashboardId } })).toBe(
      MAX_WIDGETS_PER_DASHBOARD,
    )
  })

  // ── updateWidget ─────────────────────────────────────────────────────────────
  it('updateWidget persists title/config/viewId; FORBIDDEN for a viewer', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const widget = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
    })
    await dashboardCaller(fx.ownerId).updateWidget({
      widgetId: widget.id,
      title: 'Итого',
      viewId: db.viewId,
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
    })
    const after = await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })
    expect(after?.title).toBe('Итого')
    expect(after?.viewId).toBe(db.viewId)
    expect(after?.config).toMatchObject({ metric: { propertyId: db.numId, aggregation: 'sum' } })

    await expect(
      dashboardCaller(fx.viewerId).updateWidget({ widgetId: widget.id, title: 'hack' }),
    ).rejects.toThrow(/прав|FORBIDDEN|редакт/i)
  })

  // ── removeWidget ─────────────────────────────────────────────────────────────
  it('removeWidget deletes the widget; FORBIDDEN for a viewer', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const widget = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
    })
    await expect(
      dashboardCaller(fx.viewerId).removeWidget({ widgetId: widget.id }),
    ).rejects.toThrow(/прав|FORBIDDEN|редакт/i)
    await dashboardCaller(fx.ownerId).removeWidget({ widgetId: widget.id })
    expect(await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })).toBeNull()
  })

  // ── updateLayout ─────────────────────────────────────────────────────────────
  it('updateLayout bulk-persists grid x/y/w/h; FORBIDDEN for a viewer', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const w1 = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
    })
    const w2 = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'NUMBER',
    })
    await dashboardCaller(fx.ownerId).updateLayout({
      dashboardId: dash.dashboardId,
      layout: [
        { id: w1.id, x: 0, y: 0, w: 6, h: 3 },
        { id: w2.id, x: 6, y: 0, w: 6, h: 5 },
      ],
    })
    const a1 = await prisma.dashboardWidget.findUnique({ where: { id: w1.id } })
    const a2 = await prisma.dashboardWidget.findUnique({ where: { id: w2.id } })
    expect([a1?.gridX, a1?.gridY, a1?.gridW, a1?.gridH]).toEqual([0, 0, 6, 3])
    expect([a2?.gridX, a2?.gridY, a2?.gridW, a2?.gridH]).toEqual([6, 0, 6, 5])

    await expect(
      dashboardCaller(fx.viewerId).updateLayout({
        dashboardId: dash.dashboardId,
        layout: [{ id: w1.id, x: 1, y: 1, w: 1, h: 1 }],
      }),
    ).rejects.toThrow(/прав|FORBIDDEN|редакт/i)
  })

  it('updateLayout ignores widget ids that do not belong to the dashboard', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dashA = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const dashB = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const wB = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dashB.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
    })
    // Attempt to move dashB's widget via a layout call on dashA — must NOT apply.
    await dashboardCaller(fx.ownerId).updateLayout({
      dashboardId: dashA.dashboardId,
      layout: [{ id: wB.id, x: 9, y: 9, w: 9, h: 9 }],
    })
    const after = await prisma.dashboardWidget.findUnique({ where: { id: wB.id } })
    expect(after?.gridX).not.toBe(9)
  })

  // ── setGlobalFilters ─────────────────────────────────────────────────────────
  it('setGlobalFilters replaces the dashboard filters; FORBIDDEN for a viewer', async () => {
    const fx = await seed()
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    await dashboardCaller(fx.ownerId).setGlobalFilters({
      dashboardId: dash.dashboardId,
      filters: [
        { propertyName: 'Статус', operator: 'equals', value: 'open' },
        { propertyName: 'Сумма', operator: 'gt', value: 5 },
      ],
    })
    const rows = await prisma.dashboardGlobalFilter.findMany({
      where: { dashboardId: dash.dashboardId },
      orderBy: { position: 'asc' },
    })
    expect(rows.map((r) => r.propertyName)).toEqual(['Статус', 'Сумма'])

    // Replace (not append): a second call sets a single filter.
    await dashboardCaller(fx.ownerId).setGlobalFilters({
      dashboardId: dash.dashboardId,
      filters: [{ propertyName: 'Сумма', operator: 'lt', value: 100 }],
    })
    const after = await prisma.dashboardGlobalFilter.findMany({
      where: { dashboardId: dash.dashboardId },
    })
    expect(after).toHaveLength(1)
    expect(after[0]?.propertyName).toBe('Сумма')

    await expect(
      dashboardCaller(fx.viewerId).setGlobalFilters({
        dashboardId: dash.dashboardId,
        filters: [],
      }),
    ).rejects.toThrow(/прав|FORBIDDEN|редакт/i)
  })

  // ── dashboardData: per-widget results, per-viewer object-hiding ───────────────
  it('dashboardData returns each widget WidgetDataResult for a member', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const metric = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
    })
    const grouped = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'GROUPED',
      config: {
        groupByPropertyId: db.statusId,
        metric: { propertyId: '__count__', aggregation: 'count_all' },
      },
    })

    const data = await dashboardCaller(fx.editorId).dashboardData({ dashboardId: dash.dashboardId })
    expect(data.status).toBe('ok')
    if (data.status !== 'ok') throw new Error('unreachable')
    const byId = new Map(data.widgets.map((w) => [w.widgetId, w.result]))
    const metricResult = byId.get(metric.id)
    expect(metricResult?.status).toBe('metric')
    if (metricResult?.status === 'metric') expect(metricResult.value).toBe(40) // 10 + 30
    expect(byId.get(grouped.id)?.status).toBe('grouped')
  })

  it('dashboardData → no_access for a non-member (never widget data)', async () => {
    const fx = await seed()
    const other = await seedStranger()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
    })
    const data = await dashboardCaller(other.strangerId).dashboardData({
      dashboardId: dash.dashboardId,
    })
    expect(data.status).toBe('no_access')
    expect(JSON.stringify(data)).not.toContain('"value":40')
  })

  // ── page hard-delete cascade (no special path needed — DASHBOARD has no S3) ──
  it('hard-deleting a DASHBOARD page cascades the Dashboard + its widgets + global filters', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    const widget = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
    })
    await dashboardCaller(fx.ownerId).setGlobalFilters({
      dashboardId: dash.dashboardId,
      filters: [{ propertyName: 'Статус', operator: 'equals', value: 'x' }],
    })
    // Hard-delete requires the page to be in trash first.
    await prisma.page.update({ where: { id: dash.pageId }, data: { deletedAt: new Date() } })
    await pageCaller(fx.ownerId).hardDelete({ id: dash.pageId, workspaceId: fx.wsId })

    expect(await prisma.page.findUnique({ where: { id: dash.pageId } })).toBeNull()
    expect(await prisma.dashboard.findUnique({ where: { id: dash.dashboardId } })).toBeNull()
    expect(await prisma.dashboardWidget.findUnique({ where: { id: widget.id } })).toBeNull()
    expect(
      await prisma.dashboardGlobalFilter.count({ where: { dashboardId: dash.dashboardId } }),
    ).toBe(0)
  })

  it('dashboardData surfaces hidden_property for a metric over a hidden property', async () => {
    const fx = await seed()
    const db = await seedDatabase(fx.wsId, fx.ownerId)
    const dash = await dashboardCaller(fx.ownerId).create({ workspaceId: fx.wsId })
    // Bind the widget to the base VIEW and hide the NUMBER property from it, then
    // aggregate the NUMBER as a metric → the aggregation service must reject it.
    const widget = await dashboardCaller(fx.ownerId).addWidget({
      dashboardId: dash.dashboardId,
      sourceId: db.sourceId,
      type: 'METRIC',
      viewId: db.viewId,
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
    })
    // Set the view's visibleProperties to exclude the NUMBER property.
    await prisma.databaseView.update({
      where: { id: db.viewId },
      data: { settings: { visibleProperties: [db.statusId] } },
    })
    const data = await dashboardCaller(fx.ownerId).dashboardData({ dashboardId: dash.dashboardId })
    expect(data.status).toBe('ok')
    if (data.status !== 'ok') throw new Error('unreachable')
    const result = data.widgets.find((w) => w.widgetId === widget.id)?.result
    expect(result?.status).toBe('hidden_property')
  })
})
