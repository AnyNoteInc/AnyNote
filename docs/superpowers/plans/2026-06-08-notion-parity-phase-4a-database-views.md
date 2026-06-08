# Notion-parity Phase 4A — Database Views & Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-TABLE database into a multi-view database with view tabs, server-side filters/sorts/grouping, per-view property visibility, and TABLE/BOARD/CALENDAR/LIST layouts — moving row fetching to a paginated, view-aware query.

**Architecture:** Add BOARD/CALENDAR/LIST to the view enum. Type `DatabaseView.settings` (filters/sorts/groupBy/visibleProperties/layout). A pure domain `query-planner.ts` translates settings → Prisma where/orderBy (unit-tested, no I/O). Split `getByPage` (schema only) from new `listRows`/`listGroupedRows` (server-filtered, paginated). The renderer dispatches by active view type (`?viewId=`); each layout fetches its own rows; all share the item modal and an optimistic cache.

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8, Next.js 16, MUI v6, @hello-pangea/dnd, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-08-notion-parity-phase-4a-database-views-design.md`

**Reference patterns (study first):** Phase-3 database module `packages/domain/src/database/` (dto/service/repository — the eager `findSourceByPageId`, `validateCellValue`, `getByPage`, access helpers `assertCanRead`/`assertCanEdit`), `packages/trpc/src/routers/database/*`, `apps/web/src/components/database/*` (`database-page-renderer.tsx` line ~81 hard-codes `DatabaseTableView`; `database-toolbar.tsx` line ~86 view-selector placeholder; `cell-editors/use-optimistic-cell.ts`), kanban board DnD `apps/web/src/components/kanban/views/board-view.tsx` + `kanban/lib/positions.ts` (`positionBetween`).

---

## File Structure

**Created:**
- `packages/domain/src/database/services/query-planner.ts` — pure settings→where/orderBy.
- `packages/domain/test/database/services/query-planner.test.ts`.
- `apps/web/src/components/database/database-view-tabs.tsx`.
- `apps/web/src/components/database/view-config/{database-filter-builder,database-sort-builder,property-visibility-panel,group-by-picker}.tsx`.
- `apps/web/src/components/database/views/{database-board-view,database-calendar-view,database-list-view}.tsx`.
- `apps/web/src/components/database/use-view-rows.ts` (the listRows hook + optimistic helpers).
- `packages/trpc/test/database-views.test.ts`, `apps/e2e/database-views.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` + migration.
- `packages/domain/src/database/dto/database.dto.ts` (viewSettingsSchema + listRows/grouped DTOs + duplicateView input).
- `packages/domain/src/database/services/database.service.ts` (getByPage schema-only, listRows, listGroupedRows, duplicateView, tx-wrap reorders, default-settings on createView).
- `packages/domain/src/database/repositories/database.repository.ts` (paginated row fetch with where/orderBy, grouped fetch, schema-only source load).
- `packages/trpc/src/routers/database/{source,view,row}.ts` (getByPage schema-only, listRows, listGroupedRows, duplicateView).
- `apps/web/src/components/database/database-page-renderer.tsx` (view dispatch + `?viewId=`), `database-table-view.tsx` (consume listRows + visibleProperties/sorts), `database-toolbar.tsx` (filter/sort/group affordances), `types.ts`.

---

## Phase A — Schema + view settings types

### Task A1: Enum migration (BOARD/CALENDAR/LIST)

**Files:** Modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<ts>_database_view_types/migration.sql`.

- [ ] **Step 1:** Change `enum DatabaseViewType { TABLE }` → `enum DatabaseViewType { TABLE BOARD CALENDAR LIST }`.
- [ ] **Step 2:** `pnpm --filter @repo/db exec prisma validate` → valid.
- [ ] **Step 3:** Generate migration on a FRESH scratch DB (never shared): `docker exec anynote-postgres-1 psql -U user -d anynote -c "CREATE DATABASE anynote_p4a_scratch;"`, `DATABASE_URL=...anynote_p4a_scratch pnpm exec prisma migrate deploy`, then `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → `packages/db/prisma/migrations/20260608140000_database_view_types/migration.sql` (should be `ALTER TYPE "DatabaseViewType" ADD VALUE 'BOARD'` ×3). NOTE: Postgres can't add enum values inside a transaction that also uses them; the generated `ALTER TYPE ... ADD VALUE` migration is fine standalone.
- [ ] **Step 4:** Re-deploy fresh + `migrate diff ... --exit-code` → "No difference detected". Apply the same DDL additively to the shared dev DB (`docker exec ... psql < migration.sql`, each `ALTER TYPE ADD VALUE IF NOT EXISTS`). Drop scratch.
- [ ] **Step 5:** `prisma generate`; commit `feat(db): database view types BOARD/CALENDAR/LIST`.

### Task A2: viewSettingsSchema + listRows/grouped/duplicate DTOs

**Files:** Modify `packages/domain/src/database/dto/database.dto.ts`.

- [ ] **Step 1:** Add the zod `viewSettingsSchema` exactly per the spec (FilterOperator enum, FilterCondition, recursive FilterGroup via `z.lazy`, Sort, ViewSettings with filters/sorts/groupBy/visibleProperties/layout). Export the inferred types `ViewSettings`, `FilterGroup`, `FilterCondition`, `Sort`, `FilterOperator`.
- [ ] **Step 2:** Change `updateViewInput.settings` from `z.unknown().optional()` to `viewSettingsSchema.optional()`.
- [ ] **Step 3:** Add `listRowsInput = z.object({ pageId: uuid, viewId: uuid.optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(200).default(100) })`; `listGroupedRowsInput = z.object({ pageId: uuid, viewId: uuid })`; `duplicateViewInput = z.object({ pageId: uuid, viewId: uuid })`. Add view-model types `ListRowsResult { rows: DatabaseRowView[]; nextCursor: string | null }` and `GroupedRowsResult { groups: Array<{ key: string | null; label: string; color: string | null; rows: DatabaseRowView[] }> }`.
- [ ] **Step 4:** `pnpm --filter @repo/domain check-types` → pass.
- [ ] **Step 5:** Commit `feat(domain): typed view settings + listRows/grouped/duplicate DTOs`.

---

## Phase B — Query planner (pure, TDD)

### Task B1: query-planner where/orderBy builder

**Files:** Create `packages/domain/src/database/services/query-planner.ts`; test `packages/domain/test/database/services/query-planner.test.ts`.

- [ ] **Step 1: Write failing tests.** The planner exports `buildRowQuery(settings: ViewSettings, properties: PropertyMeta[]): { where: Prisma.DatabaseRowWhereInput; orderBy: Prisma.DatabaseRowOrderByWithRelationInput[]; multiSelectPostFilters: Array<{propertyId, op, optionIds}> }` where `PropertyMeta = { id, type }`. Tests (settings in → structure out, no DB):
  - empty settings → `where` is just `{}` (caller adds sourceId/deletedAt), `orderBy` = `[{ position: 'asc' }]`.
  - a TEXT `contains` condition on a propertyId → `where.cells = { some: { propertyId, value: <string_contains-ish> } }` (assert the shape your repo will consume — define a stable intermediate shape).
  - a `__title__` `contains` → `where.page = { is: { title: { contains, mode: 'insensitive' } } }`.
  - a NUMBER `gt` → numeric JSON comparison shape.
  - a CHECKBOX `is_checked` → value equals true.
  - `is_empty` → `{ OR: [ { cells: { none: { propertyId } } }, { cells: { some: { propertyId, value: <null> } } } ] }`.
  - nested AND/OR group → nested `AND`/`OR` arrays preserved.
  - MULTI_SELECT `is_any_of` → NOT in `where`; instead returned in `multiSelectPostFilters` (Prisma can't express JSON array containment portably; document the post-filter).
  - sorts: `[{propertyId, asc}]` → orderBy on the cell value, with `{ position: 'asc' }` ALWAYS appended last as the stable tiebreak. `__title__` sort → `{ page: { title: dir } }`.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test query-planner` → FAIL.
- [ ] **Step 3:** Implement `buildRowQuery`. Pure functions, no Prisma client — only build the `where`/`orderBy` plain objects (typed against `Prisma.DatabaseRowWhereInput`). Map each operator per the property's type. Collect MULTI_SELECT conditions into `multiSelectPostFilters` instead of `where`. Always append `{ position: 'asc' }` to orderBy.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): database view query planner (filters/sorts → prisma)`.

---

## Phase C — Service + repository fetch split

### Task C1: repository — schema-only load + paginated/grouped row fetch

**Files:** Modify `packages/domain/src/database/repositories/database.repository.ts`. Test: extend `packages/domain/test/database/...` if repo has unit coverage, else covered via C2 service tests.

- [ ] **Step 1:** Add `findSourceSchemaByPageId(pageId)` — like `findSourceByPageId` but WITHOUT rows (source + views + properties only). Keep the old method temporarily for callers not yet migrated, or migrate them in C2.
- [ ] **Step 2:** Add `findRowsPaged({ sourceId, where, orderBy, take, cursorRow })` — applies the planner's `where` (merged with `{ sourceId, deletedAt: null }`) + `orderBy`, `take: limit + 1`, cursor via `(position, id)`; returns rows + cells. Returns `take+1` so the service can compute `nextCursor`.
- [ ] **Step 3:** Add `findRowsForGrouping({ sourceId, where })` — fetch all matching rows + cells (board groups need the full filtered set; board is bounded by being a focused view — document the no-pagination-for-board MVP limit). Wrap `reorderRows`/`reorderProperties` loops in `this.uow.transaction`.
- [ ] **Step 4:** `pnpm --filter @repo/domain check-types` → pass.
- [ ] **Step 5:** Commit `feat(domain): database repo — schema-only load + paged/grouped row fetch`.

### Task C2: service — getByPage schema-only, listRows, listGroupedRows, duplicateView, default settings

**Files:** Modify `packages/domain/src/database/services/database.service.ts`; test `packages/domain/test/database/services/database.service.test.ts`.

- [ ] **Step 1: Failing tests** (mock repo + planner): `getByPage` returns no `rows` key (schema only: source/views/properties/systemTitleProperty); `listRows` calls the planner with the view's settings and returns `{ rows, nextCursor }` (nextCursor null when fewer than limit, set when more); `listGroupedRows` buckets rows by the groupBy property's options + an empty group; `createView` seeds default settings (BOARD → groupBy first STATUS/SELECT; CALENDAR → datePropertyId first DATE); `duplicateView` copies title+settings+type at the next position; MULTI_SELECT post-filters from the planner are applied to the fetched rows.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test database` → FAIL.
- [ ] **Step 3:** Implement. `getByPage` → `findSourceSchemaByPageId` (drop rows). `listRows(actor, {pageId, viewId, cursor, limit})` → assertCanRead, resolve the view (or a default TABLE settings), `buildRowQuery`, `findRowsPaged`, apply `multiSelectPostFilters` in JS, slice to `limit`, compute `nextCursor`. `listGroupedRows` → buildRowQuery (filters only), `findRowsForGrouping`, bucket by groupBy option ids (+ null group), sort each bucket by position. `createView` seeds defaults. `duplicateView`. assertCanEdit on writes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): getByPage schema-only + listRows/grouped/duplicateView`.

---

## Phase D — tRPC

### Task D1: router — getByPage schema-only, listRows, listGroupedRows, duplicateView

**Files:** Modify `packages/trpc/src/routers/database/{source,view,row}.ts`. Test: `packages/trpc/test/database-views.test.ts` (+ fix any existing database test that asserted getByPage returns rows).

- [ ] **Step 1: Failing integration tests** (self-contained real-DB fixtures, study `database-router.test.ts`): `getByPage` no longer returns rows; `listRows({pageId})` returns rows for the default view; two views with different filters return different sets; `listRows` pagination cursor returns the next page; `listGroupedRows` buckets by groupBy; `duplicateView` creates a copy; `updateView` accepts typed settings and rejects malformed ones; deleting the last view blocked; deleting a view referenced by an `embeddedDatabase` block is blocked/warned (create a TEXT page whose content JSON references the viewId).
- [ ] **Step 2:** Run `pnpm --filter @repo/trpc test database` → FAIL (existing getByPage-with-rows tests now red too — that's expected; update them).
- [ ] **Step 3:** Implement: `getByPage` returns schema-only; add `listRows`, `listGroupedRows`, `duplicateView`; `updateView` uses `viewSettingsSchema`. Update the Phase-3 `database-router.test.ts`/`database-rows.test.ts` assertions that expected `getByPage().rows` to use `listRows` instead. Reads `assertPageAccess`, writes `assertPageEditAccess`.
- [ ] **Step 4:** Run `pnpm --filter @repo/trpc test database` → PASS.
- [ ] **Step 5:** Commit `feat(trpc): database listRows/grouped/duplicateView; getByPage schema-only`.

---

## Phase E — UI: view tabs + dispatch + table refactor

### Task E1: use-view-rows hook + view tabs + renderer dispatch

**Files:** Create `apps/web/src/components/database/use-view-rows.ts`, `database-view-tabs.tsx`; modify `database-page-renderer.tsx`, `types.ts`.

- [ ] **Step 1:** `use-view-rows.ts` — a hook `useViewRows(pageId, viewId)` wrapping `trpc.database.listRows.useInfiniteQuery` (or paginated query) + an `optimisticPatchCell(rowId, propertyId, value)` that patches the active view's cache and invalidates sibling views' `listRows`. Export a `useGroupedRows(pageId, viewId)` for board.
- [ ] **Step 2:** `database-view-tabs.tsx` — tab strip from `data.views`, active from `?viewId=` (fallback `views[0].id`), an add-view menu (TABLE/BOARD/CALENDAR/LIST → `createView`), per-tab rename (`updateView`)/delete (`deleteView`, guard last)/duplicate (`duplicateView`). Sets `?viewId=` via `router.replace`.
- [ ] **Step 3:** `database-page-renderer.tsx` — read `getByPage` (schema), resolve the active view from `?viewId=`, render `<DatabaseViewTabs/>` + dispatch by `view.type` to the four view components (Table built in E2; Board/Calendar/List in Phase F — stub them as "coming" placeholders that still compile for this task, filled in F).
- [ ] **Step 4:** `pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 5:** Commit `feat(web): database view tabs + ?viewId= dispatch + useViewRows`.

### Task E2: TABLE view consumes listRows + visibleProperties/sorts/filters builders

**Files:** Modify `database-table-view.tsx`, `database-toolbar.tsx`; create `view-config/{database-filter-builder,database-sort-builder,property-visibility-panel}.tsx`.

- [ ] **Step 1:** Refactor `DatabaseTableView` to fetch rows via `useViewRows(pageId, viewId)` (paginated; "load more" or infinite scroll) instead of `data.rows`; respect `view.settings.visibleProperties` (column visibility) and rely on server-applied sorts/filters. Cells still edit via the optimistic patch.
- [ ] **Step 2:** Build `DatabaseFilterBuilder` (popover → nested AND/OR `FilterGroup`: add condition [property→operator typed to the property's type→value editor], add nested group, remove; writes `view.settings.filters` via `updateView`), `DatabaseSortBuilder` (ordered {property,direction}; writes `sorts`), `PropertyVisibilityPanel` (toggles `visibleProperties`; copy: "влияет только на отображение"). Wire Filter/Sort/Properties buttons into `database-toolbar.tsx`.
- [ ] **Step 3:** Update any web test referencing the old table data flow. `pnpm check-types && pnpm --filter web lint && pnpm --filter web test` → pass.
- [ ] **Step 4:** Commit `feat(web): table view via listRows + filter/sort/visibility builders`.

---

## Phase F — UI: board / calendar / list layouts

### Task F1: DatabaseBoardView

**Files:** Create `apps/web/src/components/database/views/database-board-view.tsx`, `view-config/group-by-picker.tsx`.

- [ ] **Step 1:** `DatabaseBoardView` — `useGroupedRows(pageId, viewId)`; columns = the groupBy property's options (from `property.settings.options`) + an "empty" column; `@hello-pangea/dnd` `DragDropContext`/`Droppable` per column/`Draggable` per card. On drag end: optimistically patch + `updateCellValue` to set the group property to the destination column's option id, and `reorderRows` for position (reuse `positionBetween` from `kanban/lib/positions.ts`). Compact card shows `layout.cardProperties` (default: title + groupBy). A `GroupByPicker` in the toolbar writes `settings.groupBy`. If no groupBy set, prompt to pick one.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 3:** Commit `feat(web): database board view (derived groups + drag)`.

### Task F2: DatabaseCalendarView + DatabaseListView

**Files:** Create `apps/web/src/components/database/views/{database-calendar-view,database-list-view}.tsx`.

- [ ] **Step 1:** `DatabaseCalendarView` — `useViewRows`; a month grid (build with date-fns + MUI Box grid, or MUI `DateCalendar` for nav) placing each row on its `layout.datePropertyId` date cell; rows without the date go to an "Без даты" strip; click a row → set `?rowId=` (item modal); month prev/next nav. A date-property picker in the toolbar writes `layout.datePropertyId`. Drag-to-reschedule deferred (documented comment).
- [ ] **Step 2:** `DatabaseListView` — `useViewRows`; a compact vertical list, each row showing title + `visibleProperties` values; click → `?rowId=`.
- [ ] **Step 3:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test` → pass. `set -a; . ./.env; set +a; pnpm --filter web build` → exit 0 (RSC boundary check).
- [ ] **Step 4:** Commit `feat(web): database calendar + list views`.

---

## Phase G — E2E + gate

### Task G1: Playwright database-views spec

**Files:** Create `apps/e2e/database-views.spec.ts`.

- [ ] **Step 1:** Using `signUpAndAuthAs` + the warmed create-page flow (adapt the `createWorkspaceAndTextPage` helper to create a DATABASE page — see `apps/e2e/database-mvp.spec.ts`): create a DATABASE page, add a BOARD view via the view tabs → board renders columns from the STATUS property; add a row, drag it (or via cell edit assert the group changes — drag is flaky in headless; assert the simplest reliable proxy: create a row, set its status via the board/table, assert it lands in the right column); add a CALENDAR view → a dated row shows on its day; add a filter in TABLE → a non-matching row hides. Note the no-yjs constraint (assert tRPC-backed state).
- [ ] **Step 2:** `pnpm exec playwright test apps/e2e/database-views.spec.ts --retries 1` → pass.
- [ ] **Step 3:** Commit `test(e2e): database views — board/calendar/list/filter`.

### Task G2: Full gate + changelog

- [ ] **Step 1:** `pnpm check-types` (22/22), `pnpm lint`, `pnpm check-architecture`, `pnpm --filter @repo/domain test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web test`, `pnpm --filter engines test` → all pass.
- [ ] **Step 2:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 3:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 4:** Update `docs/changelog.md` (Базы данных: представления). Commit.

---

## Self-review notes

- Spec coverage: A1–A2 = enum + settings types; B1 = query planner (4.1 filters/sorts); C1–C2 = fetch split + listRows/grouped/duplicate (4.1); D1 = tRPC; E1–E2 = view tabs + table refactor + filter/sort/visibility builders (4.1); F1–F2 = board/calendar/list (4.2); G = e2e + gate.
- The fetch split (getByPage schema-only) BREAKS the Phase-3 `getByPage().rows` consumers — D1 step 3 + E2 explicitly update those tests/components. This is the riskiest change; it's called out.
- MULTI_SELECT filtering is handled via planner `multiSelectPostFilters` (Prisma can't express JSON array containment portably) — applied in the service after fetch; documented as a known scaling caveat for MULTI_SELECT-heavy filters.
- Board has no row pagination in MVP (`findRowsForGrouping` fetches the filtered set) — documented limit; a focused board view is bounded in practice.
- Type consistency: `ViewSettings`/`FilterGroup`/`Sort` defined in A2 used by B1/C2/E2; `ListRowsResult { rows, nextCursor }` and `GroupedRowsResult { groups: [{key,label,color,rows}] }` consistent across C2/D1/E1/F1; `buildRowQuery(...) → { where, orderBy, multiSelectPostFilters }` consistent B1/C2.
- Property visibility is display-only everywhere (tests assert the API still returns all cells); never an ACL.
