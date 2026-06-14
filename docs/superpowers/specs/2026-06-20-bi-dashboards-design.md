# Phase 9F — BI Dashboards over databases — Design

**Status:** approved (design decisions locked via AskUserQuestion 2026-06-14)
**Roadmap:** cl9 Prompt 9.5 (`cl9.md:316-375`). Sixth and **FINAL** cl9 sub-phase (9A✓ 9B✓ 9C✓ 9D✓ 9E✓ — this is 9F). Completing 9F closes cl9 and the entire 9-phase Notion-parity roadmap (cl1–cl9).
**Branch:** `feat/notion-phase-9f-dashboards` off `main@71183cc6`.

## 1. Goal

A dashboard layer over the existing generic databases (Phase 3/4), aligned with Notion's Dashboard/Chart view behavior: a `DASHBOARD` page holds widgets (metric / grouped-aggregation / table / bar / line / donut / number) that each query a database source/view with aggregation + grouping + filters, in an edit-vs-view mode, on a drag-and-drop resizable grid. Dashboard permissions follow the underlying database; hidden properties are not available to widgets.

## 2. Scope (locked)

**In scope:**
- **Models:** `Dashboard` (1:1 with the DASHBOARD page) + `DashboardWidget` (one row per widget) + `DashboardGlobalFilter` (for cross-widget global filters).
- **A new `DASHBOARD` Page.type** (the MEETING 9E page-type template) rendered by a `DashboardPageRenderer`; kept OUT of the generic create grid (created via a "New dashboard" action).
- **Drag-and-drop resizable grid** (react-grid-layout) with **edit mode vs view mode** (the `editable` flag); layout persisted per widget (x/y/w/h).
- **Widget types (all):** metric (single aggregate), grouped-aggregation, table (embed a read-only database table view), bar/line chart, donut/number chart — via `@mui/x-charts`.
- **Query service:** a thin aggregation layer over the existing database read/access stack — source/view, aggregation, grouping, filters, **global filters across compatible widgets**, respecting database access + page-level rules + **property visibility** (widgets reject hidden properties server-side).
- **Performance guardrails:** cap widgets per dashboard; cap rows scanned per widget (honest truncation notice); table widgets paginate; query only what each widget needs.

**Explicitly OUT of scope** (decided / not in 9.5):
- No timeline/gallery widget (table/board/calendar/chart per 9.5; calendar/board widgets MAY reuse the existing view components but are not required for the MVP — metric/grouped/table/bar/line/donut/number are the committed set).
- No making `listRows` itself honor `visibleProperties` (the visibility enforcement is scoped to the dashboard widget query — no repo-wide visibility refactor).
- No new chart types beyond bar/line/donut/number (no scatter/area/heatmap).
- No real-time/live-updating widgets (poll/refetch on demand, like the database views).
- No cross-workspace widgets (a dashboard's widgets source databases in the same workspace).

## 3. Data model

```prisma
model Dashboard {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  pageId      String   @unique @map("page_id") @db.Uuid   // 1:1 with the DASHBOARD page
  title       String   @default("Дашборд")
  createdById String   @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  page      Page      @relation("PageDashboard", fields: [pageId], references: [id], onDelete: Cascade)
  widgets   DashboardWidget[]
  globalFilters DashboardGlobalFilter[]

  @@index([workspaceId])
  @@map("dashboards")
}

enum DashboardWidgetType {
  METRIC          // single aggregate (a "number" stat)
  GROUPED         // grouped aggregation (table of group → value)
  TABLE           // embed a read-only database table view
  BAR             // bar chart over a grouped aggregation
  LINE            // line chart over a grouped aggregation
  DONUT           // donut/pie over a grouped aggregation
  NUMBER          // big-number stat (styled metric)
}

model DashboardWidget {
  id            String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  dashboardId   String              @map("dashboard_id") @db.Uuid
  sourceId      String              @map("source_id") @db.Uuid   // the DatabaseSource it queries
  viewId        String?             @map("view_id") @db.Uuid     // optional base view (inherits its filters/visibleProperties)
  type          DashboardWidgetType
  title         String              @default("")
  config        Json                @default("{}")  // WidgetConfig: { metric:{propertyId|'__count__', aggregation}, groupByPropertyId?, filters?, chartOptions?, tableLimit? }
  // grid layout (react-grid-layout):
  gridX         Int                 @default(0) @map("grid_x")
  gridY         Int                 @default(0) @map("grid_y")
  gridW         Int                 @default(4) @map("grid_w")
  gridH         Int                 @default(4) @map("grid_h")
  position      Int                 @default(0)  // stable tiebreak/order
  createdAt     DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  dashboard Dashboard      @relation(fields: [dashboardId], references: [id], onDelete: Cascade)
  source    DatabaseSource @relation("WidgetSource", fields: [sourceId], references: [id], onDelete: Cascade)
  view      DatabaseView?  @relation("WidgetView", fields: [viewId], references: [id], onDelete: SetNull)

  @@index([dashboardId, position])
  @@map("dashboard_widgets")
}

model DashboardGlobalFilter {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  dashboardId String   @map("dashboard_id") @db.Uuid
  // a global filter targets a property by NAME (so it can apply to any widget whose source has a matching property)
  propertyName String  @map("property_name")
  config      Json     @default("{}")  // { operator, value } — the filter to apply where a compatible property exists
  position    Int      @default(0)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  dashboard Dashboard @relation(fields: [dashboardId], references: [id], onDelete: Cascade)
  @@index([dashboardId])
  @@map("dashboard_global_filters")
}
```
- `Page.type` gains `DASHBOARD`; `Page` gets `dashboard Dashboard? @relation("PageDashboard")` (1:1). `Workspace`/`DatabaseSource`/`DatabaseView` get the obvious back-relations.
- **Global filters match by property NAME** (not id) so a single global filter can apply across widgets sourcing different databases that happen to share a property name + compatible type (the 9.5 "when properties match" semantics). A widget only receives a global filter when its source has a property of that name AND a compatible type; otherwise the filter is ignored for that widget.
- Migration via the shared-DB diff→psql→resolve flow (Prisma 7 `--to-schema`; `psql --single-transaction`; `migrate resolve --applied`).

## 4. Query / aggregation service (reuse the database stack)

A new domain service `packages/domain/src/dashboard/` (or `packages/domain/src/database/services/widget-aggregation.ts`) — a thin layer ON TOP of the existing pipeline, NOT an extension of the pure query-planner:

`aggregateWidget(actorUserId, { sourceId, viewId?, type, config, extraFilters? })`:
1. **Access:** `assertCanRead` on the source's page (reuse `database.service` `assertCanRead` / `requireSource` / the `getBySourceId → assertPageAccess` gate). Dashboard permissions follow the underlying database — a widget that the viewer can't read its source returns a `no_access` widget result (object-hiding, never content).
2. **Visibility gate (net-new, scoped):** resolve the source view's `visibleProperties` (if a `viewId` is given) or the source's full property set; **REJECT** a widget whose `metric.propertyId` or `groupByPropertyId` is NOT visible (a hidden property is "not available" — return a `hidden_property` widget error, never aggregate over it). `__count__` and `__title__` are always available.
3. **Build the query:** merge the view's filters (if `viewId`) + the widget's `config.filters` + the applicable **global filters** (those whose propertyName matches a visible property of compatible type on this source) into a synthetic `ViewSettings`, run `buildRowQuery` (reuse the planner) + `buildRowAccessWhere` (the access pre-filter optimization).
4. **Fetch (capped):** fetch rows via the repo (reuse `findRowsForGrouping`, but **bounded to `MAX_WIDGET_ROWS` = 5000** — add a `take` cap; if more rows match, set `truncated: true`). Apply the authoritative post-filters: `applyMultiSelectPostFilters` + `applyRelationPostFilters` + **`filterViewableRows`** (the row-access authority — per viewer).
5. **Aggregate (in JS, reuse `computed-cells.aggregate`):**
   - METRIC/NUMBER: one reduce over the surviving rows' target-property cell values (or `rows.length` for `__count__`) via `aggregate(config.metric.aggregation, values)`.
   - GROUPED/BAR/LINE/DONUT: bucket rows by `groupByPropertyId`'s cell value (generalize `listGroupedRows`' bucketing to any property type — STATUS/SELECT options, DATE buckets, PERSON, etc.), reduce each bucket's measure via `aggregate()`. Return `{ groups: [{key, label, value}], truncated }`.
   - TABLE: do NOT aggregate — return a paginated row slice (reuse `listRows`/`findRowsPaged`, capped) for the read-only table render.
6. Computed properties (FORMULA/ROLLUP) as a metric/group target require `augmentRows` first (extra batched queries) — for the MVP, **disallow aggregating over computed properties** (reject like a hidden property, with a clear message) to avoid the unbounded augment cost; revisit later.

**Per-widget, per-viewer:** the result is viewer-dependent (row-access rules), so no cross-viewer cache; each widget runs its own access-filtered aggregation.

## 5. tRPC router

`packages/trpc/src/routers/dashboard.ts` (register in index.ts), mirroring the meeting/synced-block routers:
- `create({workspaceId, title?})` → creates the DASHBOARD Page (via `domainSvc.pages.create` type DASHBOARD) + the Dashboard row; returns `{pageId, dashboardId}`.
- `getByPage({pageId})` / `getById({id})` → typed union `{status:'ok'|'no_access'|'not_found', dashboard?, widgets?, globalFilters?, editable?}` (object-hiding; permissions follow the page/workspace access).
- `addWidget({dashboardId, sourceId, type, config?, grid?})` (assert dashboard-page edit access + the source is in the workspace + readable), `updateWidget`, `removeWidget`, `updateLayout({dashboardId, layout:[{id,x,y,w,h}]})` (bulk grid persist), `setGlobalFilters`.
- `widgetData({widgetId})` (or `dashboardData({dashboardId})` returning all widgets' data) → calls `aggregateWidget` per widget; the per-widget object-hiding result. **Caps:** reject `addWidget` beyond `MAX_WIDGETS_PER_DASHBOARD` (e.g. 24).
- All mutations gate on the DASHBOARD page's edit access (a **view-only user cannot edit the layout** — §7); reads gate on page read access.

## 6. UI

- **`DASHBOARD` Page.type** → `page-renderer.tsx` case → `<DashboardPageRenderer pageId editable/>` (dynamic ssr:false; the DATABASE/MEETING precedent). Add DASHBOARD to `isFullBleed` + `pageTypeIcon`/`pageTypeLabel` (a dashboard icon, «Дашборд»), NOT in `CREATABLE_PAGE_TYPES`.
- **DashboardPageRenderer**: loads via `trpc.dashboard.getByPage`; renders the react-grid-layout grid of widgets. **Edit mode** (when `editable`): drag/resize widgets (persist via `updateLayout`), add-widget button (opens the widget-settings dialog), per-widget settings/remove, global-filter bar editor. **View mode**: read-only render, drag/resize disabled. A view/edit toggle (only shown to editors).
- **Widgets** (`apps/web/src/components/dashboard/widgets/`): `MetricWidget`/`NumberWidget` (big stat), `GroupedWidget` (group→value table), `TableWidget` (reuse `DatabaseTableView` editable=false via the getBySourceId pattern), `BarChartWidget`/`LineChartWidget`/`DonutChartWidget` (`@mui/x-charts`, dynamic ssr:false). Each fetches its data via `widgetData`/`dashboardData`; renders a `no_access`/`hidden_property`/`error`/`truncated` state honestly.
- **Widget-settings dialog**: pick source database (reuse `EmbeddedDatabasePicker` / `database.listSources`), pick a base view (optional), choose widget type, the metric property + aggregation (reuse the rollup-config aggregation UI / `RollupAggregation`), the group-by property (reuse `GroupByPicker`), widget filters (reuse `DatabaseFilterBuilder`), chart options. Only VISIBLE, non-computed properties are offered (the visibility gate surfaced in the UI too).
- **Global filter bar**: add/remove global filters (property name + operator + value); applied to compatible widgets.
- **New-dashboard launch**: a "New dashboard" action (sidebar / create entry) → `dashboard.create` → navigate to the page.
- **Chart lib**: `@mui/x-charts@^9` added to apps/web (verified-compatible with `@mui/material@^7.3.11` + react 19; matches the existing `@mui/x-*@^9` packages); each chart loaded via `dynamic(ssr:false)`.

## 7. Security / correctness invariants

1. **Permissions follow the underlying database:** a widget's data is gated by `assertCanRead` on its source's page + the per-row `filterViewableRows` authority (per viewer). A viewer who can't read a source sees a `no_access` widget, never its rows/aggregates.
2. **Hidden properties not available to widgets:** the aggregation service REJECTS a metric/group-by property not in the source view's `visibleProperties` (a `hidden_property` result, never aggregated). Scoped to widgets — does not change `listRows`.
3. **View-only users cannot edit layout/widgets:** all dashboard mutations (addWidget/updateWidget/removeWidget/updateLayout/setGlobalFilters) gate on the DASHBOARD page's EDIT access; a viewer gets FORBIDDEN.
4. **Global filters apply only where compatible:** a global filter targets a property NAME + type; a widget receives it ONLY if its source has a visible property of that name + compatible type — otherwise ignored for that widget (the 9.5 "when properties match" rule). Never silently filters on a mismatched property.
5. **Performance caps:** ≤ `MAX_WIDGETS_PER_DASHBOARD` widgets (addWidget rejects beyond); each widget scans ≤ `MAX_WIDGET_ROWS` rows (truncation surfaced honestly as `truncated:true` + a UI notice); table widgets paginate; no unbounded fetch.
6. **Object-hiding reads:** `getByPage`/`getById`/`widgetData` return typed no_access/not_found (never throw, never content) for unauthorized callers (the synced-block/meeting precedent).
7. **Cross-workspace:** a widget's `sourceId` is verified to belong to the dashboard's workspace at addWidget (no cross-workspace source attach).
8. **No computed-property aggregation in the MVP** (FORMULA/ROLLUP rejected as a metric/group target) — avoids the unbounded augment cost; stated honestly.

## 8. Testing

- **domain (vitest):** `aggregateWidget` — metric over numeric cells (sum/avg/min/max/count), grouped aggregation per group, the visibility gate rejects a hidden property, computed property rejected, the row cap truncates + flags, the access post-filter excludes non-viewable rows (a hidden-row's value not in the aggregate), global-filter-applies-only-on-matching-property. Reuse the database test fixtures.
- **tRPC (vitest, real-DB fixture-scoped):** create makes the DASHBOARD page + Dashboard; addWidget gates on page edit access (view-only → FORBIDDEN) + workspace-source check + the widget cap (rejects beyond MAX); getByPage object-hiding for a non-member; widgetData respects access + hidden properties (a non-member gets no_access; a hidden property → hidden_property); updateLayout persists; removeWidget.
- **web/pure:** the chart-data transform (grouped result → chart series) if extracted; the grid-layout serialization.
- **E2E (Playwright):** `apps/e2e/dashboards.spec.ts` — `signUpAndAuthAs`, seed a DATABASE with rows via Prisma + a DASHBOARD page + a metric widget; open the dashboard → assert the metric value renders; add a widget via the dialog (or seed it); a chart widget renders (assert the chart container/a data point); a view-only user can't see the edit affordances (seed a second member with viewer access, assert no add/drag). Seed-and-assert where the data path is server-side; in-session (no reload). The "hidden property not offered" + "global filter only on matching property" are domain/tRPC-tested (not E2E).

**Proof commands (cl9.md):** `pnpm --filter @repo/trpc test`, `pnpm --filter web lint`, `pnpm check-types`, the Playwright dashboard smoke. Plus the phase's build-first-then-forced-uncached-sweep merge gate + `check-architecture`.

## 9. File structure (finalized in the plan)

- `packages/db/prisma/schema.prisma` — Dashboard/DashboardWidget/DashboardGlobalFilter + DashboardWidgetType + DASHBOARD Page.type + back-relations + migration.
- `packages/domain/src/dashboard/` (or database/services/widget-aggregation.ts) — `aggregateWidget` + the grouping/visibility/cap logic; dto for WidgetConfig/results.
- `packages/trpc/src/routers/dashboard.ts` — the router; register in index.ts.
- `apps/web/src/components/dashboard/` — `DashboardPageRenderer.tsx`, the grid, `widget-settings-dialog.tsx`, `global-filter-bar.tsx`, `widgets/*` (Metric/Number/Grouped/Table/Bar/Line/Donut).
- `apps/web/src/components/page/page-renderer.tsx` + `pages/[pageId]/page.tsx` (isFullBleed) + `page-type-registry.tsx` (icon/label, not creatable) — the DASHBOARD page-type wiring.
- `apps/web/package.json` — add **`@mui/x-charts@^9`** (verified: latest 9.5.0, peer `@mui/material: ^7.3.0 || ^9.0.0` + react 19 — matches the repo's `@mui/material@^7.3.11` and the existing `@mui/x-date-pickers/@mui/x-tree-view@^9`) + **`react-grid-layout`** (verified: 2.2.3, peer `react >= 16.3.0`) (+ `@types/react-grid-layout`); `next.config.js` transpilePackages only if a new @repo package is introduced (react-grid-layout is a node_modules dep — no transpile change; load charts via dynamic ssr:false). NOTE: react-grid-layout ships its CSS (`react-grid-layout/css/styles.css` + `react-resizable/css/styles.css`) which must be imported where the grid mounts.
- the new-dashboard launch entry (sidebar/create).
- `apps/e2e/dashboards.spec.ts`, `docs/changelog.md`.

## 10. Honest limitations (state; don't over-promise)
- Aggregation is in-JS over fetched rows (the EAV/JSON cell model can't push aggregation to Postgres); each widget scans at most MAX_WIDGET_ROWS — a widget over a very large database shows a "first N rows" truncation notice, not a full-database aggregate.
- No aggregation over computed (FORMULA/ROLLUP) properties in the MVP.
- DATE group-by buckets by the **exact** cell value (the full ISO timestamp), so each distinct instant becomes its own bucket — there is no day/week/month rollup and no granularity selector. Grouping a DATE column is only useful when its cells already hold day-granular values; richer date bucketing is deliberately out of scope for this MVP.
- Global filters match by property name + compatible type; they silently skip widgets without a matching property (by design).
- Charts are bar/line/donut/number only; no scatter/area/heatmap.
- No live/real-time updates — widgets refetch on load / on demand.
- react-grid-layout is the drag-resize grid; widgets snap to the grid (no free pixel positioning).
