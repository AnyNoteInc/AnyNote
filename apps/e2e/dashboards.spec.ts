import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs, writeConsentsForUserId } from './helpers/auth'

/**
 * Phase 9F E2E (plan Task 6 / spec §8): the BI-dashboard journeys, all asserted
 * IN-SESSION (the Playwright `webServer` is just `next dev` on port 3100 — there
 * is NO yjs server, and decisively the widget data path `dashboardData` →
 * `aggregateWidget` runs SERVER-SIDE in the web process, so a browser
 * `page.route` can NOT mock it).
 *
 * Approach — SEED-AND-ASSERT (the meeting / database-access precedent): rather
 * than drive the live add-widget pipeline end-to-end for the render assertions,
 * we seed a real DATABASE source + properties (a NUMBER «Сумма» + a STATUS
 * «Статус») + rows with cells + a DASHBOARD page + a Dashboard + a METRIC widget
 * (sum of «Сумма») + a BAR widget (grouped by STATUS) directly via Prisma, then
 * navigate to the dashboard and assert the rendered widgets. The numbers are
 * chosen so the SUM is deterministic (10 + 20 + 30 + 5 = 65).
 *
 * Workspace creation goes through the UI form (the meeting / media-embeds
 * precedent): only that path provisions the TEAM/PERSONAL Collections — a raw
 * Prisma `workspace.create` has no collections. The DATABASE + DASHBOARD pages
 * are seeded with `collectionId: null` (visible to any workspace member).
 *
 * Coverage:
 *  (a) the metric widget renders its computed SUM (65); the bar chart renders
 *      (the chart container + an SVG mount — charts are dynamic(ssr:false), so we
 *      wait for the lazily-loaded chart).
 *  (b) the editor sees «Редактирование»/«Просмотр» + (in edit mode) «Добавить
 *      виджет»; opening it shows the settings dialog with the source select.
 *  (c) a VIEWER member (non-creator) opens the dashboard → NO edit affordances
 *      (the server `editable:false` path): no toggle, no «Добавить виджет».
 *
 * The "hidden property not offered" + "global filter only on matching property"
 * + the cross-workspace / object-hiding invariants are domain/tRPC-tested
 * (`widget-aggregation.test.ts`, `dashboard-router.test.ts`), not re-asserted here.
 */

const password = 'SuperSecure123!'

test.setTimeout(180_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// Workspaces created per test — cleaned in afterAll (the shared dev Postgres
// means each --retries attempt appends fresh rows; cleanup must never fail).
const seededWorkspaceIds = new Set<string>()

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    if (seededWorkspaceIds.size > 0) {
      // Cascades drop pages, sources, properties, rows, cells, dashboards,
      // widgets, global filters, members.
      await prisma.workspace
        .deleteMany({ where: { id: { in: [...seededWorkspaceIds] } } })
        .catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
})

/**
 * Sign up, then create the first workspace through the UI form (which provisions
 * the TEAM/PERSONAL collections + the start page + sets it active). Returns the
 * user id and the workspace id (resolved from the DB after creation).
 */
async function signUpAndCreateWorkspace(
  page: Page,
  tag: string,
  workspaceName: string,
): Promise<{ userId: string; email: string; workspaceId: string }> {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Дашборд', lastName: 'Тестов' })
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  await page.getByRole('textbox', { name: 'Название' }).fill(`${workspaceName} ${Date.now()}`)
  const createBtn = page.getByRole('button', { name: 'Создать пространство' })
  await expect(createBtn).toBeEnabled({ timeout: 20_000 })
  await createBtn.click()
  // Creation redirects through /app to a neutral start page. A generous timeout
  // absorbs cold next-dev compile of the heavy workspace routes on the first run.
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 60_000 })

  const workspace = await prisma.workspace.findFirstOrThrow({
    where: { createdById: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  seededWorkspaceIds.add(workspace.id)
  return { userId: user.id, email, workspaceId: workspace.id }
}

// The default STATUS options the domain seeds on every database (mirrored here
// for the pure-Prisma STATUS property + its bucketing).
const STATUS_OPTIONS = [
  { id: 'status-not-started', label: 'Не начато', color: '#9CA3AF' },
  { id: 'status-in-progress', label: 'В работе', color: '#3B82F6' },
  { id: 'status-done', label: 'Готово', color: '#10B981' },
]

/**
 * Seed a real DATABASE (source + TABLE view + a NUMBER property «Сумма» + a
 * STATUS property «Статус») with four rows + cells, exactly as production wires
 * them (each row owns a child TEXT item-page; cells store the raw number / the
 * STATUS option id). Returns the source/property ids for the widgets.
 *
 * Values: 10, 20, 30, 5 → SUM(«Сумма») = 65. STATUS: 2× «Готово», 1× «В работе»,
 * 1× «Не начато» → the bar chart groups into three non-empty buckets.
 */
async function seedDatabase(
  userId: string,
  workspaceId: string,
): Promise<{ sourceId: string; numId: string; statusId: string }> {
  const dbPage = await prisma.page.create({
    data: {
      workspaceId,
      type: 'DATABASE',
      title: 'Продажи',
      collectionId: null,
      createdById: userId,
    },
    select: { id: true },
  })
  const source = await prisma.databaseSource.create({
    data: { workspaceId, pageId: dbPage.id, title: 'Продажи' },
    select: { id: true },
  })
  await prisma.databaseView.create({
    data: { sourceId: source.id, type: 'TABLE', title: 'Таблица', position: 0 },
  })
  const num = await prisma.databaseProperty.create({
    data: { sourceId: source.id, type: 'NUMBER', name: 'Сумма', position: 0 },
    select: { id: true },
  })
  const status = await prisma.databaseProperty.create({
    data: {
      sourceId: source.id,
      type: 'STATUS',
      name: 'Статус',
      position: 1,
      settings: { options: STATUS_OPTIONS },
    },
    select: { id: true },
  })

  const rows: Array<{ title: string; amount: number; status: string }> = [
    { title: 'Сделка A', amount: 10, status: 'status-done' },
    { title: 'Сделка B', amount: 20, status: 'status-done' },
    { title: 'Сделка C', amount: 30, status: 'status-in-progress' },
    { title: 'Сделка D', amount: 5, status: 'status-not-started' },
  ]
  for (const [i, r] of rows.entries()) {
    const itemPage = await prisma.page.create({
      data: {
        workspaceId,
        parentId: dbPage.id,
        type: 'TEXT',
        title: r.title,
        collectionId: null,
        createdById: userId,
      },
      select: { id: true },
    })
    const row = await prisma.databaseRow.create({
      data: { sourceId: source.id, pageId: itemPage.id, position: i, createdById: userId },
      select: { id: true },
    })
    await prisma.databaseCellValue.createMany({
      data: [
        { rowId: row.id, propertyId: num.id, value: r.amount },
        { rowId: row.id, propertyId: status.id, value: r.status },
      ],
    })
  }

  return { sourceId: source.id, numId: num.id, statusId: status.id }
}

/**
 * Seed a DASHBOARD page + its Dashboard + a METRIC widget (SUM of «Сумма») + a
 * BAR widget (count grouped by «Статус»). Returns the dashboard page id.
 */
async function seedDashboard(
  userId: string,
  workspaceId: string,
  db: { sourceId: string; numId: string; statusId: string },
): Promise<{ pageId: string }> {
  const dashPage = await prisma.page.create({
    data: {
      workspaceId,
      type: 'DASHBOARD',
      ownership: 'TEXT',
      title: 'Дашборд продаж',
      collectionId: null,
      createdById: userId,
    },
    select: { id: true },
  })
  const dashboard = await prisma.dashboard.create({
    data: {
      workspaceId,
      pageId: dashPage.id,
      title: 'Дашборд продаж',
      createdById: userId,
    },
    select: { id: true },
  })
  await prisma.dashboardWidget.create({
    data: {
      dashboardId: dashboard.id,
      sourceId: db.sourceId,
      type: 'METRIC',
      title: 'Общая сумма',
      config: { metric: { propertyId: db.numId, aggregation: 'sum' } },
      gridX: 0,
      gridY: 0,
      gridW: 4,
      gridH: 4,
      position: 0,
    },
  })
  await prisma.dashboardWidget.create({
    data: {
      dashboardId: dashboard.id,
      sourceId: db.sourceId,
      type: 'BAR',
      title: 'По статусу',
      config: {
        groupByPropertyId: db.statusId,
        metric: { propertyId: '__count__', aggregation: 'count_all' },
      },
      gridX: 4,
      gridY: 0,
      gridW: 8,
      gridH: 4,
      position: 1,
    },
  })
  return { pageId: dashPage.id }
}

test.describe('Phase 9F — BI dashboards', () => {
  test('(a)+(b) a seeded dashboard renders the metric SUM + a bar chart; the editor sees the edit affordances', async ({
    page,
  }) => {
    const { userId, workspaceId } = await signUpAndCreateWorkspace(
      page,
      'dash-render',
      'Dashboards',
    )
    const db = await seedDatabase(userId, workspaceId)
    const { pageId } = await seedDashboard(userId, workspaceId, db)

    await page.goto(`/pages/${pageId}`)

    // The dashboard shell renders (the page-renderer DASHBOARD dispatch).
    const dashboardPage = page.getByTestId('dashboard-page')
    await expect(dashboardPage).toBeVisible({ timeout: 60_000 })
    // The dashboard's own title heading (scope to the renderer — the sidebar tree
    // also lists the page by name, so a bare getByText is a strict-mode 2-match).
    await expect(dashboardPage.getByRole('heading', { name: 'Дашборд продаж' })).toBeVisible()

    // --- (a) the metric widget renders the computed SUM (10 + 20 + 30 + 5 = 65) ---
    // The METRIC widget body renders the value via `dashboard-stat-value`; the
    // value comes from the SERVER-SIDE aggregateWidget over the seeded cells.
    const statValue = page.getByTestId('dashboard-stat-value')
    await expect(statValue.first()).toBeVisible({ timeout: 30_000 })
    await expect(statValue.first()).toHaveText('65')

    // --- (a) the bar chart widget renders (the chart container + an SVG mount) ---
    // The chart is dynamic(ssr:false), so it lands a tick after the data; wait for
    // its container, then for the @mui/x-charts SVG inside it.
    const barChart = page.getByTestId('dashboard-bar-chart')
    await expect(barChart).toBeVisible({ timeout: 30_000 })
    await expect(barChart.locator('svg').first()).toBeVisible({ timeout: 30_000 })

    // Both seeded widgets mount on the grid.
    await expect(page.getByTestId('dashboard-widget')).toHaveCount(2)

    // --- (b) the editor (the page creator) sees the view/edit toggle ---
    // The owner is the page creator → server `editable:true` → the toggle renders.
    await expect(page.getByRole('button', { name: 'Просмотр' })).toBeVisible()
    const editToggle = page.getByRole('button', { name: 'Редактирование' })
    await expect(editToggle).toBeVisible()

    // In VIEW mode (default) the add-widget button is hidden; switching to EDIT
    // reveals it.
    await expect(page.getByTestId('add-widget-button')).toHaveCount(0)
    await editToggle.click()
    const addWidget = page.getByTestId('add-widget-button')
    await expect(addWidget).toBeVisible({ timeout: 15_000 })
    await expect(addWidget).toContainText('Добавить виджет')

    // Opening «Добавить виджет» shows the settings dialog with the source select
    // (we assert the dialog opens + has the source field; we do NOT complete a
    // full add — keeping the assertion deterministic / non-flaky).
    await addWidget.click()
    const dialog = page.getByTestId('widget-settings-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('Добавить виджет')).toBeVisible()
    await expect(dialog.getByTestId('widget-source-select')).toBeVisible()
    await expect(dialog.getByTestId('widget-type-select')).toBeVisible()
  })

  test('(c) view-only gate: a VIEWER member sees NO edit affordances', async ({
    browser,
    page,
  }) => {
    // The owner seeds the database + dashboard (the creator → editable on their
    // own view).
    const { userId: ownerId, workspaceId } = await signUpAndCreateWorkspace(
      page,
      'dash-owner',
      'Dashboards VG',
    )
    const db = await seedDatabase(ownerId, workspaceId)
    const { pageId } = await seedDashboard(ownerId, workspaceId, db)

    // A second user, signed up in an isolated browser context, added to the
    // owner's workspace as a VIEWER (a non-creator member → server editable:false).
    const viewerCtx = await browser.newContext()
    const viewerPage = await viewerCtx.newPage()
    const viewerEmail = `dash-viewer+${Date.now()}@example.com`
    try {
      await signUpAndAuthAs(viewerPage, {
        email: viewerEmail,
        password,
        firstName: 'Гость',
        lastName: 'Смотров',
      })
      const viewer = await prisma.user.findUniqueOrThrow({
        where: { email: viewerEmail },
        select: { id: true },
      })
      // Consents are written by signUpAndAuthAs; ensure (idempotent safety net).
      const consentCount = await prisma.userConsent.count({ where: { userId: viewer.id } })
      if (consentCount < 5) await writeConsentsForUserId(viewer.id)

      await prisma.workspaceMember.create({
        data: { workspaceId, userId: viewer.id, role: 'VIEWER' },
      })

      // The viewer opens the dashboard directly. The server gates `editable:false`
      // (member but not creator and role=VIEWER), so the renderer's `canEdit` is
      // false → no toggle, no add-widget.
      await viewerPage.goto(`/pages/${pageId}`)

      const dashboardPage = viewerPage.getByTestId('dashboard-page')
      await expect(dashboardPage).toBeVisible({ timeout: 60_000 })

      // The viewer still SEES the widgets (read access follows the workspace), so
      // the metric value renders for them too — but with NO edit affordances.
      await expect(viewerPage.getByTestId('dashboard-stat-value').first()).toHaveText('65', {
        timeout: 30_000,
      })

      // No edit toggle, no add-widget button — the view-only gate (spec §7.3).
      await expect(viewerPage.getByRole('button', { name: 'Редактирование' })).toHaveCount(0)
      await expect(viewerPage.getByRole('button', { name: 'Просмотр' })).toHaveCount(0)
      await expect(viewerPage.getByTestId('add-widget-button')).toHaveCount(0)
    } finally {
      await viewerCtx.close()
    }
  })
})
