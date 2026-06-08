# Фаза 4. Database advanced: views, properties, formulas, relations, access

## Описание фазы

Эта фаза превращает database MVP в полноценный database engine: multiple views,
board/calendar/list, rich properties, formulas, relations/back relations,
rollups, Notion-like page-level access rules and database/view structure
permissions.

## Полный ожидаемый результат

- One database source can have multiple independent views.
- Views support filters, advanced filter groups, sorts, grouping/sub-grouping,
  property visibility and view-specific settings.
- Table, board, calendar and list views work in this phase; timeline, gallery,
  chart, feed, map and forms are represented in the view roadmap without
  forcing all of them into the first implementation slice.
- Property types include title/text, status, number, select, multi-select,
  checkbox, URL/internal AnyNote link, email, phone, date with range/time/reminder,
  person/people, files/media, relation, rollup and formula-related settings.
- Formula property is evaluated by a safe deterministic engine.
- Relations and back relations connect rows across database sources; rollups can
  aggregate related row properties.
- Page-level access rules based on person/created-by properties are enforced
  server-side across API, UI, search, export, public share and embedded/linked
  views.
- Database/view structure permissions distinguish content editing from structure
  editing, including a lock mode for views/properties.

## Notion alignment guardrails

- Property visibility is a per-view display setting, not a security boundary.
  Do not model Notion parity as property-level ACL.
- If true property-level ACL is ever wanted, mark it as an AnyNote extension in a
  later phase and keep it separate from Notion compatibility.
- Notion-like sensitive data control is page-level access: assign access levels
  to people mentioned in person or created-by properties, and apply those rules
  across all views and linked/embedded views.
- Preserve permission levels including `Can view`, `Can comment`,
  `Can edit content`, `Can edit` and `Full access`. `Can edit content` may
  create/edit database pages and property values, but cannot change properties,
  views, filters, sorts or database structure.
- Database lock/view structure lock prevents structural edits while still
  allowing permitted content entry.
- Broadest access wins when direct page/database/workspace access and page-level
  rules overlap.

## Scope и ограничения

This phase assumes generic database MVP exists. It must prioritize server-side
page access enforcement over visual hiding. Formula engine must not execute
arbitrary JavaScript or access runtime/global APIs. Keep the implementation
staged: ship core data modeling and core views first, then leave heavier Notion
analogs such as charts, maps, feed and forms as explicit follow-up slices unless
the prompt below says otherwise.

## Рабочее задание фазы

Цель: довести generic databases до practical Notion-like уровня for AnyNote:
views, property types, formulas, relations/backlinks, rollups, page-level access
rules, structure permissions and date reminders.

## Prompt 4.1 - multiple views, filters, sorts

```text
Цель: добавить independent views over one database source.

Ориентиры по коду и текущей реализации:
- database schema/router/components from Phase 3
- apps/web/src/components/kanban/views for layout ideas

Сделай:
1. Расширь DatabaseView.settings:
   - filters;
   - advanced filter groups with AND/OR nesting;
   - sorts;
   - visibleProperties;
   - grouping;
   - subGrouping if feasible;
   - openPageMode side/center/full where it fits AnyNote UX;
   - view-specific options.
2. Добавь UI:
   - `DatabaseViewTabs`;
   - create/rename/delete/duplicate view;
   - filter builder;
   - sort builder;
   - property visibility panel.
3. Добавь query planner in domain:
   - typed filtering;
   - typed sorting;
   - typed grouping;
   - stable row order fallback.
4. Tests:
   - two views same source, different filters/sorts;
   - advanced filters preserve AND/OR semantics;
   - deleting view embedded elsewhere is blocked or warns;
   - visibility settings don't delete data and are not treated as ACL.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- One source can have multiple independent table views.
```

## Prompt 4.2 - core database view layouts and view roadmap

```text
Цель: добавить core view types TABLE, BOARD, CALENDAR, LIST and keep the view
registry compatible with Notion-like follow-ups.

Ориентиры по коду и текущей реализации:
- Phase 4.1 view settings
- apps/web/src/components/kanban/views/board-view.tsx
- apps/web/src/components/kanban/views/table-view.tsx
- apps/web/src/components/kanban/views/gantt-view.tsx only for date patterns

Сделай:
1. Добавь `DatabaseBoardView`:
   - group by status/select/person property;
   - drag card between groups updates cell value;
   - compact card properties.
2. Добавь `DatabaseCalendarView`:
   - choose date property;
   - show rows as events;
   - drag/reschedule if feasible, otherwise edit through row modal.
3. Добавь `DatabaseListView`:
   - compact list with selected properties.
4. Добавь view creation menu:
   - enabled now: table, board, calendar, list;
   - roadmap/deferred entries or central metadata for timeline, gallery, chart,
     feed, map and form without exposing broken UI.
5. Capture follow-up constraints in code comments/docs near the registry:
   - timeline needs date range layout;
   - gallery needs cover/files/media display;
   - chart is read-oriented aggregates with drilldown table, not inline editing;
   - feed is stacked cards with comments/views;
   - map requires a place/location property and item limits;
   - form is an intake surface connected to a database, not a normal row browser.
6. Tests:
   - create each view type;
   - board group change updates property;
   - calendar uses date property;
   - list respects visible properties.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- focused Playwright database views spec

Критерий готовности:
- Database views cover table/board/calendar/list product scenarios, and the
  Notion-like availability roadmap is explicit but staged.
```

## Prompt 4.3 - full property type set and cell settings

```text
Цель: расширить property system до Notion-like набора, with AnyNote-specific
internal links where useful.

Ориентиры по коду и текущей реализации:
- DatabasePropertyType enum
- current cell editors

Сделай:
1. Add/finish property types:
   - title/name for database page rows if not already modeled;
   - text;
   - status;
   - number;
   - select;
   - multi-select;
   - checkbox;
   - URL;
   - internal AnyNote document/page link as an AnyNote extension;
   - email;
   - phone;
   - date start/end/time/reminder;
   - person/people;
   - files/media;
   - created time/created by/last edited time/last edited by as readonly
     metadata if MVP lacks them.
   Reserve formula, relation and rollup property type slots for Prompts 4.4
   and 4.5 rather than implementing them ad hoc here.
2. Add settings UIs:
   - select/status options and colors;
   - number format percent/currency/separators;
   - date options;
   - person picker;
   - file picker/uploader.
3. Add safe type conversion behavior:
   - preview data loss where possible;
   - confirm destructive conversion.
4. Add conservative limits/validation:
   - cap total properties per database source if the product needs one;
   - validate URLs/email/phone/date shapes server-side.
5. Tests:
   - each type can be created/edited/rendered;
   - invalid values rejected in API;
   - type conversion respects warnings.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- Playwright property editors spec

Критерий готовности:
- Users can model real tables without falling back to text columns.
```

## Prompt 4.4 - formula engine MVP

```text
Цель: добавить formula property без выполнения небезопасного arbitrary JS.

Ориентиры по коду и текущей реализации:
- DatabaseProperty/CellValue models
- existing expression/parser libraries in package.json, if any

Сделай:
1. Спроектируй safe formula DSL MVP:
   - literals: string, number, boolean, date;
   - property references with a Notion-inspired `prop("Name")` or equivalent
     syntax;
   - functions: if, empty, concat, dateAdd, dateDiff/dateBetween, formatDate,
     round, min/max, sum for lists if supported;
   - operators: + - * / comparisons and boolean logic;
   - explicit unsupported-function errors for anything outside the MVP.
2. Реализуй parser/evaluator in domain package.
3. Добавь dependency graph:
   - formula depends on properties;
   - recalculation on cell/property change.
4. Cache result:
   - FormulaEvaluationResult or cell value with error state.
5. UI:
   - FormulaEditor;
   - validation preview;
   - FormulaErrorBadge.
6. Tests:
   - formulas compute;
   - errors are stored/displayed;
   - cycles are rejected;
   - sandbox cannot access runtime/global APIs.

Проверки:
- pnpm --filter @repo/domain test if available
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Formula property is useful and safe, even if smaller than Notion formulas.
```

## Prompt 4.5 - relations, back relations and rollups

```text
Цель: связать rows разных database sources and add Notion-like rollups over
relations.

Ориентиры по коду и текущей реализации:
- Database models/router
- access resolver plan

Сделай:
1. Добавь relation property settings:
   - targetSourceId;
   - cardinality single/no limit;
   - two-way/back relation toggle;
   - display options including which related page properties are shown.
2. Добавь relation value storage:
   - rowId -> targetRowId links.
3. Добавь optional back relation:
   - mirrored property metadata;
   - sync service.
4. Добавь rollup property:
   - relationPropertyId;
   - targetPropertyId;
   - aggregation showOriginal, countAll, countValues, countEmpty,
     countNotEmpty, percentEmpty, percentNotEmpty, sum, average, min, max,
     earliestDate, latestDate where types allow;
   - number/date formatting where feasible.
5. UI:
   - RelationPropertySettings;
   - RelationPicker;
   - RelatedRowChip;
   - BackRelationToggle.
   - RollupPropertySettings;
   - readonly RollupCellRenderer.
6. Access:
   - related row visible only if viewer has access;
   - rollup only includes related rows/properties visible to the viewer;
   - public share behavior explicit.
7. Tests:
   - relation add/remove;
   - back relation sync;
   - rollup calculations and type restrictions;
   - target row access restrictions.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Relations behave as typed links, not plain text references, and rollups give
  safe aggregate views over accessible related rows.
```

## Prompt 4.6 - page-level access and structure permissions

```text
Цель: добавить Notion-like database page-level access rules and structure
permissions. Do not implement property-level ACL in this phase.

Ориентиры по коду и текущей реализации:
- database router/query planner/export/search code
- existing workspace/page permission resolver
- share/public/embedded view behavior

Сделай:
1. Добавь model for page-level access rules, например
   `DatabasePageAccessRule`:
   - sourceId;
   - propertyId limited to person/people or createdBy properties;
   - accessLevel: canView/canComment/canEditContent/canEdit/fullAccess;
   - enabled flag and audit timestamps.
2. Добавь resolver:
   - direct page/database/workspace permissions;
   - page-level rules from person/created-by cell values;
   - broadest-access-wins semantics;
   - source database only for configuring rules, not arbitrary linked views.
3. Enforce page visibility and mutation rights in:
   - read/list/detail API;
   - create/update/delete row APIs;
   - search indexing;
   - export;
   - public share;
   - embedded/linked views;
   - relation and rollup traversal.
4. Add structure permissions:
   - `Can edit content` can create/edit database pages and property values;
   - `Can edit`/`Full access` can change properties, views, filters, sorts and
     structure;
   - lock database/view structure blocks property/view/filter/sort/layout
     changes while allowing permitted content edits.
5. UI:
   - Share/PageLevelAccess section for choosing person/created-by property and
     access level;
   - DatabaseLockToggle or structure-lock control;
   - disabled affordances with permission-aware messages;
   - property visibility panel remains display-only and must not imply security.
6. Tests:
   - assigned/created-by user gains intended access to matching rows;
   - unassigned rows are hidden from API/list/search/export for restricted users;
   - linked/embedded views obey the same page-level rules;
   - property visibility does not remove accessible property data from API;
   - `Can edit content` can edit values but cannot change view/property structure;
   - lock database blocks structure changes but not allowed content edits;
   - relation/rollup traversal does not leak inaccessible target rows;
   - owner/admin/broader access behavior matches broadest-access-wins decision.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Sensitive database content is controlled with server-side page-level access
  and structure permissions, while property visibility remains a cosmetic
  view setting.
```
