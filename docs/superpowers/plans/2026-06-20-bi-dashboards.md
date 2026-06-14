# BI Dashboards over databases (Phase 9F) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `DASHBOARD` page holding widgets (metric/number/grouped/table/bar/line/donut) that each query a database source/view with aggregation + grouping + filters + global filters, on a drag-and-drop resizable grid (edit vs view mode), respecting database access + page rules + property visibility, with performance caps.

**Architecture:** A new `DASHBOARD` Page.type (the MEETING 9E template) owns a `Dashboard` (+ `DashboardWidget`/`DashboardGlobalFilter`). A new domain `aggregateWidget` service reuses the existing database read/access stack (`buildRowQuery` + `findRowsForGrouping` + `filterViewableRows` + `computed-cells.aggregate`) as a thin aggregation layer. UI = react-grid-layout grid + `@mui/x-charts@^9` widgets, reusing the view-config Popovers + EmbeddedDatabasePicker for settings.

**Tech Stack:** Prisma 7 (shared-dev-DB diff→psql→resolve), tRPC v11, Next.js 16, MUI v7 + `@mui/x-charts@^9` (verified peer-compatible), `react-grid-layout@2.2.3`, vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-20-bi-dashboards-design.md` (read it; §§3–7 normative).

**Conventions (all tasks):** prettier `semi:false`/single/100. NEVER `git add -A` — stage explicit paths. MUI via `@repo/ui/components` in app code (`@mui/x-charts` is a new app dep — import it in apps/web components directly, loaded via dynamic ssr:false). TDD for the aggregation logic + the tRPC gating. After each task: format touched files. **Worktree hygiene:** if a target file shows ` M` (foreign format-sweep), `git checkout HEAD -- <file>` before editing; restore prettier-reflowed untouched lines to HEAD; verify each commit lists only your files.

---

## Task 1: Schema — Dashboard/DashboardWidget/DashboardGlobalFilter + DASHBOARD Page.type + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260620120000_dashboards/migration.sql`

Read first: spec §3 (the 3 models VERBATIM); the `Page`/`Workspace`/`DatabaseSource`/`DatabaseView` models in schema.prisma (confirm names; note the recent MEETING/synced-block additions); the migration-flow header.

- [ ] **Step 1: Add the enum + models to schema.prisma**

Add `enum DashboardWidgetType { METRIC GROUPED TABLE BAR LINE DONUT NUMBER }`. Add `DASHBOARD` to the `PageType` enum. Add the 3 models from spec §3 verbatim (`Dashboard` 1:1 page via `pageId @unique`; `DashboardWidget` with sourceId/viewId?/type/config Json/gridX/Y/W/H/position + `dashboard Dashboard @relation onDelete:Cascade` + `source DatabaseSource @relation("WidgetSource") onDelete:Cascade` + `view DatabaseView? @relation("WidgetView") onDelete:SetNull`; `DashboardGlobalFilter`). Add back-relations: `Page.dashboard Dashboard? @relation("PageDashboard")`, `Workspace.dashboards`, `DatabaseSource` → `dashboardWidgets DashboardWidget[] @relation("WidgetSource")`, `DatabaseView` → `dashboardWidgets DashboardWidget[] @relation("WidgetView")`, and the Dashboard.widgets/globalFilters + DashboardWidget.dashboard sides. Verify every named relation has both sides.

- [ ] **Step 2: Generate the migration (shared-DB flow, NO migrate dev / reset)**

```bash
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9f-dashboards
git show HEAD:packages/db/prisma/schema.prisma > /tmp/9f_old.prisma
mkdir -p packages/db/prisma/migrations/20260620120000_dashboards
pnpm --filter @repo/db exec prisma migrate diff --from-schema /tmp/9f_old.prisma --to-schema packages/db/prisma/schema.prisma --script > packages/db/prisma/migrations/20260620120000_dashboards/migration.sql
```
Strip any leaked dotenv banner so it's pure SQL.

- [ ] **Step 3: Apply + record + generate + verify**

```bash
docker exec -i anynote-postgres-1 psql -U user -d anynote --single-transaction -v ON_ERROR_STOP=1 < packages/db/prisma/migrations/20260620120000_dashboards/migration.sql
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260620120000_dashboards
pnpm --filter @repo/db prisma:generate
docker exec -i anynote-postgres-1 psql -U user -d anynote -c "\d dashboard_widgets" | grep -E "source_id|view_id|type|grid_|config"
docker exec -i anynote-postgres-1 psql -U user -d anynote -c "\dt" | grep -E "dashboards|dashboard_widgets|dashboard_global_filters"
```
Expected: the 3 tables; dashboard_widgets FKs (dashboard CASCADE, source CASCADE, view SetNull); dashboards.page_id unique → Page CASCADE.

- [ ] **Step 4: check-types + commit**

```bash
pnpm --filter @repo/db check-types && pnpm check-types
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260620120000_dashboards/migration.sql
git commit -m "feat(db): dashboard models — Dashboard/DashboardWidget/DashboardGlobalFilter + DASHBOARD page type"
```

---

## Task 2: The aggregateWidget domain service (reuse the database stack)

**Files:**
- Create: `packages/domain/src/dashboard/dto/dashboard.dto.ts` (WidgetConfig, WidgetType, the result union, MAX_WIDGET_ROWS, MAX_WIDGETS_PER_DASHBOARD)
- Create: `packages/domain/src/dashboard/services/widget-aggregation.ts` (`aggregateWidget`)
- Create: `packages/domain/src/dashboard/index.ts` (barrel, if the domain module pattern needs it)
- Test: `packages/domain/test/dashboard/widget-aggregation.test.ts`

Read first: spec §4 (the 6-step algorithm + §7 invariants); `packages/domain/src/database/services/query-planner.ts` (`buildRowQuery`, RowQueryPlan, the post-filter outputs); `packages/domain/src/database/repositories/database.repository.ts` (`findRowsForGrouping`, `findRowsPaged` — add a capped variant or pass a `take`); `packages/domain/src/database/services/database.service.ts` (`assertCanRead`, `requireSource`, `resolveViewContext`, `listGroupedRows` bucketing 1373-1435, the post-filter chain `applyMultiSelectPostFilters`/`applyRelationPostFilters`/`filterViewableRows`, `augmentRows`); `packages/domain/src/database/services/computed-cells.ts` (`aggregate`, `NUMERIC_AGGREGATORS`, `toNum`/`isEmpty`/`toComparableDate`, `RollupAggregation`); `packages/domain/src/database/services/row-access-resolver.ts` (`filterViewableRows`/`resolveRowAccessForRows` — the authority); the `DatabasePropertyType` enum + the computed types (FORMULA/ROLLUP/CREATED_*/LAST_EDITED_*); how `visibleProperties` lives in `ViewSettings.settings` JSON; the database test fixtures (`packages/domain/test/database/*`).

- [ ] **Step 1: dto + the result union (write the failing test first)**

`dashboard.dto.ts`: `MAX_WIDGET_ROWS = 5000`, `MAX_WIDGETS_PER_DASHBOARD = 24`; `WidgetType` (METRIC/NUMBER/GROUPED/TABLE/BAR/LINE/DONUT); `WidgetMetric { propertyId: string | '__count__'; aggregation: RollupAggregation }`; `WidgetConfig { metric?: WidgetMetric; groupByPropertyId?: string; filters?: FilterGroup; chartOptions?: {...} }`; `GlobalFilterInput { propertyName, operator, value }`; `WidgetDataResult` union: `{status:'metric', value, truncated}` | `{status:'grouped', groups:[{key,label,value}], truncated}` | `{status:'table', rows, properties, truncated, nextCursor?}` | `{status:'no_access'}` | `{status:'hidden_property', propertyId}` | `{status:'error', message}`.

Write `widget-aggregation.test.ts` first (reuse the database fixtures — seed a source + properties [a NUMBER + a STATUS] + rows + cells):
```ts
// - METRIC sum/avg/min/max/count over the NUMBER property's cells
// - __count__ returns row count
// - GROUPED by the STATUS property → one {key,label,value} per option + reduce
// - hidden property (not in visibleProperties) as metric → {status:'hidden_property'}
// - computed property (FORMULA/ROLLUP) as metric → rejected (hidden_property or a clear error)
// - the MAX_WIDGET_ROWS cap → truncated:true when more rows match
// - access: a row the viewer can't see (row-access rule) is NOT in the aggregate
// - global filter applies only when the source has a visible matching-name+type property
```
Run → FAIL (module missing).

- [ ] **Step 2: implement aggregateWidget**

Per spec §4: access (`assertCanRead`/`requireSource`; no access → `{status:'no_access'}`); visibility gate (reject hidden/computed metric|groupBy → `{status:'hidden_property'}`); build the synthetic ViewSettings (merge view filters + widget filters + applicable global filters) → `buildRowQuery`; capped fetch (`findRowsForGrouping` with a `take: MAX_WIDGET_ROWS + 1`, set `truncated` if over) + the post-filter chain incl. `filterViewableRows`; aggregate via `computed-cells.aggregate` (metric = one reduce; grouped = bucket-by-property then reduce each; table = capped row slice). Run → green.

- [ ] **Step 3: gates + commit**

```bash
pnpm --filter @repo/domain test widget-aggregation && pnpm --filter @repo/domain check-types && pnpm check-types
git add packages/domain/src/dashboard packages/domain/test/dashboard/widget-aggregation.test.ts
git commit -m "feat(domain): aggregateWidget — access+visibility-gated metric/grouped/table aggregation over databases"
```

---

## Task 3: The dashboard tRPC router (CRUD + widgetData + caps + object-hiding)

**Files:**
- Create: `packages/trpc/src/routers/dashboard.ts`
- Modify: `packages/trpc/src/index.ts` (register)
- Modify: the page hard-delete path if a DASHBOARD page needs cleanup beyond the FK cascade (likely just cascade — confirm)
- Test: `packages/trpc/test/dashboard-router.test.ts` (real-DB fixture-scoped)

Read first: spec §5 + §7; `packages/trpc/src/routers/meeting.ts` (the create-page + object-hiding typed-union + access-gated mutations + the domain-service-call pattern — the closest analogue), `packages/trpc/src/routers/database/source.ts` (`getBySourceId → assertPageAccess`, `listSources`), `packages/trpc/src/helpers/{page-access.ts,plan.ts}`, `packages/domain` exports for `aggregateWidget` (Task 2) + `domainSvc.pages.create`, `packages/trpc/src/index.ts`.

- [ ] **Step 1: skeleton + create + the typed read (TDD)**

Write `dashboard-router.test.ts` first (fixture-scoped real-DB):
```ts
// create → DASHBOARD Page + Dashboard row; returns {pageId, dashboardId}
// getByPage/getById → object-hiding {status:'ok'|'no_access'|'not_found'} (non-member → no_access)
// addWidget → gates on page EDIT access (a viewer → FORBIDDEN); source must be in the workspace (cross-workspace → NOT_FOUND); rejects beyond MAX_WIDGETS_PER_DASHBOARD
// updateLayout → persists grid x/y/w/h; removeWidget; updateWidget; setGlobalFilters
// widgetData/dashboardData → calls aggregateWidget; non-member → no_access; hidden property → hidden_property
```
Run → FAIL.

- [ ] **Step 2: implement dashboard.ts**

`create`, `getByPage`/`getById` (typed union, object-hiding via page-access; `editable` = caller can edit the page), `addWidget` (edit-gate + workspace-source check + `MAX_WIDGETS_PER_DASHBOARD` cap), `updateWidget`, `removeWidget`, `updateLayout` (bulk grid persist, edit-gated), `setGlobalFilters`, `dashboardData({dashboardId})` (returns each widget's `aggregateWidget` result, per-viewer). Register in index.ts. Run → green.

- [ ] **Step 3: gates + commit**

```bash
pnpm --filter @repo/trpc test dashboard-router && pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types && pnpm check-types
git add packages/trpc/src/routers/dashboard.ts packages/trpc/src/index.ts packages/trpc/test/dashboard-router.test.ts
git commit -m "feat(trpc): dashboard router — CRUD, widget caps, object-hiding reads, per-viewer widgetData"
```

---

## Task 4: Chart lib + the DASHBOARD page-type + the widget components (non-grid)

**Files:**
- Modify: `apps/web/package.json` (add `@mui/x-charts@^9`, `react-grid-layout`, `@types/react-grid-layout`) + `pnpm-lock.yaml`
- Create: `apps/web/src/components/dashboard/widgets/{MetricWidget,NumberWidget,GroupedWidget,TableWidget,BarChartWidget,LineChartWidget,DonutChartWidget}.tsx` + a `widget-data-states.tsx` (no_access/hidden_property/error/truncated)
- Create: `apps/web/src/components/dashboard/widget-frame.tsx` (the shared widget card chrome)
- Modify: `apps/web/src/components/page/page-renderer.tsx` (DASHBOARD case), `pages/[pageId]/page.tsx` (isFullBleed), `page-type-registry.tsx` (icon/label, NOT creatable)
- Test: a pure chart-data transform test if extracted

Read first: spec §6; `apps/web/src/components/meeting/MeetingTranscriptPage.tsx` + the MEETING page-renderer case (the page-type wiring template); `apps/web/src/components/database/embedded-database-embed.tsx` + `database-table-view.tsx` (the TableWidget reuse: getBySourceId + DatabaseTableView editable=false); the heavy-viz `dynamic(ssr:false)` pattern in page-renderer; `@mui/x-charts` v9 API (BarChart/LineChart/PieChart — fetch docs if unsure: the import is `@mui/x-charts/BarChart` etc.); how `trpc.dashboard.dashboardData` returns per-widget results (Task 3).

- [ ] **Step 1: add the deps**

```bash
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9f-dashboards
pnpm --filter web add @mui/x-charts@^9 react-grid-layout
pnpm --filter web add -D @types/react-grid-layout
```
Confirm `pnpm --filter web build` still resolves (the peer matrix is pre-verified: x-charts ^9 peers @mui/material ^7.3||^9, react 19; react-grid-layout 2.2.3 peers react>=16.3).

- [ ] **Step 2: the widget components (data-driven, dynamic-imported charts)**

Build each widget rendering a `WidgetDataResult`: `MetricWidget`/`NumberWidget` (big stat + label), `GroupedWidget` (group→value table), `TableWidget` (reuse `DatabaseTableView` editable=false via getBySourceId), `BarChartWidget`/`LineChartWidget`/`DonutChartWidget` (`@mui/x-charts` BarChart/LineChart/PieChart fed by the grouped result → series; loaded via `dynamic(ssr:false)`). A shared `widget-frame.tsx` (title + settings/remove affordances in edit mode) + `widget-data-states.tsx` for no_access/hidden_property/error/truncated. If a `groupedToSeries(result)` transform is non-trivial, extract it to a `.ts` + unit-test it.

- [ ] **Step 3: the DASHBOARD page-type dispatch**

page-renderer.tsx: `if (page.type === 'DASHBOARD') return <DashboardPageRenderer pageId editable/>` (dynamic ssr:false). Add DASHBOARD to isFullBleed + pageTypeIcon/Label («Дашборд», a dashboard/grid icon) but NOT to CREATABLE_PAGE_TYPES (the FORM/MEETING precedent). (DashboardPageRenderer itself is Task 5 — for this task, a minimal placeholder renderer that loads getByPage + renders the widgets in a static stack is acceptable, OR defer the renderer to Task 5 and just wire the dispatch to a stub. Prefer: build the widgets here, the grid+renderer in Task 5.)

- [ ] **Step 4: verify + commit**

```bash
pnpm --filter web check-types && pnpm --filter web lint
set -a && source /Users/victor/Projects/anynote/.env; set +a && pnpm --filter web build   # FOREGROUND
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/dashboard/widgets apps/web/src/components/dashboard/widget-frame.tsx apps/web/src/components/dashboard/widget-data-states.tsx apps/web/src/components/page/page-renderer.tsx "apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx" apps/web/src/components/templates/page-type-registry.tsx
git commit -m "feat(web): dashboard widgets (metric/grouped/table/bar/line/donut) + @mui/x-charts + DASHBOARD page type"
```

---

## Task 5: DashboardPageRenderer — the react-grid-layout grid + edit/view mode + widget settings + global filters + launch

**Files:**
- Create: `apps/web/src/components/dashboard/DashboardPageRenderer.tsx` (the grid + edit/view toggle)
- Create: `apps/web/src/components/dashboard/widget-settings-dialog.tsx` (source/view/type/metric/groupBy/filters)
- Create: `apps/web/src/components/dashboard/global-filter-bar.tsx`
- Modify: the create-page/sidebar entry — add a "New dashboard" launch action
- Modify: page-renderer.tsx (point the DASHBOARD case at the real renderer if a stub was used in T4)

Read first: spec §6; `react-grid-layout` API (Responsive/GridLayout, the `layout` prop `{i,x,y,w,h}`, `onLayoutChange`, `isDraggable`/`isResizable`, the required CSS imports `react-grid-layout/css/styles.css` + `react-resizable/css/styles.css`); `apps/web/src/components/database/view-config/{database-filter-builder.tsx,group-by-picker.tsx,database-sort-builder.tsx}` + `propertyConfig/rollup-config.tsx` (the aggregation UI) — the widget-settings building blocks; `apps/web/src/components/database/embedded-database-picker.tsx` (source picker); the MEETING launch entry (Task 9E sidebar «Загрузить встречу») for the "New dashboard" action pattern; `apps/web/src/components/meeting/MeetingTranscriptPage.tsx` (the editable flag + the load/poll pattern).

- [ ] **Step 1: DashboardPageRenderer (grid + edit/view)**

Load via `trpc.dashboard.getByPage` + `trpc.dashboard.dashboardData`. Render a `react-grid-layout` `<GridLayout>` (import the CSS) of `<WidgetFrame>`s keyed by widget id, layout from the widgets' gridX/Y/W/H. **Edit mode** (when `editable`, toggled): `isDraggable`/`isResizable` true → `onLayoutChange` debounced → `trpc.dashboard.updateLayout`; an "Add widget" button → the settings dialog; per-widget settings/remove via the frame. **View mode**: drag/resize off, read-only. The view/edit toggle shown only to editors.

- [ ] **Step 2: widget-settings-dialog**

A MUI Dialog: pick source (EmbeddedDatabasePicker / `database.listSources`), optional base view, widget type, the metric property + aggregation (reuse the rollup-config aggregation menu / `RollupAggregation`), group-by (GroupByPicker), filters (DatabaseFilterBuilder), chart options. **Only VISIBLE, non-computed properties offered** (mirror the server visibility gate in the picker). Confirm → `addWidget`/`updateWidget`.

- [ ] **Step 3: global-filter-bar**

Add/remove global filters (property name + operator + value) → `setGlobalFilters`; the bar is shown on the dashboard, applied to compatible widgets (the server decides compatibility per widget).

- [ ] **Step 4: launch entry**

Add a "New dashboard" action (sidebar create entry, near the MEETING «Загрузить встречу» / «Новая страница») → `dashboard.create` → navigate to `/pages/{pageId}`.

- [ ] **Step 5: verify + commit**

```bash
pnpm --filter web check-types && pnpm --filter web lint
set -a && source /Users/victor/Projects/anynote/.env; set +a && pnpm --filter web build   # FOREGROUND
git add apps/web/src/components/dashboard/DashboardPageRenderer.tsx apps/web/src/components/dashboard/widget-settings-dialog.tsx apps/web/src/components/dashboard/global-filter-bar.tsx apps/web/src/components/page/page-renderer.tsx <launch-entry-file>
git commit -m "feat(web): dashboard editor — react-grid-layout grid, edit/view mode, widget settings, global filters"
```

---

## Task 6: E2E + changelog

**Files:**
- Create: `apps/e2e/dashboards.spec.ts`
- Modify: `docs/changelog.md`

Read first: spec §8; `apps/e2e/helpers/auth.ts`; the MEETING/database E2E for seeding a DATABASE + rows via Prisma + a typed page; the E2E constraints (no yjs server → in-session, no reload; `el.evaluate(e=>e.click())` for overlays; `--retries`; `rm -rf apps/web/.next` if wedged); how to seed a DASHBOARD page + Dashboard + a widget via Prisma.

- [ ] **Step 1: dashboards.spec.ts (seed-and-assert)**

`signUpAndAuthAs` → seed via Prisma: a DATABASE source + properties (a NUMBER + a STATUS) + a few rows/cells + a DASHBOARD page + a Dashboard + a METRIC widget (sum of the NUMBER) + a BAR widget (grouped by STATUS). Tests (in-session):
(a) open the dashboard → the metric widget renders its value; the bar chart widget renders (assert the chart container / a series element).
(b) add a widget via the settings dialog (pick the source, type METRIC, a property + aggregation) → assert it appears (or assert the dialog flow + that addWidget succeeds; keep it deterministic).
(c) view-only: seed a second member with VIEWER access to the dashboard page → as that user, assert NO edit affordances (no "Add widget", drag disabled). (Or assert via the editable flag if a full second-user flow is heavy — at minimum assert the edit toggle/add-button absent for a non-editor.)
Use the EXACT Russian labels from the Task-4/5 components.

- [ ] **Step 2: run the spec (docker up, retries)**

```bash
docker compose up -d
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9f-dashboards
set -a && source /Users/victor/Projects/anynote/.env; set +a
pnpm exec playwright test apps/e2e/dashboards.spec.ts --retries=2 --reporter=line
```
`rm -rf apps/web/.next` if wedged. Treat only deterministic attempt-2+ failures as real; fix minimal real causes (reset foreign-dirtied first).

- [ ] **Step 3: changelog + commit**

`docs/changelog.md`: a Phase 9F entry — dashboards over databases: widgets (metric/table/chart) with aggregation/grouping/filters + global filters, edit/view mode; HONEST scope (in-JS capped aggregation, no computed-property aggregation, bar/line/donut/number charts, no live updates). Commit:
```bash
pnpm format apps/e2e/dashboards.spec.ts docs/changelog.md
git add apps/e2e/dashboards.spec.ts docs/changelog.md
git commit -m "test(e2e): dashboards — widget render, add-widget, view-only gate

docs(changelog): phase 9f BI dashboards"
```

---

## Self-review notes (plan author)

- **Spec coverage:** §3 models → T1; §4 aggregation service → T2; §5 router → T3; §6 UI (widgets + chart lib + page-type → T4; grid + editor + settings + global filters + launch → T5); §7 invariants distributed (access+object-hiding T2/T3, visibility gate T2, view-only-can't-edit T3, global-filter-compatibility T2, caps T2[rows]+T3[widgets], cross-workspace T3, no-computed-agg T2); §8 tests in each task.
- **Type consistency:** `WidgetDataResult` union + `WidgetConfig` + `WidgetType` (T2 dto) consumed by T3 (`dashboardData`) + T4 (the widgets render the union) + T5 (the settings dialog builds WidgetConfig). `MAX_WIDGET_ROWS` (T2) / `MAX_WIDGETS_PER_DASHBOARD` (T2 dto, enforced T3). The aggregateWidget signature (T2) called by the router (T3).
- **Migration:** schema-to-schema diff, no reset; `\d`/`\dt` verification.
- **Group review** after T3 (schema + aggregation + router — the security/data core: access, visibility, caps, object-hiding) + a final whole-branch review after T6. The access/visibility/view-only/cross-workspace/cap invariants get adversarial attention in the final review.
- **Chart-lib peer pre-verified** (`@mui/x-charts@^9` ↔ `@mui/material@^7.3.11` ↔ react 19; `react-grid-layout@2.2.3`) so T4 Step 1 should resolve cleanly; if `pnpm add` surfaces a peer conflict, that's the signal to recheck the version (don't force).
