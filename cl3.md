# Generic databases MVP

## Описание фазы

Эта фаза оживляет `PageType.DATABASE` как Notion-like database page: сама база
остается страницей AnyNote, data source является коллекцией item pages, а
table/embedded views только отображают и редактируют эту коллекцию. MVP должен
дать database source, table view, properties, page-backed rows/cards, cell
editing, item page peek/modal and embedded database view. Kanban remains
separate and must not regress.

## Полный ожидаемый результат

- DATABASE page can be created from create-page flow.
- DatabaseSource, DatabaseView, DatabaseProperty, DatabaseRow bridge and
  DatabaseCellValue exist in DB/API.
- Every database item is backed by a real AnyNote `Page`; the required title/name
  column reads and writes `Page.title`, and item body uses existing
  `Page.content`/`Page.contentYjs`.
- Table view renders item pages/properties/cells.
- Users can add item pages, add properties and edit common cell types.
- Item page modal/peek behaves like a page with title/body/properties.
- TEXT pages can embed an existing database source/view as an inline database
  block without copying the source.
- Server-side permissions protect database source, item pages and cell mutations.

## Scope и ограничения

MVP covers one data source per database page, table view, page-backed item rows
and foundational property types. Advanced views, multiple linked data sources,
formulas, relations, rollups, database item templates, database sync and
Notion-like page-level access rules are intentionally left for later phases.
True property-level ACL is not Notion parity; if AnyNote ever needs it, it must
be scoped as a separate AnyNote extension. Kanban Task models should not be
reused as generic database rows. Database-local search may be simple, but it
must be scoped to the current database's item page titles and property values;
do not substitute global workspace search.

## Рабочее задание фазы

Цель: оживить `PageType.DATABASE` как универсальную Notion-like базу: база и
каждый item являются AnyNote pages, properties contextualize item pages, table
view редактирует collection of pages. Kanban остается отдельным модулем и не
ломается.

## Prompt 3.1 - database schema and domain service

```text
Цель: добавить минимальную generic database модель без UI, сохранив `Page` как
core document entity.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma PageType DATABASE
- packages/db/prisma/schema.prisma Task/Kanban models
- packages/trpc/src/routers/kanban/**
- packages/domain/src/**

Сделай:
1. Добавь Prisma models:
   - DatabaseSource: id, workspaceId, pageId unique, title, createdAt, updatedAt.
     `pageId` points to the owning `PageType.DATABASE` page; `title` may mirror
     or default from `Page.title`, but the full-page database title is still the
     Page title.
   - DatabaseView: id, sourceId, type TABLE, title, position, settings Json;
   - DatabaseProperty: id, sourceId, type, name, position, settings Json;
   - DatabaseRow: id, sourceId, pageId, position, deletedAt, createdById,
     updatedById, timestamps. This is a membership/order bridge only, not a
     document body. `pageId` points to the item `Page` that stores title, icon,
     body/contentYjs, files, comments/search metadata and editor content.
   - DatabaseCellValue: rowId, propertyId, value Json, updatedAt.
   - Add relations/indexes so a source can list item pages efficiently and a row
     cannot reference a page from another workspace.
2. Добавь enums for DatabaseViewType and DatabasePropertyType MVP:
   - TEXT, NUMBER, STATUS, SELECT, MULTI_SELECT, CHECKBOX, DATE, PERSON, FILE.
3. Treat the Notion Title/Name column as a required system property backed by
   `Page.title`, not as a deletable `DatabaseProperty`.
4. Добавь domain service:
   - createDatabaseForPage;
   - createDefaultTableView;
   - create/update/delete property;
   - create item row: creates an item `Page` and `DatabaseRow` bridge in one
     transaction;
   - update item row title/icon/body via existing Page fields/services where
     possible;
   - delete/restore item row with clear behavior for the linked Page;
   - update cell value.
5. Добавь access checks via workspace/page permissions for both source page and
   item page.
6. Добавь tests for:
   - create database source for DATABASE page;
   - default view/properties;
   - row CRUD creates/uses a real Page;
   - title updates write Page.title;
   - cell value CRUD;
   - unauthorized workspace member blocked.

Не делай:
- Не добавляй formulas/relations yet.
- Не добавляй database item templates yet.
- Не меняй Kanban task models.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- Backend can create and mutate a simple table-like database whose items are
  AnyNote pages, not standalone row documents.
```

## Prompt 3.2 - database router and API contracts

```text
Цель: добавить стабильный tRPC API для database MVP.

Ориентиры по коду и текущей реализации:
- database domain service, созданный в задаче 3.1 этой фазы
- packages/trpc/src/routers/index.ts
- packages/trpc/src/routers/kanban/**
- packages/trpc/test/kanban-*.test.ts

Сделай:
1. Создай packages/trpc/src/routers/database.ts или folder database/.
2. Procedures:
   - getByPage;
   - listViews;
   - createView/updateView/deleteView;
   - listProperties/createProperty/updateProperty/deleteProperty;
   - listRows/createRow/updateRow/deleteRow for page-backed item rows;
   - updateCellValue;
   - reorderRows;
   - reorderProperties.
   `listRows` may accept a database-local search query scoped to item
   `Page.title` and cell values. Do not call or depend on global workspace search
   for table search.
3. В input schemas используй zod и typed enums.
4. Все mutations проверяют workspace/page access for the source page and any
   touched item page.
5. Возвращай view model, удобную для UI:
   - source;
   - views;
   - properties;
   - rows with `pageId`, page title/icon metadata and cell values;
   - system title property metadata for the first column.
6. Добавь tests на all procedures and permission failures.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- UI может построить table view без дополнительных backend hacks and can open
  each row as an item Page.
```

## Prompt 3.3 - Database page renderer and create flow

```text
Цель: сделать DATABASE создаваемым типом страницы.

Ориентиры по коду и текущей реализации:
- apps/web/src/components/templates/page-type-registry.tsx
- apps/web/src/components/templates/create-page-dialog.tsx
- apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx
- page renderer files under apps/web/src/components/page
- packages/trpc/src/routers/database.ts

Сделай:
1. Добавь DATABASE в creatable page types с понятной иконкой.
2. При создании DATABASE page вызывай создание database source/default view.
   The database page remains a normal AnyNote Page container; its source is not a
   separate top-level document type.
3. Добавь `DatabasePageRenderer`:
   - loading state;
   - error state;
   - empty first database state with "New item" creating an item Page;
   - table view as first UI.
4. Подключи renderer к page route.
5. Если page type DATABASE без source из старых данных, auto-repair or show
   "Создать базу" action.
6. Добавь Playwright smoke:
   - create DATABASE page;
   - see table toolbar;
   - add row/item page;
   - add property;
   - edit a cell.

Дизайн:
- Это app surface, не маркетинг.
- Toolbar compact: add row, add property, view selector placeholder, filter/sort
  disabled or hidden until Phase 4.
- Full-page database and embedded database must render the same source/view
  model. The full-page DATABASE route is just the focused version.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- focused Playwright database MVP spec

Критерий готовности:
- Пользователь может создать базу и работать с simple table of item pages.
```

## Prompt 3.4 - table view MVP cell editors

```text
Цель: сделать таблицу полезной: редактирование item pages/properties/cells.

Ориентиры по коду и текущей реализации:
- DatabasePageRenderer, созданный в задаче 3.3 этой фазы
- apps/web/src/components/kanban/views/table-view.tsx for patterns, not reuse blindly
- packages/trpc/src/routers/database.ts
- @repo/ui components

Сделай:
1. Создай components under apps/web/src/components/database:
   - database-toolbar.tsx;
   - database-table-view.tsx;
   - property-header-cell.tsx;
   - row-title-cell.tsx;
   - cell-editors/*
2. Cell editors MVP:
   - text;
   - number;
   - checkbox;
   - date;
   - select/status with options in property settings.
3. Add row inline and from toolbar by creating a page-backed item.
4. Add property from toolbar/header.
5. Implement the first Title/Name column as the item `Page.title` system
   property:
   - cannot be deleted;
   - rename/title edits update `Page.title`;
   - clicking/open affordance opens the item page modal/peek.
6. Rename/delete user properties with guard warning.
7. Add simple database-local search in toolbar if it fits MVP:
   - searches item page title and loaded property values;
   - clearly separate from workspace search/history.
8. Optimistic update where current trpc patterns support it; otherwise robust
   loading states.
9. Tests:
   - update text/number/checkbox/date/select;
   - edit title updates item Page;
   - open item from title column;
   - rename property;
   - delete property warning.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- Playwright database table editing spec

Критерий готовности:
- Table MVP feels like a real product feature, not a schema demo.
```

## Prompt 3.5 - database item page peek/modal

```text
Цель: дать database item самостоятельную page surface with title, properties and
body, without inventing a separate row document model.

Ориентиры по коду и текущей реализации:
- Current database models
- Page editor/page renderer code
- packages/editor usage in page editor
- apps/web/src/components/kanban/task/task-detail-modal.tsx for modal patterns

Сделай:
1. Do not add `DatabaseRow.content` or `DatabaseRow.contentYjs`. Item body
   storage is the linked AnyNote `Page.content`/`Page.contentYjs`.
2. Ensure createRow/createItem creates or links an item `Page` and returns
   `pageId` to the UI.
3. Добавь `DatabaseItemPageModal` or `DatabaseRowModal`:
   - title;
   - icon/cover placeholder;
   - properties top section or side panel;
   - editor body using existing Page editor/Yjs integration.
4. Поддержи opening item page from table. Default MVP may be modal/peek, aligned
   with Notion database pages opening in peek; full-page route can be added only
   if current routing allows safely.
5. If full-page mode is not implemented, keep the item as a real Page internally
   and document the route limitation in code comments/tests/docs for this phase.
6. Row/item comments не добавляй пока, если это тянет отдельную модель. Reuse
   existing Page comments only if current Page editor integration makes it safe;
   otherwise document as limitation.
7. Tests:
   - open item page modal/peek from table;
   - edit title;
   - edit body;
   - property values render with the item page;
   - close/reopen persists.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- focused Playwright row modal spec

Критерий готовности:
- Database item воспринимается как page/card с body, потому что он и есть
  AnyNote Page linked through DatabaseRow bridge.
```

## Prompt 3.6 - embedded database view MVP

```text
Цель: вставлять inline/linked database view внутрь TEXT-документа.

Ориентиры по коду и текущей реализации:
- packages/editor/src extensions/nodes
- apps/web page editor integration
- database router/view model

Сделай:
1. Добавь editor node/block `EmbeddedDatabaseView`.
2. Атрибуты: sourceId, viewId, displayMode table, readonly flag.
3. Добавь slash command or insert menu entry "База данных".
4. Добавь picker existing database source/view.
5. Render embedded table in TEXT page:
   - treat this as an inline view of the same source, not as copied rows;
   - opening an embedded row opens the same item Page;
   - read/write if user has edit access;
   - readonly in public share unless explicitly allowed.
6. Public copy behavior:
   - if copied before synced clone feature, copy as static unsupported placeholder
     or local copy, choose safer behavior and document it.
7. Tests:
   - insert embedded database;
   - edit cell from embedded view updates source;
   - open item from embedded view shows same Page title/body;
   - readonly user cannot edit.

Проверки:
- pnpm --filter @repo/editor test if available
- pnpm --filter web lint
- pnpm check-types
- Playwright embedded db smoke

Критерий готовности:
- The same database source can be viewed as a full-page DATABASE page or as an
  inline embedded block, with item pages and property values kept in sync.
```
