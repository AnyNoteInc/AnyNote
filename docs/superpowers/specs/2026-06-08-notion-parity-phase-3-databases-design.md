# Notion-parity Phase 3 — Generic databases MVP

Status: approved design (2026-06-08). Roadmap source: `cl3.md`. Builds on Phase 1
(collections/private/archive) and Phase 2 (public sharing), both merged to main.

## Goal

Bring `PageType.DATABASE` to life as a Notion-like database page: the database is an
AnyNote `Page`, its data source is a collection of **item pages** (each a real
`Page`), and a table view displays/edits that collection. MVP delivers: a database
source, a TABLE view, properties, page-backed rows, cell editing, an item-page
peek/modal, and an embedded database view inside TEXT pages. Kanban stays a separate
module and must not regress; Task models are NOT reused as database rows.

## Key architectural decisions

- **Every database item is a real `Page`.** The required Title/Name column reads/writes
  `Page.title`; the item body uses the existing `Page.content`/`Page.contentYjs` and
  the existing page editor. A `DatabaseRow` is a membership/order **bridge only** — no
  body fields on it.
- **Item pages are children of the DATABASE page, hidden from the normal tree/search.**
  Item pages have `parentId = <database page id>`. List/search/tree queries exclude
  pages whose parent is a DATABASE page (Notion: rows are pages but don't clutter the
  sidebar). This filter lives next to `buildPageVisibilityWhere`.
- **Provisioning mirrors Kanban exactly.** `createPageTx` already type-dispatches
  (`if type === KANBAN → onKanban(pageId)`). DATABASE slots in the same way:
  `PageService` gains a `DatabaseService` dependency and provisions a source + default
  TABLE view + a couple default properties on DATABASE page create, all in the same
  transaction.
- **Cell storage = one JSON value per (row, property).** `DatabaseCellValue.value Json`.
  Each type serializes into it (string/number/bool/ISO-date/option-id/[option-ids]/
  userId/fileId). Type-specific validation in the domain.
- **Select/status options live in `DatabaseProperty.settings` JSON** (`{ options: [{ id,
  label, color }] }`). No separate option table in the MVP.
- **One source/view model renders both surfaces.** The full-page DATABASE route and the
  embedded block render the same `{ source, views, properties, rows }` view-model.

## Scope and limits

MVP: one data source per database page, TABLE view, page-backed rows, foundational
property types (TEXT, NUMBER, STATUS, SELECT, MULTI_SELECT, CHECKBOX, DATE, PERSON,
FILE). Deferred to cl4: multiple views, board/calendar/list, filters/sorts/grouping,
formulas, relations, rollups, item templates, page-level ACL. Database-local search is
scoped to the current database's item titles + cell values — never global workspace
search. True property-level ACL is NOT Notion parity and is out of scope.

## Data model

One Prisma migration. New enums + models:

```prisma
enum DatabaseViewType { TABLE } // BOARD|CALENDAR|LIST reserved for cl4

enum DatabasePropertyType {
  TEXT NUMBER STATUS SELECT MULTI_SELECT CHECKBOX DATE PERSON FILE
}

model DatabaseSource {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  pageId      String   @unique @map("page_id") @db.Uuid // the owning DATABASE page
  title       String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  workspace   Workspace @relation(...)
  page        Page      @relation("DatabaseSourcePage", fields: [pageId], references: [id], onDelete: Cascade)
  views       DatabaseView[]
  properties  DatabaseProperty[]
  rows        DatabaseRow[]
  @@index([workspaceId])
  @@map("database_sources")
}

model DatabaseView {
  id        String           @id ...
  sourceId  String           @map("source_id") @db.Uuid
  type      DatabaseViewType @default(TABLE)
  title     String           @db.Text
  position  Int              @default(0)
  settings  Json?            // view-specific (filters/sorts reserved for cl4)
  source    DatabaseSource   @relation(..., onDelete: Cascade)
  @@index([sourceId])
  @@map("database_views")
}

model DatabaseProperty {
  id        String               @id ...
  sourceId  String               @map("source_id") @db.Uuid
  type      DatabasePropertyType
  name      String               @db.Text
  position  Int                  @default(0)
  settings  Json?                // { options: [{ id, label, color }] } for select/status; number format, etc.
  source    DatabaseSource       @relation(..., onDelete: Cascade)
  cells     DatabaseCellValue[]
  @@index([sourceId])
  @@map("database_properties")
}

model DatabaseRow {
  id          String    @id ...
  sourceId    String    @map("source_id") @db.Uuid
  pageId      String    @unique @map("page_id") @db.Uuid // the item Page (title/body/files live here)
  position    Int       @default(0)
  deletedAt   DateTime? @map("deleted_at") @db.Timestamptz(6)
  createdById String?   @map("created_by_id") @db.Uuid
  updatedById String?   @map("updated_by_id") @db.Uuid
  createdAt   DateTime  @default(now()) ...
  updatedAt   DateTime  @updatedAt ...
  source      DatabaseSource @relation(..., onDelete: Cascade)
  page        Page           @relation("DatabaseRowPage", fields: [pageId], references: [id], onDelete: Cascade)
  cells       DatabaseCellValue[]
  @@index([sourceId, position])
  @@index([pageId])
  @@map("database_rows")
}

model DatabaseCellValue {
  id         String           @id ...
  rowId      String           @map("row_id") @db.Uuid
  propertyId String           @map("property_id") @db.Uuid
  value      Json?
  updatedAt  DateTime         @updatedAt ...
  row        DatabaseRow      @relation(..., onDelete: Cascade)
  property   DatabaseProperty @relation(..., onDelete: Cascade)
  @@unique([rowId, propertyId])
  @@index([rowId])
  @@map("database_cell_values")
}
```

The Title/Name column is a **system property** backed by `Page.title` — never a
`DatabaseProperty` row, never deletable. Cross-workspace integrity (a row can't
reference a page from another workspace) is enforced in the domain service, not by a
DB constraint. `Page` gains reverse relations `databaseSource DatabaseSource?` (named
`DatabaseSourcePage`) and `databaseRow DatabaseRow?` (named `DatabaseRowPage`).

## Domain (`@repo/domain/database`)

Standard dto/repository/service + tokens + module, decorator-free inversify, NodeNext
`.ts` imports, `erasableSyntaxOnly` (no constructor parameter-properties), UnitOfWork
transactions. `DatabaseService` is injected into `PageService` (like `KanbanService`).

`DatabaseService` methods:
- `seedDefaults(pageId, workspaceId)` — create `DatabaseSource` (title from the page),
  one default TABLE `DatabaseView` titled "Таблица" (position 0), and one default
  STATUS property named "Статус" (position 0) whose `settings.options` = three options
  `{ id, label: 'Не начато' | 'В работе' | 'Готово', color }`. The Title/Name system
  property is implicit (Page.title), never created as a row. Called from `createPageTx`
  on DATABASE page create, in the same transaction.
- `getByPage(pageId)` — the full view-model.
- `createView/updateView/deleteView`.
- `listProperties/createProperty/updateProperty/deleteProperty` (guard: can't delete
  the system title; deleting a user property warns/cascades its cells).
- `createRow` — creates an item `Page` (via the page repo, so outbox/indexing/linked-
  list ordering all run) parented to the DATABASE page, plus a `DatabaseRow` bridge, in
  ONE transaction; returns `pageId`.
- `updateRowTitle` — writes `Page.title` for the item page.
- `deleteRow` / `restoreRow` — soft-delete the `DatabaseRow` + soft-delete the item
  `Page` (and restore symmetrically).
- `updateCellValue` — upsert `DatabaseCellValue` with type validation.
- `reorderRows` / `reorderProperties`.
- Access: `assertCanEdit` / `assertCanComment` mirroring `KanbanService` for both the
  source page and any touched item page.

## tRPC `database` router (folder `routers/database/`)

`getByPage`, `listViews`, `createView/updateView/deleteView`,
`listProperties/createProperty/updateProperty/deleteProperty`,
`listRows`, `createRow`, `updateRow` (title/icon), `deleteRow`, `updateCellValue`,
`reorderRows`, `reorderProperties`. `listRows` accepts an optional `query` scoped to
item `Page.title` + loaded cell values — does NOT call global workspace search. Inputs
use Zod + typed enums; date inputs use `z.preprocess` coercion (browser client has no
superjson — see Phase 2 gotcha). All mutations check workspace/page access for the
source page and any touched item page. Returns a UI-ready view-model: `{ source, views,
properties, rows: [{ pageId, title, icon, cells }], systemTitleProperty }`.

## Item-page hiding

A page is excluded from the normal sidebar tree, `listByWorkspace`, page-as-page
search (PG + Qdrant), recents, and engines MCP page lists when its `parent.type ===
DATABASE`. Implemented as a reusable predicate next to `buildPageVisibilityWhere`
(e.g. `excludeDatabaseRowPages()` returning a `Prisma.PageWhereInput` like
`{ parent: { is: { type: { not: 'DATABASE' } } } }`, combined into the existing AND).
Item pages are still real pages: directly openable by id (the modal/peek), indexed,
file-capable, visibility-checked.

## Renderer + create flow

- Unblock DATABASE: add `'DATABASE'` to `CreatablePageType` and a
  `CREATABLE_PAGE_TYPES` entry (icon `StorageIcon`/`TableChartIcon`, label "База
  данных", keywords база данных/database/таблица).
- `page-renderer.tsx`: add a DATABASE branch (dynamic import `ssr:false`,
  `CenteredSpinner` loading) → `DatabasePageRenderer({ pageId, editable })`. Add
  `'DATABASE'` to the page route's `isFullBleed` set.
- `DatabasePageRenderer`: loading/error states; empty first-database state with "New
  item"; if a DATABASE page has no source (legacy data) show a "Создать базу" action /
  auto-repair via `seedDefaults`; TABLE view as the first UI.

## Table view (`apps/web/src/components/database/`)

`database-toolbar.tsx` (add row, add property, view-selector placeholder, database-
local search; filter/sort hidden until cl4), `database-table-view.tsx`,
`property-header-cell.tsx`, `row-title-cell.tsx`, `cell-editors/*` (text, number,
checkbox, date, select/status with options from property settings). MVP cell editors:
text, number, checkbox, date, select/status. Add row inline + from toolbar (creates a
page-backed item). Add property from toolbar/header. Title column = the system
property: not deletable, edits write `Page.title`, click/open affordance opens the item
modal. Rename/delete user properties with a guard warning. Optimistic updates following
the kanban table-view pattern (`utils.database...setData` + invalidate on error); robust
loading states otherwise.

## Item page modal (`DatabaseItemPageModal`)

URL-param driven (`?rowId=`/`?itemPageId=`, like the kanban task modal). Title +
icon/cover placeholder + a properties section/side panel + the editor body using the
existing Page editor / Yjs integration (the item IS a real Page, so this reuses the
page editor directly). MVP opens as modal/peek (Notion-aligned); a full-page route is a
documented limitation for this phase. Row/item comments are NOT added this phase unless
the existing Page comment integration makes it trivially safe; otherwise documented as a
limitation.

## Embedded database view (`EmbeddedDatabaseView` editor node, prompt 3.6)

A Tiptap node (schema file + view file, registered in BOTH `index.ts` and `server.ts`
to avoid SSR breakage). Attrs: `{ sourceId, viewId, displayMode: 'table', readonly }`.
A `/база данных` slash-command + insert-menu entry; a picker for an existing source/
view. Renders the SAME source/view-model live inline (an inline view of the source, not
copied rows): editing a cell updates the source; opening a row opens the same item
`Page`; read/write if the user has edit access; readonly in public share unless
explicitly allowed. Public copy (cl2) of a TEXT page containing an embed → insert a
clear readonly/unsupported/local placeholder until database sync exists (documented).

## Testing

trpc/domain:
- create database source for a DATABASE page; default view + properties exist.
- row CRUD creates/uses a real `Page`; `createRow` returns a real `pageId`.
- title update writes `Page.title`.
- cell value CRUD (text/number/checkbox/date/select); invalid values rejected.
- unauthorized workspace member blocked on source + item-page mutations.
- item pages excluded from `listByWorkspace`/search; still openable by id.
- delete/restore row soft-deletes/restores the item page consistently.

Playwright:
- create a DATABASE page → see the table toolbar.
- add a row/item page; add a property; edit a cell.
- open an item from the title column (modal); edit title + body; close/reopen persists.
- insert an embedded database in a TEXT page; edit a cell from the embed updates the
  source; open an item from the embed shows the same Page; readonly user cannot edit.

## Checks (cl3 gate)

- `pnpm --filter @repo/trpc test`
- `pnpm --filter @repo/domain test`
- `pnpm --filter web lint`
- `pnpm check-types`
- focused Playwright database specs
- migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

A user can create a database and work with a simple table of item pages; each item is a
real AnyNote Page with title/body/properties opened as a modal; the same source renders
both full-page and as an inline embedded block; Kanban is untouched; database item pages
don't leak into the normal sidebar/search.
