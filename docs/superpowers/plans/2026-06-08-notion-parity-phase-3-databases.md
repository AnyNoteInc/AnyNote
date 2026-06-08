# Notion-parity Phase 3 — Generic Databases MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PageType.DATABASE` a working Notion-like database page whose items are real AnyNote Pages, with a TABLE view, properties, page-backed rows, cell editing, an item-page modal, and an embedded database block — without touching Kanban.

**Architecture:** New `database` Prisma models (source/view/property/row/cell). A `@repo/domain/database` module (dto/repo/service, inversify, UnitOfWork) provisions a source on DATABASE page-create via the existing `createPageTx` type-dispatch (mirroring Kanban). A tRPC `database` router exposes a UI view-model. Item pages are real Pages parented to the DATABASE page and filtered out of the normal tree/search. UI: renderer branch + table view + cell editors + URL-param item modal + a Tiptap `EmbeddedDatabaseView` node.

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8 (decorator-free), Next.js 16, MUI v6, Tiptap, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-08-notion-parity-phase-3-databases-design.md`

**Reference patterns (study before coding):** Kanban is the template. `packages/domain/src/kanban/` (module + `seedKanbanDefaults` + service shape), `packages/domain/src/pages/services/pages.service.ts` `create()` + `pages.repository.ts` `createPageTx` (the KANBAN type-dispatch + outbox), `packages/domain/src/pages/pages.module.ts` (injecting KANBAN.Service into PageService), `packages/trpc/src/routers/kanban/` (router folder + view-model + `kanbanBus`), `apps/web/src/components/kanban/views/table-view.tsx` (optimistic + inline create), `apps/web/src/components/kanban/task/task-detail-modal.tsx` (URL-param modal), `packages/editor/src/extensions/file-attachment.{schema.ts,tsx}` + `index.ts` + `server.ts` + `slash-menu.ts` (custom node pattern).

---

## File Structure

**Created:**
- `packages/domain/src/database/` — `database.module.ts`, `database.tokens.ts`, `index.ts`, `dto/database.dto.ts`, `repositories/database.repository.ts`, `services/database.service.ts`.
- `packages/trpc/src/routers/database/` — `index.ts`, `source.ts`, `view.ts`, `property.ts`, `row.ts`, `cell.ts` (or a single `database.ts` if small — prefer the folder to match kanban).
- `apps/web/src/components/database/` — `database-page-renderer.tsx`, `database-toolbar.tsx`, `database-table-view.tsx`, `property-header-cell.tsx`, `row-title-cell.tsx`, `cell-editors/{text,number,checkbox,date,select}-cell.tsx`, `database-item-modal.tsx`.
- `packages/editor/src/extensions/embedded-database.schema.ts`, `packages/editor/src/extensions/embedded-database.tsx`.
- Tests: `packages/domain/test/database/services/database.service.test.ts`, `packages/trpc/test/database-router.test.ts`, `packages/trpc/test/database-rows.test.ts`, `apps/e2e/database-mvp.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` + a generated migration.
- `packages/domain/src/pages/services/pages.service.ts`, `.../pages/repositories/pages.repository.ts`, `.../pages/pages.module.ts`, `packages/domain/src/container.ts`, `packages/domain/src/index.ts`.
- `packages/domain/src/pages/page-visibility.ts` (add `excludeDatabaseRowPages`).
- `packages/trpc/src/routers/index.ts` (mount the database router), `packages/trpc/src/routers/page.ts` + `search.ts` + `packages/trpc/src/services/page-search.ts` (apply the row-page exclusion), and the engines MCP page-list services.
- `apps/web/src/components/page/page-renderer.tsx`, the page route `isFullBleed`, `apps/web/src/components/templates/page-type-registry.tsx`.
- `packages/editor/src/extensions/index.ts` + `server.ts` + the slash-menu items.

---

## Phase A — Schema + domain (Prompt 3.1)

### Task A1: Prisma models + migration

**Files:** Modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<ts>_databases/migration.sql`.

- [ ] **Step 1:** Add the enums (`DatabaseViewType { TABLE }`, `DatabasePropertyType { TEXT NUMBER STATUS SELECT MULTI_SELECT CHECKBOX DATE PERSON FILE }`) and the five models (`DatabaseSource`, `DatabaseView`, `DatabaseProperty`, `DatabaseRow`, `DatabaseCellValue`) exactly as in the spec's Data model section. Add the two reverse relations on `Page`: `databaseSource DatabaseSource? @relation("DatabaseSourcePage")` and `databaseRow DatabaseRow? @relation("DatabaseRowPage")`. Add `databaseSources DatabaseSource[]` on `Workspace`.
- [ ] **Step 2:** `pnpm --filter @repo/db exec prisma validate` → valid.
- [ ] **Step 3:** Generate the migration on a FRESH scratch DB (never the shared dev DB): create `anynote_p3_scratch` via `docker exec anynote-postgres-1 psql -U user -d anynote -c "CREATE DATABASE anynote_p3_scratch;"`, `DATABASE_URL=...anynote_p3_scratch pnpm exec prisma migrate deploy`, then `prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` into the new migration file `packages/db/prisma/migrations/20260608130000_databases/migration.sql`. Review: CREATE TYPE x2 + CREATE TABLE x5 + indexes/FKs, no drops.
- [ ] **Step 4:** Re-deploy on a fresh scratch DB and `prisma migrate diff ... --exit-code` → "No difference detected." Drop the scratch DB.
- [ ] **Step 5:** `pnpm --filter @repo/db exec prisma generate`; commit `feat(db): database source/view/property/row/cell models`.

### Task A2: database DTO + repository

**Files:** Create `packages/domain/src/database/dto/database.dto.ts`, `repositories/database.repository.ts`, `database.tokens.ts`.

- [ ] **Step 1:** DTO — Zod schemas + inferred types for: `DatabasePropertyType`/`DatabaseViewType` (re-export from `@repo/db`), `SelectOption { id, label, color }`, `PropertySettings { options?: SelectOption[]; numberFormat?: string }`, create/update inputs for view/property/row/cell, and the view-model types (`DatabaseSourceView`, `DatabaseRowView { pageId, title, icon, position, cells: Record<propertyId, unknown> }`). Use `z.preprocess` date coercion for any date input.
- [ ] **Step 2:** tokens — `DATABASE = { Repository: Symbol.for('domain/DatabaseRepository'), Service: Symbol.for('domain/DatabaseService') }`.
- [ ] **Step 3:** Repository (`constructor(uow: UnitOfWork)`, body assignment; `this.uow.client()`): `createSource`, `findSourceByPageId`, `createView`/`updateView`/`deleteView`/`listViews`, `createProperty`/`updateProperty`/`deleteProperty`/`listProperties`, `createRow` (insert `DatabaseRow` only — the item Page is created by the service via the page repo), `findRowsBySource` (with item page title/icon joined, ordered by position, excluding soft-deleted), `softDeleteRow`/`restoreRow`, `upsertCellValue`, `reorderRows`/`reorderProperties`. Follow the kanban repo's UoW + Prisma style exactly.
- [ ] **Step 4:** `pnpm --filter @repo/domain check-types` → pass.
- [ ] **Step 5:** Commit `feat(domain): database dto + repository`.

### Task A3: DatabaseService (seedDefaults, view/property CRUD, cells) — TDD

**Files:** Create `packages/domain/src/database/services/database.service.ts`; test `packages/domain/test/database/services/database.service.test.ts`.

- [ ] **Step 1: Write failing tests** (mock the repo + a page-row creator, as kanban service tests mock the repo): `seedDefaults` creates a source + a TABLE view "Таблица" + a STATUS property "Статус" with 3 options; `createProperty`/`updateProperty`/`deleteProperty`; `updateCellValue` validates by type (a NUMBER property rejects a non-number; a SELECT rejects an option id not in settings.options); `deleteProperty` cascades cells. Mock the UoW `transaction` to run the callback inline.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test database` → FAIL.
- [ ] **Step 3:** Implement the service (`constructor(repo, uow)`): `seedDefaults`, view/property CRUD, `updateCellValue` (type validation against the property type + options), reorder. Leave row create/title/delete to A4 (it needs the page repo). `assertCanEdit`/`assertCanComment` private methods mirroring KanbanService (take the source page id, check access via the page repo's `findAccessiblePage`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): DatabaseService — seedDefaults, view/property/cell ops`.

### Task A4: Row create/title/delete (item Page bridge) — TDD

**Files:** Modify `database.service.ts`, `database.repository.ts`; modify `packages/domain/src/pages/repositories/pages.repository.ts` (expose a tx-internal `createItemPage` if needed) and tests.

- [ ] **Step 1: Write failing tests:** `createRow(sourceId, actorUserId)` creates an item `Page` (parented to the DATABASE page, type TEXT) AND a `DatabaseRow` bridge in one transaction and returns `{ rowId, pageId }`; `updateRowTitle(rowId, title)` writes `Page.title`; `deleteRow` soft-deletes both the row and the item page; `restoreRow` restores both.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `createRow` runs in `this.uow.transaction`: look up the source → its `pageId` (the DATABASE page) + workspaceId; create the item page via the page repository's existing create path (reuse the internal page-create that enqueues outbox + linked-list ordering; if the existing `createPageTx` is hard to call standalone, add a focused `createItemPageTx(parentPageId, workspaceId, actorUserId)` on the page repo that creates a child TEXT page + outbox, WITHOUT the kanban/database provisioning callback to avoid recursion); then `repo.createRow({ sourceId, pageId, position })`. `updateRowTitle` updates `Page.title` via the page repo. `deleteRow`/`restoreRow` set `DatabaseRow.deletedAt` + the item `Page.deletedAt`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(domain): database rows bridge to item Pages (create/title/delete/restore)`.

### Task A5: Provision source on DATABASE page create + wire module

**Files:** Modify `packages/domain/src/pages/repositories/pages.repository.ts` (`createPageTx` dispatch), `packages/domain/src/pages/services/pages.service.ts`, `packages/domain/src/pages/pages.module.ts`, `packages/domain/src/database/database.module.ts` (create), `packages/domain/src/database/index.ts` (create), `packages/domain/src/container.ts`, `packages/domain/src/index.ts`.

- [ ] **Step 1:** Create `database.module.ts` (bind Repository + Service like collections) and `index.ts` (re-export dto/service/tokens). Register in `container.ts` (`database: DatabaseService`) and export from `index.ts`.
- [ ] **Step 2:** Extend `createPageTx`: the page service passes a provisioning callback; generalize the existing `onKanban` to dispatch on type — add `if (newPage.type === PageType.DATABASE) await onDatabase(newPage.id, newPage.workspaceId)`. Inject `DatabaseService` into `PageService` (add `DATABASE.Service` to `pages.module.ts` deps) and pass `(pageId, wsId) => this.database.seedDefaults(pageId, wsId)`.
- [ ] **Step 3:** Add a test (extend `packages/domain/test/pages/services/pages.service.test.ts` or the database service test): creating a DATABASE page calls `seedDefaults`. Run `pnpm --filter @repo/domain test` → all pass.
- [ ] **Step 4:** `pnpm --filter @repo/domain check-types` → pass.
- [ ] **Step 5:** Commit `feat(domain): provision database source on DATABASE page create`.

---

## Phase B — tRPC router + item-page hiding (Prompt 3.2 + hide filter)

### Task B1: excludeDatabaseRowPages predicate + apply to lists/search/MCP

**Files:** Modify `packages/domain/src/pages/page-visibility.ts`; `packages/trpc/src/routers/page.ts`, `search.ts`, `packages/trpc/src/services/page-search.ts`; `apps/engines/src/apps/mcp/...` page-list services. Test: `packages/trpc/test/page-visibility.test.ts` (extend).

- [ ] **Step 1: Failing test:** a page whose parent is a DATABASE page is excluded from `page.listByWorkspace` and from PG search, but is still fetchable by `page.getById`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add `export function excludeDatabaseRowPages(): Prisma.PageWhereInput { return { parent: { is: { type: { not: 'DATABASE' } } } } }` to `page-visibility.ts` (note: pages with no parent must NOT be excluded — `{ parent: { is: { type: { not: 'DATABASE' } } } }` only matches pages that HAVE a parent; combine as `{ OR: [{ parentId: null }, { parent: { type: { not: 'DATABASE' } } }] }` so root pages stay visible). Add this predicate to the `AND` of `listByWorkspace`, the PG search SQL (a `NOT EXISTS (SELECT 1 FROM pages p2 WHERE p2.id = pages.parent_id AND p2.type = 'DATABASE')` clause), the Qdrant post-filter, and the engines MCP page-list query.
- [ ] **Step 4:** Run → PASS. Also run `pnpm --filter engines test`.
- [ ] **Step 5:** Commit `feat(database): hide database item pages from tree/search/MCP`.

### Task B2: database tRPC router

**Files:** Create `packages/trpc/src/routers/database/` (index + sub-files); modify `packages/trpc/src/routers/index.ts`. Test: `packages/trpc/test/database-router.test.ts`, `packages/trpc/test/database-rows.test.ts`.

- [ ] **Step 1: Failing integration tests** (self-contained real-DB fixtures like `collection-router.test.ts`): `getByPage` returns source+views+properties+rows+systemTitleProperty for a DATABASE page; `createRow` creates a real item Page (assert the pages table); `updateRow` title writes Page.title; `createProperty`/`updateProperty`/`deleteProperty`; `updateCellValue` round-trips and rejects invalid; `listRows` with a `query` filters by title/cell; `reorderRows`/`reorderProperties`; a non-member is FORBIDDEN; a member-without-edit is FORBIDDEN on writes.
- [ ] **Step 2:** Run `pnpm --filter @repo/trpc test database` → FAIL.
- [ ] **Step 3:** Implement the router folder: `getByPage`, `listViews`, `createView`/`updateView`/`deleteView`, `listProperties`/`createProperty`/`updateProperty`/`deleteProperty`, `listRows` (optional `query`), `createRow`, `updateRow`, `deleteRow`, `updateCellValue`, `reorderRows`, `reorderProperties`. Reads use `assertPageAccess`, writes `assertPageEditAccess`. All mutations go through `domainSvc.database.*` via `mapDomain`. Mount in `routers/index.ts` as `database`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(trpc): database router (source/view/property/row/cell)`.

---

## Phase C — Page renderer + create flow + table view (Prompts 3.3 + 3.4)

### Task C1: Unblock DATABASE create + renderer branch + full-bleed

**Files:** Modify `apps/web/src/components/templates/page-type-registry.tsx`, `apps/web/src/components/page/page-renderer.tsx`, the page route `isFullBleed`; create `apps/web/src/components/database/database-page-renderer.tsx`.

- [ ] **Step 1:** Add `'DATABASE'` to the `CreatablePageType` Extract union + a `CREATABLE_PAGE_TYPES` entry (icon `StorageIcon` via `@repo/ui/components`, label `'База данных'`, keywords `['база данных','database','таблица']`). Add `pageTypeIcon`/`pageTypeLabel` cases.
- [ ] **Step 2:** Create `DatabasePageRenderer({ pageId, editable })` — calls `trpc.database.getByPage.useQuery({ pageId })`; loading spinner; error state; if no source → a "Создать базу" button calling a `database.ensureSource`/repair mutation (add a `repairSource` procedure that runs `seedDefaults` if missing); empty rows → table with an "+ Новая строка" affordance. Render `<DatabaseTableView/>` (built in C2) — for this task a placeholder table is fine; C2 fills it.
- [ ] **Step 3:** In `page-renderer.tsx` add a dynamic import (`ssr:false`) + a `if (page.type === 'DATABASE') return <DatabasePageRenderer pageId={page.id} editable={editable} />` branch before TEXT. Add `'DATABASE'` to the page route `isFullBleed` array.
- [ ] **Step 4:** `pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 5:** Commit `feat(web): DATABASE creatable + renderer branch + full-bleed`.

### Task C2: Table view + toolbar + cell editors

**Files:** Create `apps/web/src/components/database/{database-toolbar,database-table-view,property-header-cell,row-title-cell}.tsx` and `cell-editors/{text,number,checkbox,date,select}-cell.tsx`.

- [ ] **Step 1:** Build `DatabaseTableView` consuming the `getByPage` view-model: a header row from `properties` (+ the system Title column first), body rows from `rows`, each cell dispatched to the right editor by property type. `DatabaseToolbar`: "+ Строка" (createRow), "+ Свойство" (createProperty menu picking a type), a view-selector placeholder, and a database-local search box (filters `listRows` by query). Filter/sort hidden until cl4.
- [ ] **Step 2:** Cell editors (text/number/checkbox/date/select-status) calling `updateCellValue` with optimistic update via `utils.database.getByPage.setData` + invalidate on error (follow the kanban table-view optimistic pattern). `row-title-cell` edits `Page.title` (updateRow) and has an open affordance (sets `?rowId=`). `property-header-cell` renames/deletes a user property with a guard confirm; the system Title column is not deletable.
- [ ] **Step 3:** `pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 4:** Commit `feat(web): database table view + toolbar + cell editors`.

---

## Phase D — Item page modal (Prompt 3.5)

### Task D1: DatabaseItemPageModal

**Files:** Create `apps/web/src/components/database/database-item-modal.tsx`; wire it into `DatabasePageRenderer` (open on `?rowId=`/`?itemPageId=`).

- [ ] **Step 1:** Build `DatabaseItemPageModal` — URL-param driven (read `rowId` from search params, like `task-detail-modal.tsx` reads `taskId`). Header: title (editable → updateRow) + icon/cover placeholder. A properties section (the row's cells, editable via the same cell editors). Body: the existing page editor for the item `Page` (reuse `PageRenderer`/the editor with the item page's id + a yjs token — item pages are real pages, so the standard page editor/Yjs path applies; pass `editable`).
- [ ] **Step 2:** Open from the table title column; close via `router.replace` removing the param. Document in a code comment that MVP is modal/peek; a full-page route is deferred. Row/item comments deferred unless trivially safe — document.
- [ ] **Step 3:** `pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 4:** Commit `feat(web): database item page modal (peek)`.

---

## Phase E — Embedded database view (Prompt 3.6)

### Task E1: EmbeddedDatabaseView editor node

**Files:** Create `packages/editor/src/extensions/embedded-database.schema.ts` + `embedded-database.tsx`; modify `packages/editor/src/extensions/index.ts` + `server.ts` + the slash-menu items.

- [ ] **Step 1:** Create the schema node (`embeddedDatabase`, `group: 'block'`, `atom: true`, attrs `{ sourceId, viewId, displayMode: 'table', readonly: false }`, parseHTML/renderHTML), following `file-attachment.schema.ts`. Register it in `server.ts` (schema-only) AND `index.ts` `buildExtensions`.
- [ ] **Step 2:** Create `embedded-database.tsx` extending the schema with `ReactNodeViewRenderer(EmbeddedDatabaseView)`. The view component (inside `NodeViewWrapper contentEditable={false}`) reads `node.attrs.sourceId`/`viewId`, queries the source via tRPC, and renders the SAME `DatabaseTableView` (readonly when `node.attrs.readonly` or the user lacks edit access). Opening a row sets `?rowId=` (same item Page).
- [ ] **Step 3:** Add a `/база данных` slash-command item + insert-menu entry that opens a source/view picker, then inserts the node with the chosen `sourceId`/`viewId`.
- [ ] **Step 4:** `pnpm --filter @repo/editor check-types` (and test if available) `&& pnpm check-types && pnpm --filter web lint` → pass.
- [ ] **Step 5:** Commit `feat(editor): embedded database view node + slash command`.

### Task E2: Public-copy placeholder for embeds

**Files:** Modify the Phase-2 `PublicShareCopyService` content handling (`packages/domain/src/share-copy/...`) OR a content sanitizer used on copy.

- [ ] **Step 1:** When copying a TEXT page (cl2 copy) whose content contains an `embeddedDatabase` node, replace it with a clear readonly/unsupported placeholder node/paragraph ("Встроенная база данных недоступна в копии") rather than a broken live embed. Add a unit test for the content transform.
- [ ] **Step 2:** `pnpm --filter @repo/domain test && pnpm check-types` → pass.
- [ ] **Step 3:** Commit `feat(database): unsupported placeholder for embedded db in public copies`.

---

## Phase F — E2E + gate

### Task F1: Playwright database MVP spec

**Files:** Create `apps/e2e/database-mvp.spec.ts`.

- [ ] **Step 1:** Using `signUpAndAuthAs` + the current create-page flow (study `apps/e2e/page-sharing.spec.ts` `createWorkspaceAndTextPage` for the warmed flow), write: create a DATABASE page → table toolbar visible; add a row → a row appears; add a property → header appears; edit a text/checkbox/select cell → value persists (assert via tRPC-backed UI, not yjs); open an item from the title column → modal opens, edit title. Note the no-yjs E2E constraint (assert tRPC-backed UI/route state; the item-body editor won't persist without yjs — assert the modal opens + title edits via tRPC).
- [ ] **Step 2:** `pnpm exec playwright test apps/e2e/database-mvp.spec.ts --retries 1` → pass.
- [ ] **Step 3:** Commit `test(e2e): database MVP — create, rows, properties, cells, item modal`.

### Task F2: Full gate + changelog

- [ ] **Step 1:** `pnpm check-types` (22/22), `pnpm lint`, `pnpm check-architecture`, `pnpm --filter @repo/trpc test`, `pnpm --filter @repo/domain test`, `pnpm --filter web test`, `pnpm --filter engines test` → all pass.
- [ ] **Step 2:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 3:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 4:** Add a `docs/changelog.md` entry (Базы данных). Commit.

---

## Self-review notes

- Spec coverage: A1–A5 = schema + domain + provisioning (3.1); B1 = item-page hiding; B2 = router (3.2); C1–C2 = create flow + renderer + table/cell editors (3.3+3.4); D1 = item modal (3.5); E1–E2 = embedded view + copy placeholder (3.6); F = e2e + gate.
- Item-page hiding (B1) uses `{ OR: [{ parentId: null }, { parent: { type: { not: 'DATABASE' } } }] }` so root pages aren't dropped — explicit to avoid the "every list query loses root pages" bug.
- Row create (A4) reuses the page-create path so item pages get outbox indexing + linked-list ordering for free; a focused `createItemPageTx` avoids re-triggering DATABASE provisioning (no recursion).
- Type consistency: `getByPage` view-model `{ source, views, properties, rows: [{ pageId, title, icon, cells }], systemTitleProperty }` is the single shape used by the renderer (C1), table (C2), modal (D1), and embed (E1). `seedDefaults(pageId, workspaceId)` signature is consistent across A3/A5. `excludeDatabaseRowPages()` named consistently in B1.
- Kanban untouched: no edits to `packages/domain/src/kanban` or kanban routers/components.
