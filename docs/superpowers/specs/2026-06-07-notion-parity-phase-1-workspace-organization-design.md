# Notion-parity Phase 1: Workspace organization (Collections, Private/Shared, Archive)

**Status:** Approved design · **Date:** 2026-06-07 · **Source roadmap:** `cl1.md`

## Goal

Turn AnyNote's flat page tree into a Notion-aligned organized workspace while
keeping `Page` as the core document entity:

- **Collections** as Notion-Teamspace-like containers (one team space per workspace).
- **Private** pages (personal collection, visible only to owner).
- **Shared** as a derived surface from explicit `PageShareUser` grants (NOT a collection).
- **Archive** as a first-class, restorable page state hidden by default — distinct
  from Trash (`deletedAt`).

This is the foundation that Phases 2 (public sharing), 5 (history/notifications),
and 8 (enterprise) build on.

## Scope decisions (settled during brainstorming)

| Decision | Choice |
|---|---|
| Archive vs Trash | **Two distinct states** (Notion-like): active → archive → trash → hard delete. `archivedAt`/`archivedById` new; `deletedAt` (Корзина) unchanged. |
| Collection kinds | `TEAM \| PERSONAL \| SITE`. `SITE` reserved (empty, no publish logic) for Phase 2. **No `DEFAULT_TEAM`** — the default team space is `kind = TEAM, ownerId NULL`. |
| One team space per workspace | Enforced by a **partial unique index** (`WHERE kind='TEAM' AND owner_id IS NULL`), not a plain composite unique. |
| Custom TEAM collections w/ own membership | **Out of scope for Phase 1.** Schema reserves `TEAM` kind; UI shows only the single team space + Private + Shared + Archive. |
| `CollectionMember` table | **Not added (YAGNI).** TEAM access = `WorkspaceMember`; PERSONAL access = `Collection.ownerId`. Added in a future increment when custom team collections land. |
| Legacy page migration | **All legacy pages → the workspace TEAM collection.** Zero visibility regression. Privacy is opt-in (user explicitly moves a page to Private). |
| Per-user collection ordering | `UserPreference.collectionOrder Json?` (array of collectionId). No separate table. |

## Out of scope (Phase 1)

- Custom TEAM collections with their own membership (`CollectionMember`).
- Public/Notion-Sites web publishing (Phase 2; `SITE` kind reserved only).
- Database-backed collection-home views (later phase; home tabs are query-backed page lists).
- Enterprise admin/audit override of private/archived content (enterprise phase).
- Draft → published lifecycle (explicitly rejected; privacy = location/access).

## Section 1 — Data model

### New enum + `Collection` model

```prisma
enum CollectionKind {
  TEAM       // one per workspace (ownerId NULL), visible to all workspace members
  PERSONAL   // one per (workspace, user), visible only to owner
  SITE       // reserved for Phase 2 (public sites), no logic in Phase 1
}

model Collection {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String         @map("workspace_id") @db.Uuid
  kind        CollectionKind
  title       String?        @db.Text
  description String?        @db.Text
  icon        String?        @db.Text
  color       String?        @db.Text
  ownerId     String?        @map("owner_id") @db.Uuid     // required for PERSONAL, null for team/site
  homePageId  String?        @unique @map("home_page_id") @db.Uuid
  position    Int            @default(0)
  archivedAt  DateTime?      @map("archived_at") @db.Timestamptz(6)
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  owner     User?     @relation("CollectionOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  homePage  Page?     @relation("CollectionHome", fields: [homePageId], references: [id], onDelete: SetNull)
  pages     Page[]    @relation("CollectionPages")

  @@index([workspaceId, kind])
  @@index([ownerId])
  @@map("collections")
}
```

### Uniqueness (partial unique indexes — added via raw SQL in migration; Prisma cannot express `WHERE`)

```sql
CREATE UNIQUE INDEX collections_one_team_per_workspace
  ON collections (workspace_id) WHERE kind = 'TEAM' AND owner_id IS NULL;
CREATE UNIQUE INDEX collections_one_personal_per_user
  ON collections (workspace_id, owner_id) WHERE kind = 'PERSONAL';
```

### `Page` changes

- `collectionId String? @map("collection_id") @db.Uuid` + relation `collection Collection? @relation("CollectionPages", ...)`. Nullable for backwards-compat during migration; new pages always get a deterministic home.
- `archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)`
- `archivedById String? @map("archived_by_id") @db.Uuid`
- **Drop** the dead `archived Boolean` column (unused in any UI — confirmed by gap analysis). Safety: migrate `archived = true → archivedAt = now()` before dropping.
- `deletedAt` (Trash) untouched.
- Add `homePageOfCollection Collection? @relation("CollectionHome")` back-relation.

Page states become orthogonal: `collectionId` (where it lives) × `archivedAt` (archived?) × `deletedAt` (in trash?).

### `UserPreference` change

- `collectionOrder Json? @map("collection_order")` — array of collectionId for per-user ordering.

### Migration (one Prisma migration, raw SQL data backfill)

1. Create enum `CollectionKind`; create `collections` table; create the 2 partial unique indexes.
2. Add columns `pages.collection_id`, `pages.archived_at`, `pages.archived_by_id`, `user_preferences.collection_order`.
3. For each `Workspace` → create one `Collection {kind: TEAM, title: 'Общее', ownerId: NULL}`.
4. For each `(Workspace, WorkspaceMember.user)` → create one `Collection {kind: PERSONAL, ownerId: user}`.
5. All `Page` with `collection_id IS NULL` AND `is_template_backing = false` → set `collection_id` = the workspace's TEAM collection. (Visibility unchanged for everyone.)
6. `UPDATE pages SET archived_at = now() WHERE archived = true;` then `ALTER TABLE pages DROP COLUMN archived;`.

Migrate from fresh `main` (shared dev DB drift caveat — never reset/db-push).

## Section 2 — Domain, tRPC, access resolver

### New domain module `packages/domain/src/collections/`

Follows the established dto/repo/service + decorator-free inversify-8 DI + UnitOfWork/ALS pattern (the repo's standard domain layout).

- `ensureWorkspaceCollections(workspaceId)` — idempotent; creates the TEAM collection + PERSONAL collections for all current members. Called on workspace creation.
- `ensurePersonalCollection(workspaceId, userId)` — idempotent; called when a member is added to a workspace.
- `listCollectionsForUser(workspaceId, userId)` — returns the TEAM collection + the caller's own PERSONAL (never other users' PERSONAL). Applies `UserPreference.collectionOrder`.
- `updateCollection` / `archiveCollection` / `reorderCollections` (writes `UserPreference.collectionOrder`).
- `getCollectionHome(collectionId)` — returns `homePageId` or null.

### Access resolver — the heart of the phase

Today `assertPageAccess` (`packages/trpc/src/helpers/page-access.ts:16`) and the domain `findAccessiblePage` (`packages/domain/src/pages/repositories/pages.repository.ts:31`) check only workspace membership. New single visibility rule:

```
canSeePage(user, page) =
  workspaceMember(user, page.workspaceId) AND (
       page.collection.kind == TEAM                       // all workspace members
    OR (page.collection.kind == PERSONAL                  // owner only
         AND page.collection.ownerId == user.id)
  )
  OR hasExplicitShare(user, page)                         // PageShareUser grant overrides privacy
```

Archive/trash are an **orthogonal filter** on top: `archivedAt`/`deletedAt` hide pages from ordinary lists but do not change access (owner/grantee can still open an archived page via link, with an archived banner).

**Single source of truth:** `buildPageVisibilityWhere(userId)` → a Prisma `where` fragment reused by **all** surfaces: page tree, search, recents, export, comments. No duplicated conditions. This directly satisfies the 1.3/1.5 anti-leak requirement.

### New tRPC router `collection` (`packages/trpc/src/routers/collection.ts`)

- `list` (sidebar) · `getHome` · `create` / `update` / `archive` / `reorder` (team). No member-grant procedures yet (YAGNI).

### `page` router extensions

- `create` accepts `collectionId` and/or `location: 'team' | 'private'`. If unspecified → default per active location, else Private (Notion-like quick-create). Nested page inherits parent's `collectionId`.
- `moveToCollection(pageId, collectionId)` and `moveToPrivate(pageId)`. Private→Team makes team-visible; Team→Private removes broad team visibility.
- `archive(pageId)` / `unarchive(pageId)` — set/clear `archivedAt` + `archivedById`. Parent archive cascades to descendants by an **effective rule** (a descendant is hidden if any ancestor is archived — evaluated at query time, not a mass update).
- `listArchived(workspaceId)` — for the Archive surface.

### Map existing surfaces onto the new `where`

- `page.listByWorkspace` → split into per-collection queries or include `collectionId`/`location` in output so the sidebar can group.
- `search` router, recents, export route → all apply `buildPageVisibilityWhere`.

### Cross-package impact (REQUIRED scope)

Changing the `Page` model also affects `apps/engines` MCP services (`search_workspace_pages`, `get_page`, `list_workspace_pages`). They must either apply the visibility-where or explicitly stay on service-level access. Grep the whole repo; run full `pnpm gates`, not just web/trpc.

## Section 3 — UI

### Sidebar (`workspace-sidebar.tsx` + `page-tree-section.tsx`)

Add sections (variant B), each collapsible like existing sections:

- **🏢 Команда** — page tree of the TEAM collection.
- **🔒 Личное** — page tree of the owner's PERSONAL collection.
- **👥 Поделились** — flat list of pages with an explicit `PageShareUser` grant for the current user (derived, not a tree).
- **📦 Архив** — utility link (not a tree) next to Маркетплейс/Корзина → `/archive`.

Parameterize `PageTreeSection` with `location`/`collectionId` so it's reused for Команда and Личное without duplication. Private pages are **never** mixed into the team tree.

### Collection home

URLs are already neutral (workspaceId removed from URLs in a prior cycle). Add `/collections/[collectionId]` under `(protected)/(active)`. Working wiki surface with tabs: **Home** (renders `homePageId` if set), **Все страницы** (query-backed list of the collection), **Мои страницы** (`createdById == me`). No hero/landing — dense app shell.

### Move dialog (`move-page-dialog.tsx`)

Currently picks only a parent in the tree. Extend: first choose destination **Команда / Личное** (optionally a parent within), then confirm. Moving from Личное to Команда shows a **warning** ("страница станет видна команде"). Cannot move another user's private page.

### Context menu (`page-context-menu.tsx`)

Add "📦 В архив" / "Восстановить из архива", "Сделать личной" / "Переместить в команду". Existing "В корзину" / "Переместить" / "Дублировать" remain.

### Create flow (`use-create-page-flow.ts` / `create-page-dialog.tsx`)

- "+" next to Команда → creates in TEAM; next to Личное → in PERSONAL.
- Global quick-create with no chosen location → **Личное** by default (Notion-like).
- Nested page inherits parent collection.

### Badges / empty states (1.3/1.5)

- Label "Личное" on private pages, "Поделились" where helpful, archived banner when opening an archived page.
- Empty states: no private pages / no shared pages / empty archive. Reuse the existing share-dialog access-badge UI pattern; don't invent a new one.

## Section 4 — Testing, migration, docs

### Domain/tRPC tests (`packages/trpc/test/`, vitest + real Prisma, self-contained fixtures)

- Workspace member sees the TEAM collection.
- Owner sees their PERSONAL; another member (incl. ADMIN) does NOT see another's PERSONAL in list/search/recents/export.
- `PageShareUser` grant makes a private page visible to the grantee in "Поделились"; revoking removes it.
- `page.create` gets `collectionId` per active location / Private default.
- `moveToCollection` (Private→Team) makes team-visible; `moveToPrivate` removes team visibility.
- `archive` hides from tree/search/collection-home/recents/default-search; `listArchived` finds it for a permitted user; `unarchive` restores; parent archive hides descendants.
- A legacy page with `collectionId` simulated NULL is visible in TEAM.

Each visibility rule is checked on **all** surfaces — the direct anti-leak checklist from 1.5.

### E2E (Playwright, focused spec)

create team page → create private page → other member can't see it → share with one member → appears in "Поделились" → move private→team → visible to team → archive → hidden → restore. Per the E2E-no-yjs caveat: assert tRPC-backed UI (sidebar); do not assert Yjs editor content survival.

### Migration & dev-DB

One Prisma migration as described in Section 1. Migrate from fresh `main`, never reset/db-push (shared dev DB drift).

### Docs

`docs/notion-parity-phase-1-workspace-organization.md`: added models; mapping Collection = Teamspace, Private = personal pages, Shared = explicit grants; archive default-hidden; known limitations (no custom TEAM collections with membership, no database views, no public sites, no enterprise admin override).

### Verification gate

`pnpm --filter @repo/trpc test` · `pnpm --filter web lint` · `pnpm check-types` · focused Playwright · `pnpm gates`.
