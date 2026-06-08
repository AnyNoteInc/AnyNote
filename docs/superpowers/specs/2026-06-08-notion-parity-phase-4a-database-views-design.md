# Notion-parity Phase 4A — Database views & layouts

Status: approved design (2026-06-08). Roadmap source: `cl4.md` prompts 4.1 + 4.2.
First of three cl4 sub-phases (4A views/layouts, 4B properties/formulas/relations,
4C access/structure-permissions). Builds on Phase 3 (databases MVP, merged
`e2da53f3`).

## Goal

Turn the single-TABLE database MVP into a multi-view database: multiple independent
views per source, view tabs, filters (nested AND/OR), sorts, grouping, per-view
property visibility, and the BOARD / CALENDAR / LIST layouts alongside TABLE. Fix the
Phase-3 eager-load risk by moving row fetching to a server-side, view-aware, paginated
query.

## Scope (4A only)

IN: multiple views, view CRUD + duplicate, `?viewId=` tabs, typed view settings
(filters/sorts/groupBy/visibleProperties/layout), a domain query planner, the split
`getByPage` (schema) + `listRows` (server-filtered, paginated) fetch, and TABLE /
BOARD / CALENDAR / LIST renderers.

OUT (later sub-phases): full property type set, formulas, relations/rollups (4B);
page-level access rules + structure permissions (4C). TIMELINE/GALLERY/CHART/FEED/MAP/
FORM are roadmap-only (documented in a central registry, NOT added to the enum).
Property **visibility** here is a per-view DISPLAY setting, never a security boundary
(Notion guardrail).

## Data model

One migration: extend the existing enum.

```prisma
enum DatabaseViewType { TABLE BOARD CALENDAR LIST } // +BOARD/CALENDAR/LIST
```

No new tables. `DatabaseView.settings Json?` (currently passed through as `unknown`)
becomes a **typed** blob validated by a zod `viewSettingsSchema` in the domain dto:

```ts
type FilterOperator =
  | 'equals' | 'not_equals' | 'contains' | 'not_contains'
  | 'is_empty' | 'is_not_empty'
  | 'gt' | 'gte' | 'lt' | 'lte'          // number/date
  | 'before' | 'after' | 'on'            // date
  | 'is_checked' | 'is_not_checked'      // checkbox
  | 'is_any_of' | 'is_none_of'           // select/multi_select

type FilterCondition = {
  propertyId: string | '__title__'   // '__title__' = the system Page.title column
  operator: FilterOperator
  value?: unknown                     // shape depends on operator/property type
}
type FilterGroup = {
  conjunction: 'and' | 'or'
  conditions: Array<FilterCondition | FilterGroup>  // nesting allowed
}
type Sort = { propertyId: string | '__title__'; direction: 'asc' | 'desc' }
type ViewSettings = {
  filters?: FilterGroup
  sorts?: Sort[]
  groupBy?: { propertyId: string } | null     // required-ish for BOARD
  visibleProperties?: string[]                 // display-only; null/absent = all
  layout?: {
    datePropertyId?: string   // CALENDAR: which DATE property places rows
    cardProperties?: string[] // BOARD/LIST: which properties show on a card/row
  }
}
```

`updateView.settings` switches from `z.unknown()` to `viewSettingsSchema.optional()`
for server-side validation.

## Domain — query planner + fetch split

A new pure module piece `database/services/query-planner.ts` (no I/O) translates a
`ViewSettings` + the property set into a Prisma `where` (`Prisma.DatabaseRowWhereInput`,
combined with `sourceId` + `deletedAt: null`) and `orderBy`. Rules:
- Title conditions/sorts target the joined item `Page.title`.
- Cell conditions target `cells.some({ propertyId, value <op> })`. Text/number/date use
  JSON value comparisons; SELECT/STATUS use equality on the option id; MULTI_SELECT uses
  a raw `@>`/`?` JSON array predicate (Prisma can't express it — a `$queryRaw` fragment
  or a post-filter for MULTI_SELECT only, documented). `is_empty` = no cell row or null.
- Stable fallback ordering by `DatabaseRow.position` appended to every sort.
- The planner is unit-tested in isolation (settings in → where/orderBy out), no DB.

Service changes:
- `getByPage(actorUserId, pageId)` → returns **schema only**: `{ source, views,
  properties, systemTitleProperty }` (drop `rows`). `assertCanRead`.
- `listRows(actorUserId, { pageId, viewId?, cursor?, limit? })` → resolves the view's
  settings (or defaults), runs the planner, fetches a page of rows + their cells, returns
  `{ rows: DatabaseRowView[], nextCursor: string | null }`. Cursor = the last row's
  `(position, id)`; `limit` default 100, max 200. `assertCanRead`.
- `listGroupedRows(actorUserId, { pageId, viewId })` → for BOARD: returns
  `{ groups: [{ key: optionId|null, label, color, rows }], }` bucketing by the groupBy
  property's option values (+ an empty/null group). Per-group rows are sorted by position.
  `assertCanRead`.
- View CRUD: `createView` (pick type + title; seed sensible default settings — BOARD
  defaults groupBy to the first STATUS/SELECT property; CALENDAR defaults datePropertyId
  to the first DATE property), `updateView` (title + validated settings),
  `deleteView` (still guards the last-view rule; if the view is referenced by an embedded
  block — Phase 3 `embeddedDatabase` node stores viewId — block or warn), `duplicateView`.
- `reorderRows`/`reorderProperties` get wrapped in a single `uow.transaction` (Phase-3
  follow-up the explorer flagged).

## tRPC

`database` router gains/changes: `getByPage` (schema-only now), `listRows({pageId,
viewId?, cursor?, limit?})`, `listGroupedRows({pageId, viewId})`, `duplicateView`,
and `updateView` accepts the typed settings. Reads `assertPageAccess`, writes
`assertPageEditAccess`, all via `mapDomain`. Date inputs via `z.preprocess` (browser has
no superjson). Existing row/cell/property procedures unchanged.

## UI

The renderer stops hard-coding TABLE. New components under
`apps/web/src/components/database/`:

- `database-view-tabs.tsx` — the tab strip (replaces the placeholder chip). Active view
  from `?viewId=` (fallback `views[0]`). Add-view menu (TABLE/BOARD/CALENDAR/LIST),
  rename/delete/duplicate per tab.
- `database-page-renderer.tsx` — reads `getByPage` (schema) + the active view; dispatches
  by `view.type` to `DatabaseTableView | DatabaseBoardView | DatabaseCalendarView |
  DatabaseListView`. Each view fetches its own rows via `listRows`/`listGroupedRows` for
  the active `viewId`. All share the same item-modal (`?rowId=`). Optimistic cell/title
  edits patch the ACTIVE view's `listRows` cache entry (keyed by `pageId+viewId`) and
  invalidate the other views' `listRows` queries for the same source (a cell change can
  reorder/filter a row in/out of another view, so those refetch lazily). The item modal
  edits patch the active view's cache the same way.
- `view-config/database-filter-builder.tsx` — popover building the nested AND/OR
  `FilterGroup` (add condition: property → operator (typed to the property) → value
  editor; add nested group; remove). Writes `view.settings.filters` via `updateView`.
- `view-config/database-sort-builder.tsx` — ordered `{property, direction}` rows. Writes
  `view.settings.sorts`.
- `view-config/property-visibility-panel.tsx` — toggles `visibleProperties`; copy makes
  clear it's display-only, not access control.
- `views/database-board-view.tsx` — columns = derived groups (groupBy property options +
  empty); `@hello-pangea/dnd` drag a card between columns → `updateCellValue` (set the
  group property) + `reorderRows` (position via `positionBetween`, reused from
  `kanban/lib/positions.ts`); compact card showing `layout.cardProperties`. A group-by
  picker in the toolbar.
- `views/database-calendar-view.tsx` — a month grid placing each row on its
  `layout.datePropertyId` day; month nav; click a row → item modal (`?rowId=`);
  reschedule via the modal (drag deferred, documented). Rows without the date value go to
  an "unscheduled" strip.
- `views/database-list-view.tsx` — a compact list of rows with `visibleProperties`.
- `database-toolbar.tsx` — add Filter / Sort / Group-by affordances (open the builders),
  keep the db-local search.

The TABLE view is refactored to consume `listRows` (paginated) instead of the eager
`getByPage` rows, and to respect `visibleProperties`/sorts/filters.

## Testing

domain (unit + a couple real-DB):
- query planner: each operator → expected where; nested AND/OR; sorts; title vs cell;
  MULTI_SELECT predicate; stable position fallback.
- two views over one source with different filters/sorts return different row sets.
- advanced AND/OR semantics preserved.
- `visibleProperties` does NOT delete data and is not treated as ACL (rows/cells still
  returned by the API; only the UI hides columns).
- deleting a view referenced by an embedded block is blocked/warned; last-view delete
  blocked.
- `listGroupedRows` buckets by the groupBy property incl. the empty group.
- `listRows` pagination: cursor returns the next page; stable order.

web/Playwright (focused):
- create a second view (BOARD) on a database → view tab appears, board renders columns.
- board card drag between columns updates the group property value.
- calendar view uses the date property; a row shows on its day.
- list view respects visible properties.
- a filter hides non-matching rows; a sort reorders.

## Checks (cl4A gate)

- `pnpm --filter @repo/domain test` (planner + service)
- `pnpm --filter @repo/trpc test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm check-architecture`
- focused Playwright database-views spec
- migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

One database source supports multiple independent views (table/board/calendar/list)
with server-side filters/sorts/grouping and per-view property visibility; row fetching
is paginated and view-aware (no eager all-rows load); property visibility is a cosmetic
per-view setting, never a security boundary; the Notion-like view roadmap
(timeline/gallery/chart/feed/map/form) is documented but not exposed as broken UI.
