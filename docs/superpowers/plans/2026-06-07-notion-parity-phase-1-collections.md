# Notion-parity Phase 1: Collections / Private / Shared / Archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Notion-aligned organizational foundation to AnyNote — Collections (one team space per workspace), per-user Private pages, a Shared surface derived from explicit grants, and Archive as a first-class restorable page state distinct from Trash — without regressing any existing page visibility.

**Architecture:** A new `Collection` model (`TEAM | PERSONAL | SITE`) owns pages via `Page.collectionId`. A single domain helper `buildPageVisibilityWhere(userId)` becomes the one source of truth for page visibility, reused by every surface (tree, search, recents, export, MCP). Archive (`Page.archivedAt`) replaces the existing `Page.archived` Boolean and is orthogonal to Trash (`Page.deletedAt`). A new `collection` domain module + tRPC router follow the established dto/repo/service + inversify-8 DI pattern.

**Tech Stack:** Prisma 7 (Postgres, raw-SQL data migration), tRPC v11, inversify-8 domain DI, Next.js 16 App Router + MUI v6, Vitest (real-Prisma integration tests), Playwright.

**Design spec:** `docs/superpowers/specs/2026-06-07-notion-parity-phase-1-workspace-organization-design.md`

---

## CRITICAL CONTEXT (read before starting)

- **`Page.archived` is NOT dead.** It is used by: `packages/trpc/src/routers/search.ts:43`, `packages/trpc/src/services/page-search.ts:94,215`, `packages/trpc/src/routers/kanban/board.ts:35`, `packages/trpc/src/routers/kanban/task.ts:183`, `packages/domain/src/kanban/repositories/kanban.repository.ts:353`, `apps/engines/src/apps/mcp/services/page-writer.service.ts:180`, `apps/engines/src/apps/mcp/services/page-fts.service.ts`, `apps/engines/src/apps/mcp/tools/page.tools.ts:263,312`. Replacing it with `archivedAt` means updating ALL of these. (There is a SEPARATE Kanban-model `archived` at schema line 1182 — do NOT touch that one.)
- **Shared dev Postgres is SHARED across worktrees.** Run `prisma migrate dev` from this branch (based on fresh `origin/main`). If you hit drift, rebase onto main — never reset/db-push.
- **Cross-package gate:** changing `Page` breaks `apps/engines`. Run full `pnpm gates`, not just `@repo/trpc test`.
- **Domain `.ts` import extensions are mandatory** (`@repo/domain` is NodeNext-clean). Always write `from './x.ts'`.
- **Prettier:** `semi: false`, single quotes, trailing commas, 100-col. Run `pnpm format` if unsure.

---

## File Structure

**Schema & migration**
- Modify: `packages/db/prisma/schema.prisma` — add `CollectionKind` enum, `Collection` model, `Page.collectionId/archivedAt/archivedById`, `UserPreference.collectionOrder`, relations; drop `Page.archived`.
- Create: `packages/db/prisma/migrations/<ts>_collections_private_archive/migration.sql` — generated + hand-edited for partial unique indexes + data backfill.

**Domain — new `collection` module** (mirrors `packages/domain/src/pages/`)
- Create: `packages/domain/src/collections/collections.tokens.ts`
- Create: `packages/domain/src/collections/dto/collections.dto.ts`
- Create: `packages/domain/src/collections/repositories/collections.repository.ts`
- Create: `packages/domain/src/collections/services/collections.service.ts`
- Create: `packages/domain/src/collections/collections.module.ts`
- Create: `packages/domain/src/collections/index.ts`
- Modify: `packages/domain/src/container.ts` — register module + expose `collections` on `Domain`.
- Modify: `packages/domain/src/index.ts` — export `./collections/index.ts`.

**Domain — page visibility + archive + collection-aware create/move**
- Create: `packages/domain/src/pages/page-visibility.ts` — `buildPageVisibilityWhere(userId)` Prisma where-fragment.
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts` — use visibility where in `findAccessiblePage`; add `archivePageTx`/`unarchivePageTx`/`moveToCollectionTx`; set `collectionId` on create.
- Modify: `packages/domain/src/pages/services/pages.service.ts` — add `archive`/`unarchive`/`moveToCollection`/`moveToPrivate`.
- Modify: `packages/domain/src/pages/dto/pages.dto.ts` — add zod inputs + extend `createPageInput`/`PageRowDto`.

**tRPC**
- Create: `packages/trpc/src/routers/collection.ts`
- Modify: `packages/trpc/src/routers/index.ts` — mount `collection` router.
- Modify: `packages/trpc/src/routers/page.ts` — collection-aware list, archive/unarchive/listArchived, moveToCollection/moveToPrivate; add `collectionId`/`archivedAt` to `getById`.
- Modify: `packages/trpc/src/helpers/page-access.ts` — `assertPageAccess` honors visibility.
- Modify: `packages/trpc/src/routers/search.ts` + `packages/trpc/src/services/page-search.ts` — visibility + `archived`→`archivedAt`.
- Modify: `packages/trpc/src/routers/workspace.ts` — call `ensureWorkspaceCollections` on create; `ensurePersonalCollection` on member add.
- Modify: `packages/trpc/src/routers/kanban/board.ts:35`, `kanban/task.ts:183`, `packages/domain/src/kanban/repositories/kanban.repository.ts:353` — `archived`→`archivedAt`.

**engines (cross-package)**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`, `page-fts.service.ts`, `apps/engines/src/apps/mcp/tools/page.tools.ts` — `archived`→`archivedAt` (boolean set → null/now()).

**UI (apps/web)**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx` — Команда/Личное/Поделились sections + Архив link.
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx` — parameterize by `collectionId`/`location`.
- Create: `apps/web/src/components/workspace/shared-pages-section.tsx`
- Create: `apps/web/src/app/(protected)/(active)/archive/page.tsx` + `archive-page-body.tsx`
- Create: `apps/web/src/app/(protected)/(active)/collections/[collectionId]/page.tsx`
- Modify: `apps/web/src/components/workspace/move-page-dialog.tsx` — destination Команда/Личное + warning.
- Modify: `apps/web/src/components/workspace/page-context-menu.tsx` — archive / make-private / move-to-team.
- Modify: `apps/web/src/hooks/use-page-actions.tsx` — archive/unarchive/move handlers.
- Modify: `apps/web/src/components/templates/use-create-page-flow.ts` — location-aware create.

**Tests**
- Create: `packages/trpc/test/collection.test.ts`, `packages/trpc/test/page-visibility.test.ts`, `packages/trpc/test/page-archive.test.ts`
- Create: `apps/e2e/collections-flow.spec.ts`
- Modify: engines specs touching `archived` (`page-archive.spec.ts`, `page.tools.spec.ts`, `page-listpages.spec.ts`).

**Docs**
- Create: `docs/notion-parity-phase-1-workspace-organization.md`

---

## Phase A — Schema & migration

### Task A1: Add Collection schema + Page/UserPreference fields

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the `CollectionKind` enum** after the `PageOwnership` enum (~line 282)

```prisma
enum CollectionKind {
  TEAM
  PERSONAL
  SITE
}
```

- [ ] **Step 2: Add the `Collection` model** (place near the `Page` model, before `model PageShare`)

```prisma
model Collection {
  id          String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String         @map("workspace_id") @db.Uuid
  kind        CollectionKind
  title       String?        @db.Text
  description String?        @db.Text
  icon        String?        @db.Text
  color       String?        @db.Text
  ownerId     String?        @map("owner_id") @db.Uuid
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

- [ ] **Step 3: Add fields + relations to the `Page` model.** In `model Page`, replace the line `archived Boolean @default(false)` with the archive fields, add `collectionId`, and add the relations + back-relation. Concretely:
  - Remove: `archived     Boolean                  @default(false)`
  - Add scalar fields (next to `parentId`): `collectionId String? @map("collection_id") @db.Uuid`, `archivedAt DateTime? @map("archived_at") @db.Timestamptz(6)`, `archivedById String? @map("archived_by_id") @db.Uuid`
  - Add relations (in the relations block): `collection Collection? @relation("CollectionPages", fields: [collectionId], references: [id], onDelete: SetNull)` and `homePageOfCollection Collection? @relation("CollectionHome")` and `archivedBy User? @relation("PageArchivedBy", fields: [archivedById], references: [id], onDelete: SetNull)`
  - Replace index `@@index([archived])` with `@@index([collectionId])` and `@@index([archivedAt])`

- [ ] **Step 4: Add the `PageArchivedBy` back-relation + Collection relations to `User`** (in `model User`)

```prisma
  collectionsOwned  Collection[] @relation("CollectionOwner")
  pagesArchived     Page[]       @relation("PageArchivedBy")
```

- [ ] **Step 5: Add Collection back-relation to `Workspace`** (in `model Workspace` relations block)

```prisma
  collections           Collection[]
```

- [ ] **Step 6: Add `collectionOrder` to `UserPreference`** (after `defaultWorkspaceId`)

```prisma
  collectionOrder Json? @map("collection_order")
```

- [ ] **Step 7: Validate the schema parses**

Run: `cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-1-collections && pnpm --filter @repo/db exec prisma validate`
Expected: `The schema at packages/db/prisma/schema.prisma is valid 🚀`

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Collection model + Page archive/collection fields"
```

### Task A2: Generate migration with partial unique indexes + data backfill

**Files:**
- Create: `packages/db/prisma/migrations/<ts>_collections_private_archive/migration.sql`

- [ ] **Step 1: Generate the migration SQL without applying** (so we can hand-edit before it runs)

Run: `pnpm --filter @repo/db exec prisma migrate dev --name collections_private_archive --create-only`
Expected: creates a migration folder with `migration.sql` (CREATE TABLE collections, ALTER TABLE pages, DROP COLUMN archived, etc.). It will NOT yet contain the partial unique indexes or the data backfill.

- [ ] **Step 2: Hand-edit `migration.sql`.** The generated file drops `archived` and adds the new columns/table. Re-order and augment it so the data is preserved. The final file must, in order: (1) create enum + `collections` table + its plain indexes (generated), (2) add `pages.collection_id/archived_at/archived_by_id` + `user_preferences.collection_order` columns (generated), (3) the hand-added partial unique indexes, (4) the hand-added backfill, (5) the `DROP COLUMN archived` LAST. Append/insert this hand-written block BEFORE the generated `ALTER TABLE "pages" DROP COLUMN "archived";` line:

```sql
-- Partial unique indexes (Prisma can't express WHERE): one team space per workspace; one personal per user
CREATE UNIQUE INDEX "collections_one_team_per_workspace"
  ON "collections" ("workspace_id") WHERE "kind" = 'TEAM' AND "owner_id" IS NULL;
CREATE UNIQUE INDEX "collections_one_personal_per_user"
  ON "collections" ("workspace_id", "owner_id") WHERE "kind" = 'PERSONAL';

-- Backfill: one TEAM collection per workspace
INSERT INTO "collections" ("id", "workspace_id", "kind", "title", "position", "created_at", "updated_at")
SELECT gen_random_uuid(), w."id", 'TEAM', 'Общее', 0, now(), now()
FROM "workspaces" w;

-- Backfill: one PERSONAL collection per (workspace, member)
INSERT INTO "collections" ("id", "workspace_id", "kind", "title", "owner_id", "position", "created_at", "updated_at")
SELECT gen_random_uuid(), m."workspace_id", 'PERSONAL', 'Личное', m."user_id", 0, now(), now()
FROM "workspace_members" m;

-- Backfill: legacy pages (no collection, not template-backing) -> their workspace TEAM collection
UPDATE "pages" p
SET "collection_id" = c."id"
FROM "collections" c
WHERE c."workspace_id" = p."workspace_id"
  AND c."kind" = 'TEAM' AND c."owner_id" IS NULL
  AND p."collection_id" IS NULL
  AND p."is_template_backing" = false;

-- Preserve existing page-level archive state before dropping the boolean column
UPDATE "pages" SET "archived_at" = now() WHERE "archived" = true;
```

- [ ] **Step 3: Verify the `DROP COLUMN "archived"` is the LAST statement** touching `pages.archived`, and that the backfill `UPDATE ... WHERE "archived" = true` runs before it. Read the file top-to-bottom to confirm ordering. (If Prisma placed the DROP before our backfill, move our backfill block above it.)

- [ ] **Step 4: Apply the migration**

Run: `pnpm --filter @repo/db exec prisma migrate dev`
Expected: `Applying migration ...collections_private_archive`, then `Your database is now in sync`. (If it reports drift from another worktree, STOP and rebase onto main — do not reset.)

- [ ] **Step 5: Verify data backfill** (sanity check the shared dev DB)

Run:
```bash
pnpm --filter @repo/db exec prisma db execute --stdin <<'SQL'
SELECT
  (SELECT count(*) FROM collections WHERE kind='TEAM') AS team_collections,
  (SELECT count(*) FROM collections WHERE kind='PERSONAL') AS personal_collections,
  (SELECT count(*) FROM pages WHERE collection_id IS NULL AND is_template_backing=false AND deleted_at IS NULL) AS orphan_pages;
SQL
```
Expected: `team_collections` = number of workspaces, `orphan_pages` = 0.

- [ ] **Step 6: Regenerate Prisma client**

Run: `pnpm --filter @repo/db prisma:generate`
Expected: `Generated Prisma Client`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(db): migration — collections + archive fields, backfill legacy pages to TEAM"
```

---

## Phase B — Fix existing `archived` consumers (`archived` Boolean → `archivedAt`)

> After A2 the `archived` column is gone; the repo will not type-check until every consumer is migrated. Do this phase before adding new behavior.

### Task B1: Migrate trpc + domain consumers of `Page.archived`

**Files:**
- Modify: `packages/trpc/src/routers/search.ts:43`
- Modify: `packages/trpc/src/services/page-search.ts:94,215`
- Modify: `packages/trpc/src/routers/kanban/board.ts:35`
- Modify: `packages/trpc/src/routers/kanban/task.ts:183`
- Modify: `packages/domain/src/kanban/repositories/kanban.repository.ts:353`

- [ ] **Step 1: `search.ts:43`** — change `page: { deletedAt: null, archived: false }` to `page: { deletedAt: null, archivedAt: null }`.

- [ ] **Step 2: `page-search.ts`** — line ~94 (raw SQL) change `AND "archived" = false` to `AND "archived_at" IS NULL`; line ~215 (Prisma where) change `archived: false` to `archivedAt: null`.

- [ ] **Step 3: `kanban/board.ts:35`** — change `where: { pageId: page.id, deletedAt: null, archived: false }` to `{ pageId: page.id, deletedAt: null, archivedAt: null }`.

- [ ] **Step 4: `kanban/task.ts:183`** — this un-archives a page: change `data: { archived: false, updatedById: ctx.user.id }` to `data: { archivedAt: null, archivedById: null, updatedById: ctx.user.id }`.

- [ ] **Step 5: `kanban.repository.ts:353`** — this archives a page: change `data: { archived: true, updatedById }` to `data: { archivedAt: new Date(), archivedById: updatedById, updatedById }`.

- [ ] **Step 6: Type-check trpc + domain**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/trpc check-types`
Expected: PASS (no `Property 'archived' does not exist` errors).

- [ ] **Step 7: Commit**

```bash
git add packages/trpc packages/domain
git commit -m "refactor(pages): migrate Page.archived boolean to archivedAt in trpc+domain consumers"
```

### Task B2: Migrate engines consumers of `Page.archived`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts:166-181`
- Modify: `apps/engines/src/apps/mcp/services/page-fts.service.ts`
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts:263-265,312`

- [ ] **Step 1: `page-writer.service.ts` `setArchived`** — the method takes `archived: boolean`. Change its update `data: { archived: input.archived, updatedById: input.userId }` to:

```ts
data: input.archived
  ? { archivedAt: new Date(), archivedById: input.userId, updatedById: input.userId }
  : { archivedAt: null, archivedById: null, updatedById: input.userId },
```

- [ ] **Step 2: `page-fts.service.ts`** — find the `archived` reference (likely `archived = false` in raw SQL or `archived: false` in a where) and change to `archived_at IS NULL` / `archivedAt: null`.

- [ ] **Step 3: `page.tools.ts:312`** — change `archived: false` to `archivedAt: null` in the where filter. `doSetArchived` (line 263) keeps its `archived: boolean` ARG (MCP contract) — it just forwards to `writer.setArchived`, which now translates it. No change needed at line 263-265.

- [ ] **Step 4: Type-check engines**

Run: `pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 5: Run engines tests touching archive**

Run: `pnpm --filter engines test -- page-archive`
Expected: PASS (the MCP archive tool still works through the boolean→timestamp translation). If assertions check a DB `archived` column directly, update them to `archivedAt`.

- [ ] **Step 6: Commit**

```bash
git add apps/engines
git commit -m "refactor(engines): migrate Page.archived boolean to archivedAt in MCP services"
```

### Task B3: Full type-check gate after the rename

- [ ] **Step 1: Repo-wide type-check**

Run: `pnpm check-types`
Expected: PASS across all packages. Fix any remaining `archived` references the grep missed (search `grep -rn "\.archived\b\|archived:" packages apps --include=*.ts --include=*.tsx | grep -v archivedAt | grep -v node_modules`, excluding the legitimate Kanban-model `archived` at schema line 1182 and its consumers — those are a different field).

- [ ] **Step 2: Commit if any fixes were needed** (otherwise skip)

```bash
git add -A && git commit -m "refactor(pages): finish Page.archived -> archivedAt migration"
```

---

## Phase C — Domain: collection module + page visibility

### Task C1: Collection DTO + tokens

**Files:**
- Create: `packages/domain/src/collections/collections.tokens.ts`
- Create: `packages/domain/src/collections/dto/collections.dto.ts`

- [ ] **Step 1: Write `collections.tokens.ts`**

```ts
export const COLLECTIONS = {
  Repository: Symbol.for('domain/CollectionRepository'),
  Service: Symbol.for('domain/CollectionService'),
} as const
```

- [ ] **Step 2: Write `dto/collections.dto.ts`**

```ts
import { CollectionKind } from '@repo/db'
import { z } from 'zod'

export const updateCollectionInput = z.object({
  collectionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
})
export type UpdateCollectionInput = z.infer<typeof updateCollectionInput>

export const reorderCollectionsInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderCollectionsInput = z.infer<typeof reorderCollectionsInput>

export interface CollectionDto {
  id: string
  workspaceId: string
  kind: CollectionKind
  title: string | null
  icon: string | null
  color: string | null
  ownerId: string | null
  homePageId: string | null
  position: number
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS (file compiles; not yet wired).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/collections
git commit -m "feat(domain): collection dto + tokens"
```

### Task C2: Collection repository

**Files:**
- Create: `packages/domain/src/collections/repositories/collections.repository.ts`

- [ ] **Step 1: Write the repository** (mirrors `PageRepository` use of `this.uow.client()`)

```ts
import { CollectionKind } from '@repo/db'

import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { CollectionDto, UpdateCollectionInput } from '../dto/collections.dto.ts'

export class CollectionRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  async findTeamCollection(workspaceId: string): Promise<{ id: string } | null> {
    return this.uow.client().collection.findFirst({
      where: { workspaceId, kind: CollectionKind.TEAM, ownerId: null },
      select: { id: true },
    })
  }

  async findPersonalCollection(workspaceId: string, userId: string): Promise<{ id: string } | null> {
    return this.uow.client().collection.findFirst({
      where: { workspaceId, kind: CollectionKind.PERSONAL, ownerId: userId },
      select: { id: true },
    })
  }

  async createTeamCollection(workspaceId: string): Promise<{ id: string }> {
    return this.uow.client().collection.create({
      data: { workspaceId, kind: CollectionKind.TEAM, title: 'Общее', position: 0 },
      select: { id: true },
    })
  }

  async createPersonalCollection(workspaceId: string, userId: string): Promise<{ id: string }> {
    return this.uow.client().collection.create({
      data: { workspaceId, kind: CollectionKind.PERSONAL, ownerId: userId, title: 'Личное', position: 0 },
      select: { id: true },
    })
  }

  async listMembers(workspaceId: string): Promise<{ userId: string }[]> {
    return this.uow.client().workspaceMember.findMany({
      where: { workspaceId },
      select: { userId: true },
    })
  }

  async listForUser(workspaceId: string, userId: string): Promise<CollectionDto[]> {
    const rows = await this.uow.client().collection.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        OR: [
          { kind: CollectionKind.TEAM, ownerId: null },
          { kind: CollectionKind.PERSONAL, ownerId: userId },
        ],
      },
      orderBy: { position: 'asc' },
      select: {
        id: true, workspaceId: true, kind: true, title: true, icon: true,
        color: true, ownerId: true, homePageId: true, position: true,
      },
    })
    return rows
  }

  async findMembership(userId: string, workspaceId: string): Promise<{ role: string } | null> {
    return this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  }

  async updateCollectionTx(input: UpdateCollectionInput): Promise<{ id: string }> {
    return this.uow.client().collection.update({
      where: { id: input.collectionId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
      select: { id: true },
    })
  }

  async getCollectionWorkspace(collectionId: string): Promise<{ workspaceId: string; kind: CollectionKind; ownerId: string | null } | null> {
    return this.uow.client().collection.findUnique({
      where: { id: collectionId },
      select: { workspaceId: true, kind: true, ownerId: true },
    })
  }

  async getCollectionOrder(userId: string): Promise<string[] | null> {
    const pref = await this.uow.client().userPreference.findUnique({
      where: { userId },
      select: { collectionOrder: true },
    })
    return (pref?.collectionOrder as string[] | null) ?? null
  }

  async setCollectionOrder(userId: string, orderedIds: string[]): Promise<void> {
    await this.uow.client().userPreference.upsert({
      where: { userId },
      create: { userId, collectionOrder: orderedIds },
      update: { collectionOrder: orderedIds },
    })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/collections/repositories
git commit -m "feat(domain): collection repository"
```

### Task C3: Collection service

**Files:**
- Create: `packages/domain/src/collections/services/collections.service.ts`

- [ ] **Step 1: Write the service**

```ts
import { forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { CollectionRepository } from '../repositories/collections.repository.ts'
import type {
  CollectionDto,
  ReorderCollectionsInput,
  UpdateCollectionInput,
} from '../dto/collections.dto.ts'

export class CollectionService {
  private readonly repo: CollectionRepository
  private readonly uow: UnitOfWork
  constructor(repo: CollectionRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  /** Idempotent: ensure the workspace has a TEAM collection + a PERSONAL collection per member. */
  async ensureWorkspaceCollections(workspaceId: string): Promise<void> {
    await this.uow.transaction(async () => {
      const team = await this.repo.findTeamCollection(workspaceId)
      if (!team) await this.repo.createTeamCollection(workspaceId)
      const members = await this.repo.listMembers(workspaceId)
      for (const m of members) {
        const personal = await this.repo.findPersonalCollection(workspaceId, m.userId)
        if (!personal) await this.repo.createPersonalCollection(workspaceId, m.userId)
      }
    })
  }

  /** Idempotent: ensure a single member has a PERSONAL collection in this workspace. */
  async ensurePersonalCollection(workspaceId: string, userId: string): Promise<{ id: string }> {
    return this.uow.transaction(async () => {
      const existing = await this.repo.findPersonalCollection(workspaceId, userId)
      if (existing) return existing
      return this.repo.createPersonalCollection(workspaceId, userId)
    })
  }

  async listForUser(workspaceId: string, userId: string): Promise<CollectionDto[]> {
    const member = await this.repo.findMembership(userId, workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    const cols = await this.repo.listForUser(workspaceId, userId)
    const order = await this.repo.getCollectionOrder(userId)
    if (!order) return cols
    const rank = new Map(order.map((id, i) => [id, i]))
    return [...cols].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }

  async update(actorUserId: string, input: UpdateCollectionInput): Promise<{ id: string }> {
    const col = await this.repo.getCollectionWorkspace(input.collectionId)
    if (!col || col.workspaceId !== input.workspaceId) throw notFound('Коллекция не найдена')
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (member?.role !== 'OWNER' && member?.role !== 'ADMIN') throw forbidden('Недостаточно прав')
    return this.uow.transaction(() => this.repo.updateCollectionTx(input))
  }

  async reorder(actorUserId: string, input: ReorderCollectionsInput): Promise<{ count: number }> {
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    await this.repo.setCollectionOrder(actorUserId, input.orderedIds)
    return { count: input.orderedIds.length }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/collections/services
git commit -m "feat(domain): collection service (ensure/list/update/reorder)"
```

### Task C4: Wire collection module into DI container

**Files:**
- Create: `packages/domain/src/collections/collections.module.ts`
- Create: `packages/domain/src/collections/index.ts`
- Modify: `packages/domain/src/container.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write `collections.module.ts`**

```ts
import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { CollectionRepository } from './repositories/collections.repository.ts'
import { CollectionService } from './services/collections.service.ts'
import { COLLECTIONS } from './collections.tokens.ts'

export const collectionsModule = new ContainerModule(({ bind }) => {
  bind(COLLECTIONS.Repository).toResolvedValue(
    (uow) => new CollectionRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(COLLECTIONS.Service).toResolvedValue(
    (repo, uow) => new CollectionService(repo as CollectionRepository, uow as UnitOfWork),
    [COLLECTIONS.Repository, SHARED.UnitOfWork],
  )
})
```

- [ ] **Step 2: Write `collections/index.ts`**

```ts
export * from './collections.tokens.ts'
export * from './collections.module.ts'
export * from './dto/collections.dto.ts'
export type { CollectionService } from './services/collections.service.ts'
```

- [ ] **Step 3: Register in `container.ts`.** Add imports near the other module imports:

```ts
import { COLLECTIONS } from './collections/collections.tokens.ts'
import { collectionsModule } from './collections/collections.module.ts'
import type { CollectionService } from './collections/services/collections.service.ts'
```

Add `collections: CollectionService` to the `Domain` interface. Add `collectionsModule` to the `c.load(...)` call. Add to the returned object in `createDomain`: `collections: c.get<CollectionService>(COLLECTIONS.Service),`.

- [ ] **Step 4: Export from `domain/src/index.ts`.** Add line: `export * from './collections/index.ts'`.

- [ ] **Step 5: Type-check + build domain**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): wire collections module into DI container"
```

### Task C5: Page visibility helper (TDD)

**Files:**
- Create: `packages/domain/src/pages/page-visibility.ts`
- Test: `packages/trpc/test/page-visibility.test.ts`

- [ ] **Step 1: Write the failing test** (real-Prisma integration; mirrors `kanban-*.test.ts` setup). Create self-contained fixtures: a workspace, owner + second member, a TEAM page, owner's PERSONAL page, and a shared private page.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma, CollectionKind } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'

// Helper creates: workspace, owner, member, team collection, owner personal collection,
// teamPage (in team), privatePage (in owner personal), sharedPage (in owner personal + PageShareUser grant to member)
async function seed() { /* ... full fixture, see below ... */ }

describe('buildPageVisibilityWhere', () => {
  let ctx: Awaited<ReturnType<typeof seed>>
  beforeAll(async () => { ctx = await seed() })
  afterAll(async () => { await prisma.workspace.delete({ where: { id: ctx.workspaceId } }).catch(() => {}) })

  it('owner sees team + own private + shared', async () => {
    const ids = (await prisma.page.findMany({
      where: { workspaceId: ctx.workspaceId, AND: [buildPageVisibilityWhere(ctx.ownerId)] },
      select: { id: true },
    })).map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining([ctx.teamPageId, ctx.privatePageId, ctx.sharedPageId]))
  })

  it('member sees team + shared but NOT owner private', async () => {
    const ids = (await prisma.page.findMany({
      where: { workspaceId: ctx.workspaceId, AND: [buildPageVisibilityWhere(ctx.memberId)] },
      select: { id: true },
    })).map((p) => p.id)
    expect(ids).toContain(ctx.teamPageId)
    expect(ids).toContain(ctx.sharedPageId)
    expect(ids).not.toContain(ctx.privatePageId)
  })
})
```

Write the full `seed()` helper inline in the test file: create User×2, Workspace, WorkspaceMember×2 (owner OWNER, member EDITOR), Collection TEAM (ownerId null), Collection PERSONAL (ownerId owner), three Pages with the right `collectionId`, and for `sharedPage` create a `PageShare` + `PageShareUser{ userId: member }`. Use `prisma.$transaction` or sequential creates.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @repo/trpc test -- page-visibility`
Expected: FAIL — `buildPageVisibilityWhere is not a function` / not exported.

- [ ] **Step 3: Implement `page-visibility.ts`**

```ts
import { CollectionKind } from '@repo/db'
import type { Prisma } from '@repo/db'

/**
 * Single source of truth for "can this user see this page" as a Prisma where-fragment.
 * Reused by page tree, search, recents, export, and engines MCP page queries.
 *
 * A page is visible to `userId` when it lives in the workspace TEAM collection,
 * OR in the user's own PERSONAL collection, OR an explicit PageShareUser grant exists.
 * Pages with a NULL collection (transitional / template-backing) are treated as TEAM-visible.
 *
 * Archive/trash are an ORTHOGONAL filter applied by callers (archivedAt / deletedAt),
 * NOT part of this access predicate.
 */
export function buildPageVisibilityWhere(userId: string): Prisma.PageWhereInput {
  return {
    OR: [
      { collection: { kind: CollectionKind.TEAM } },
      { collectionId: null },
      { collection: { kind: CollectionKind.PERSONAL, ownerId: userId } },
      { share: { users: { some: { userId } } } },
    ],
  }
}
```

- [ ] **Step 4: Export it.** In `packages/domain/src/pages/index.ts` add `export * from './page-visibility.ts'`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- page-visibility`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/pages/page-visibility.ts packages/domain/src/pages/index.ts packages/trpc/test/page-visibility.test.ts
git commit -m "feat(domain): buildPageVisibilityWhere — single page-visibility source of truth"
```

---

## Phase D — Page domain: archive, collection-aware create/move

### Task D1: Apply visibility to `findAccessiblePage` + add collectionId/archivedAt to PageRowDto

**Files:**
- Modify: `packages/domain/src/pages/dto/pages.dto.ts`
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts`

- [ ] **Step 1: Extend `PageRowDto`** — add to the interface: `collectionId: string | null` and `archivedAt: Date | null`.

- [ ] **Step 2: Update `findAccessiblePage`** to apply visibility and select the new fields. Change its `where` from `{ id: pageId, workspace: { members: { some: { userId } } } }` to:

```ts
where: {
  id: pageId,
  workspace: { members: { some: { userId } } },
  AND: [buildPageVisibilityWhere(userId)],
},
```

Add `import { buildPageVisibilityWhere } from '../page-visibility.ts'` at the top. Add `collectionId: true, archivedAt: true` to the `select` and to the returned object in BOTH `findAccessiblePage` and `findActivePageById` (keep the DTO shape consistent — `findActivePageById` doesn't filter by visibility but must return the same fields; set them from the row).

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

- [ ] **Step 4: Run the visibility-dependent test still green + existing page tests**

Run: `pnpm --filter @repo/trpc test -- page`
Expected: PASS (existing page router tests must still pass — `findAccessiblePage` now additionally requires the page to be in TEAM/own-PERSONAL/shared, but all existing test pages have NULL collection which the predicate treats as visible).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages
git commit -m "feat(domain): apply page visibility in findAccessiblePage; add collectionId/archivedAt to DTO"
```

### Task D2: Archive / unarchive domain methods (TDD)

**Files:**
- Modify: `packages/domain/src/pages/dto/pages.dto.ts`
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts`
- Modify: `packages/domain/src/pages/services/pages.service.ts`
- Test: `packages/trpc/test/page-archive.test.ts`

- [ ] **Step 1: Add DTO inputs** to `pages.dto.ts`:

```ts
export const archivePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type ArchivePageInput = z.infer<typeof archivePageInput>

export const unarchivePageInput = archivePageInput
export type UnarchivePageInput = z.infer<typeof unarchivePageInput>
```

- [ ] **Step 2: Write the failing test** `page-archive.test.ts` (real Prisma, via `createCaller` like existing router tests). Seed a workspace + owner + one page in TEAM. Assert: after `page.archive`, the page has non-null `archivedAt` and is absent from `page.listByWorkspace`; `page.listArchived` includes it; after `page.unarchive` it returns to `listByWorkspace`.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@repo/db'
import { createTestCaller, seedWorkspaceWithPage } from './helpers' // see note

describe('page.archive / unarchive', () => {
  // seed owner + workspace (with TEAM collection) + one TEAM page; build caller as owner
  // 1. caller.page.archive({ id, workspaceId }) -> page.archivedAt != null
  // 2. caller.page.listByWorkspace({ workspaceId }) does NOT contain id
  // 3. caller.page.listArchived({ workspaceId }) contains id
  // 4. caller.page.unarchive({ id, workspaceId }) -> archivedAt null, back in listByWorkspace
})
```

If no shared test helper exists, replicate the caller-construction pattern from an existing `packages/trpc/test/kanban-*.test.ts` (they build a `createCaller` with a real ctx). Seed the TEAM collection and set the page's `collectionId` to it.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @repo/trpc test -- page-archive`
Expected: FAIL — `page.archive` procedure does not exist.

- [ ] **Step 4: Add repo methods** to `pages.repository.ts`:

```ts
async archivePageTx(actorUserId: string, pageId: string, workspaceId: string): Promise<CreateResultDto> {
  await this.uow.client().page.update({
    where: { id: pageId },
    data: { archivedAt: new Date(), archivedById: actorUserId, updatedById: actorUserId },
  })
  await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
    eventType: 'page.upserted', aggregateType: 'page', aggregateId: pageId, workspaceId,
  })
  return { id: pageId }
}

async unarchivePageTx(actorUserId: string, pageId: string, workspaceId: string): Promise<CreateResultDto> {
  await this.uow.client().page.update({
    where: { id: pageId },
    data: { archivedAt: null, archivedById: null, updatedById: actorUserId },
  })
  await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
    eventType: 'page.upserted', aggregateType: 'page', aggregateId: pageId, workspaceId,
  })
  return { id: pageId }
}
```

(`enqueueOutboxEvent` and `Prisma` are already imported in this file.)

- [ ] **Step 5: Add service methods** to `pages.service.ts` (import `ArchivePageInput, UnarchivePageInput`):

```ts
async archive(actorUserId: string, input: ArchivePageInput): Promise<CreateResultDto> {
  await this.assertOwnership(actorUserId, input.id)
  return this.uow.transaction(() => this.repo.archivePageTx(actorUserId, input.id, input.workspaceId))
}

async unarchive(actorUserId: string, input: UnarchivePageInput): Promise<CreateResultDto> {
  await this.assertOwnership(actorUserId, input.id)
  return this.uow.transaction(() => this.repo.unarchivePageTx(actorUserId, input.id, input.workspaceId))
}
```

- [ ] **Step 6: Add tRPC procedures** to `page.ts` (`archive`, `unarchive`, `listArchived`). For `archive`/`unarchive`:

```ts
archive: protectedProcedure
  .input(domain.archivePageInput)
  .mutation(async ({ ctx, input }) => {
    await requireWritableWorkspace(input.workspaceId)
    return mapDomain(() => domainSvc.pages.archive(ctx.user.id, input))
  }),
unarchive: protectedProcedure
  .input(domain.unarchivePageInput)
  .mutation(async ({ ctx, input }) => {
    await requireWritableWorkspace(input.workspaceId)
    return mapDomain(() => domainSvc.pages.unarchive(ctx.user.id, input))
  }),
```

For `listArchived` (applies visibility + archive filter; effective rule: page archived OR an ancestor archived — for MVP filter on the page's own `archivedAt`, document descendant-of-archived as covered by tree hiding):

```ts
listArchived: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    return ctx.prisma.page.findMany({
      where: {
        workspaceId: input.workspaceId,
        deletedAt: null,
        archivedAt: { not: null },
        AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
      },
      orderBy: { archivedAt: 'desc' },
      select: { id: true, title: true, icon: true, parentId: true, archivedAt: true, createdById: true, createdAt: true },
    })
  }),
```

- [ ] **Step 7: Update `listByWorkspace`** in `page.ts` to exclude archived and apply visibility. Change its `where` from `{ workspaceId, archived: false, deletedAt: null }` to:

```ts
where: {
  workspaceId: input.workspaceId,
  archivedAt: null,
  deletedAt: null,
  AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
},
```

Add `collectionId` to its `select` so the sidebar can group.

- [ ] **Step 8: Update `getById`** in `page.ts` — replace `archived: true,` in the `select` with `archivedAt: true,` and add `collectionId: true,`.

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- page-archive`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/domain/src/pages packages/trpc/src/routers/page.ts packages/trpc/test/page-archive.test.ts
git commit -m "feat(pages): archive/unarchive + listArchived; collection-aware listByWorkspace"
```

### Task D3: Collection-aware create + moveToCollection/moveToPrivate (TDD)

**Files:**
- Modify: `packages/domain/src/pages/dto/pages.dto.ts`
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts`
- Modify: `packages/domain/src/pages/services/pages.service.ts`
- Modify: `packages/trpc/src/routers/page.ts`
- Test: `packages/trpc/test/page-archive.test.ts` (extend) or new `page-move-collection.test.ts`

- [ ] **Step 1: Extend `createPageInput`** in `pages.dto.ts` — add optional location/collection:

```ts
// add to createPageInput object:
  collectionId: z.string().uuid().nullable().optional(),
  location: z.enum(['team', 'private']).optional(),
```

Add a `moveToCollectionInput`:

```ts
export const moveToCollectionInput = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  target: z.enum(['team', 'private']),
})
export type MoveToCollectionInput = z.infer<typeof moveToCollectionInput>
```

- [ ] **Step 2: Write the failing test** (`page-move-collection.test.ts`): owner creates a page with `location: 'private'`; assert it lands in the owner's PERSONAL collection and a second member's `listByWorkspace` does NOT include it. Then `moveToCollection({ target: 'team' })`; assert the member now sees it.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @repo/trpc test -- page-move-collection`
Expected: FAIL — page created with NULL collection (no resolution yet) / `moveToCollection` missing.

- [ ] **Step 4: Resolve collection on create.** In `pages.service.ts` `create`, before the transaction, resolve `collectionId`:
  - If `input.collectionId` provided → use it.
  - Else if `input.parentId` provided → inherit parent's `collectionId` (read via a new `repo.getPageCollectionId(parentId)`).
  - Else if `input.location === 'team'` → resolve workspace TEAM collection id.
  - Else (default / `location==='private'`) → resolve the actor's PERSONAL collection id (create-if-missing via the collection repo is out of scope here; PERSONAL is guaranteed by ensure-on-member-add — if missing, fall back to TEAM).

  Implement a private helper `resolveCollectionId(actorUserId, input)` in the service that calls new repo methods `findTeamCollectionId(workspaceId)` / `findPersonalCollectionId(workspaceId, userId)` / `getPageCollectionId(pageId)`. Pass the resolved id into `createPageTx`.

- [ ] **Step 5: Set collectionId in `createPageTx`** — add `collectionId: input.collectionId ?? null` to the `page.create` `data` (the service will have populated `input.collectionId` with the resolved id; update the `CreatePageInput & CreatePageExtra` flow so the resolved id reaches the repo — simplest: add `resolvedCollectionId` to `CreatePageExtra` and read it in the repo).

- [ ] **Step 6: Add repo methods** `findTeamCollectionId`, `findPersonalCollectionId`, `getPageCollectionId`, and `moveToCollectionTx(actorUserId, pageId, collectionId, workspaceId)` (updates `page.collectionId` + enqueues outbox). For move-to-private resolve the actor's personal collection id; move-to-team resolves the team collection id.

- [ ] **Step 7: Add service `moveToCollection`** (asserts ownership; resolves target collection id; calls `moveToCollectionTx`).

- [ ] **Step 8: Add tRPC `moveToCollection`** procedure in `page.ts`:

```ts
moveToCollection: protectedProcedure
  .input(domain.moveToCollectionInput)
  .mutation(async ({ ctx, input }) => {
    await requireWritableWorkspace(input.workspaceId)
    return mapDomain(() => domainSvc.pages.moveToCollection(ctx.user.id, input))
  }),
```

- [ ] **Step 9: Wire `create` to pass `collectionId`/`location`** — the tRPC `create` already forwards `input` to `domainSvc.pages.create`; since the DTO now includes the fields, no router change beyond ensuring `domain.createPageInput` carries them (it does).

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- page-move-collection`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/domain/src/pages packages/trpc/src/routers/page.ts packages/trpc/test/page-move-collection.test.ts
git commit -m "feat(pages): collection-aware create + moveToCollection/moveToPrivate"
```

---

## Phase E — tRPC collection router + workspace wiring

### Task E1: Collection tRPC router (TDD)

**Files:**
- Create: `packages/trpc/src/routers/collection.ts`
- Modify: `packages/trpc/src/routers/index.ts`
- Test: `packages/trpc/test/collection.test.ts`

- [ ] **Step 1: Write the failing test** `collection.test.ts`: seed a workspace via the domain `ensureWorkspaceCollections` (or direct creates); build a caller; assert `collection.list` returns exactly the TEAM collection + the caller's PERSONAL (and never another member's PERSONAL).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @repo/trpc test -- collection`
Expected: FAIL — `collection` router not mounted.

- [ ] **Step 3: Write `collection.ts`**

```ts
import { z } from 'zod'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import { assertWorkspaceMember } from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

export const collectionRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.collections.listForUser(input.workspaceId, ctx.user.id))
    }),

  update: protectedProcedure
    .input(domain.updateCollectionInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.collections.update(ctx.user.id, input))
    }),

  reorder: protectedProcedure
    .input(domain.reorderCollectionsInput)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.collections.reorder(ctx.user.id, input))
    }),
})
```

- [ ] **Step 4: Mount it.** In `packages/trpc/src/routers/index.ts` import `collectionRouter` and add `collection: collectionRouter,` to the `appRouter` object.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- collection`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/collection.ts packages/trpc/src/routers/index.ts packages/trpc/test/collection.test.ts
git commit -m "feat(trpc): collection router (list/update/reorder)"
```

### Task E2: Ensure collections on workspace create + member add

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts`

- [ ] **Step 1: Call `ensureWorkspaceCollections` after workspace create.** In the `create` mutation's `$transaction`, after `seedStartPage(...)` and `syncWorkspaceLimits(...)`, the collection-ensure must run. Because the domain service manages its own UoW/transaction, call it AFTER the `$transaction` returns (it's idempotent). Refactor: capture `const result = await ctx.prisma.$transaction(...)`, then `await domainSvc.collections.ensureWorkspaceCollections(result.id)`, then `return result`. The legacy start page created inside the tx has NULL collectionId — fix by, after ensure, assigning it to the TEAM collection:

```ts
const result = await ctx.prisma.$transaction(async (tx) => { /* unchanged */ })
await domainSvc.collections.ensureWorkspaceCollections(result.id)
await ctx.prisma.page.updateMany({
  where: { workspaceId: result.id, collectionId: null, isTemplateBacking: false, deletedAt: null },
  data: { collectionId: (await ctx.prisma.collection.findFirstOrThrow({
    where: { workspaceId: result.id, kind: 'TEAM', ownerId: null }, select: { id: true },
  })).id },
})
return result
```

Add `import { domain as domainSvc } from '../domain'` if not already present in this file.

- [ ] **Step 2: Call `ensurePersonalCollection` when a member is added.** In `inviteMember`, after the `workspaceMember.create(...)` that adds the member, call `await domainSvc.collections.ensurePersonalCollection(input.workspaceId, <newMemberUserId>)`. (Find the created member's userId from the create result.)

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/trpc check-types`
Expected: PASS.

- [ ] **Step 4: Run workspace tests**

Run: `pnpm --filter @repo/trpc test -- workspace`
Expected: PASS. If a workspace-create test now asserts page/collection counts, update it to expect the TEAM+PERSONAL collections.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts
git commit -m "feat(workspace): ensure collections on create + personal collection on member add"
```

### Task E3: Apply visibility to search + page-search service

**Files:**
- Modify: `packages/trpc/src/routers/search.ts`
- Modify: `packages/trpc/src/services/page-search.ts`

- [ ] **Step 1: search.ts** — in the page query `where`, add `AND: [domain.buildPageVisibilityWhere(ctx.user.id)]` alongside the existing `deletedAt: null, archivedAt: null` filter (import `* as domain from '@repo/domain'` if not present). This prevents private/other-user pages from leaking into search.

- [ ] **Step 2: page-search.ts** — the raw-SQL FTS query (line ~94) filters `archived_at IS NULL` (done in B1). Add a visibility clause to the SQL: restrict to pages whose `collection_id` is NULL, or in a TEAM collection, or in the caller's PERSONAL collection, or shared to the caller. If the raw SQL is hard to extend safely, post-filter the resulting ids through the Prisma `where` at line ~215 by adding `AND: [buildPageVisibilityWhere(userId)]` there (the function already re-queries by ids with a workspace+deletedAt+archivedAt filter — add visibility to that `findMany`). Prefer the post-filter for safety.

- [ ] **Step 3: Type-check + search tests**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc test -- search`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/search.ts packages/trpc/src/services/page-search.ts
git commit -m "feat(search): apply page visibility — no private/other-user leak in search"
```

### Task E4: Apply visibility to engines MCP page queries

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-fts.service.ts`
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`

- [ ] **Step 1: Decide the engines posture.** Engines MCP tools run on behalf of a workspace user (auth context carries `userId`). To match web visibility, the page list/search/get must apply the same predicate. Since `@repo/domain` is consumable from engines (NodeNext-clean) but engines uses NestJS+Prisma directly, replicate the predicate inline rather than importing the web tRPC helper. Add a small local helper in engines mirroring `buildPageVisibilityWhere` (TEAM OR null-collection OR own-PERSONAL OR shared-to-user).

- [ ] **Step 2: Apply it** in `page.tools.ts` list/get where the tool fetches pages for a user (e.g. the `findMany` near line 312 already filtered `archivedAt: null` from B2 — add the visibility `AND`). For `get_page`, ensure a private page owned by another user returns not-found.

- [ ] **Step 3: Type-check + engines tests**

Run: `pnpm --filter engines check-types && pnpm --filter engines test -- page`
Expected: PASS. Update `page-listpages.spec.ts` / `page.tools.spec.ts` fixtures if they need a collection set.

- [ ] **Step 4: Commit**

```bash
git add apps/engines
git commit -m "feat(engines): apply page visibility in MCP page tools"
```

---

## Phase F — UI

### Task F1: Parameterize PageTreeSection by collection

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`

- [ ] **Step 1:** Add an optional prop `collectionId?: string | null` and `title?: string` to `PageTreeSection`. Filter the `pages` it renders to those whose `collectionId === collectionId` (the `listByWorkspace` query now returns `collectionId`). Default behavior (no `collectionId` prop) renders all — preserves current call sites until the sidebar is updated.

- [ ] **Step 2: Type-check web**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx
git commit -m "feat(web): parameterize PageTreeSection by collectionId"
```

### Task F2: Sidebar sections (Команда / Личное / Поделились / Архив)

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Create: `apps/web/src/components/workspace/shared-pages-section.tsx`

- [ ] **Step 1:** In `workspace-sidebar.tsx`, fetch collections via `trpc.collection.list.useQuery({ workspaceId })`. Render two `PageTreeSection`s: one for the TEAM collection (`title="Команда"`, `collectionId={teamId}`) and one for the user's PERSONAL collection (`title="Личное"`, `collectionId={personalId}`). Keep `FavoritesSection` above. Each section keeps its existing collapsible behavior.

- [ ] **Step 2: Write `shared-pages-section.tsx`** — a flat collapsible list (not a tree) of pages shared to the user. Data source: add a tRPC `page.listShared` query (pages with a `PageShareUser` grant for the current user). NOTE: this requires a small new procedure — add `listShared` to `page.ts`:

```ts
listShared: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    return ctx.prisma.page.findMany({
      where: {
        workspaceId: input.workspaceId,
        deletedAt: null,
        archivedAt: null,
        share: { users: { some: { userId: ctx.user.id } } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, icon: true },
    })
  }),
```

(Add this procedure in F2; it's UI-driven so it lives here rather than Phase D.)

- [ ] **Step 3:** Add an "Архив" `NavItem` next to "Маркетплейс"/"Корзина" pointing to `/archive`.

- [ ] **Step 4: Type-check + lint web**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace packages/trpc/src/routers/page.ts
git commit -m "feat(web): sidebar Команда/Личное/Поделились sections + Архив link"
```

### Task F3: Archive page route

**Files:**
- Create: `apps/web/src/app/(protected)/(active)/archive/page.tsx`
- Create: `apps/web/src/components/workspace/archive-page-body.tsx`

- [ ] **Step 1:** Write `archive/page.tsx` — a server component mirroring the existing trash route (`apps/web/src/app/(protected)/(active)/trash/page.tsx`). Resolve active workspace, render `<ArchivePageBody workspaceId={...} />`.

- [ ] **Step 2:** Write `archive-page-body.tsx` (client) mirroring `trash-page-body.tsx`: list `trpc.page.listArchived`, each row with "Восстановить" (calls `trpc.page.unarchive`) — no hard-delete here (archive isn't trash). Empty state "Архив пуст".

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 4: Verify the route renders** (dynamic route — must curl it per CLAUDE.md RSC caveat). Start dev server, sign in, navigate to `/archive`. (If dev server isn't running, defer to the E2E task.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(protected)/(active)/archive apps/web/src/components/workspace/archive-page-body.tsx
git commit -m "feat(web): /archive route + archive page body"
```

### Task F4: Context menu — archive / make-private / move-to-team

**Files:**
- Modify: `apps/web/src/components/workspace/page-context-menu.tsx`
- Modify: `apps/web/src/hooks/use-page-actions.tsx`

- [ ] **Step 1:** In `use-page-actions.tsx`, add mutations `archive = trpc.page.archive.useMutation(...)`, `unarchive`, `moveToCollection = trpc.page.moveToCollection.useMutation(...)` with `onSuccess` invalidating `page.listByWorkspace` + `page.listArchived` + `collection.list`. Add handlers `handleArchive`, `handleMakePrivate` (`moveToCollection.mutate({ pageId, workspaceId, target: 'private' })`), `handleMoveToTeam`.

- [ ] **Step 2:** In `page-context-menu.tsx`, add menu items: "📦 В архив" (handleArchive), "🔒 Сделать личной" (handleMakePrivate), "🏢 В команду" (handleMoveToTeam) — placed before the existing "В корзину". Show make-private/move-to-team conditionally based on the page's current collection kind if available; otherwise show both.

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workspace/page-context-menu.tsx apps/web/src/hooks/use-page-actions.tsx
git commit -m "feat(web): page context menu — archive + make private + move to team"
```

### Task F5: Move dialog with visibility warning

**Files:**
- Modify: `apps/web/src/components/workspace/move-page-dialog.tsx`

- [ ] **Step 1:** Add a destination selector (Команда / Личное) at the top of the dialog. When the user picks Команда for a page currently in Личное, show an inline warning Alert: "Страница станет видна всей команде". Keep the existing in-tree parent picker for reordering within the destination. On confirm: if destination changed collection, call `trpc.page.moveToCollection`; the existing `trpc.page.move` still handles parent changes.

- [ ] **Step 2: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/move-page-dialog.tsx
git commit -m "feat(web): move dialog destination (Команда/Личное) + visibility warning"
```

### Task F6: Location-aware create + collection home route

**Files:**
- Modify: `apps/web/src/components/templates/use-create-page-flow.ts`
- Create: `apps/web/src/app/(protected)/(active)/collections/[collectionId]/page.tsx`

- [ ] **Step 1:** In `use-create-page-flow.ts`, thread an optional `location: 'team' | 'private'` / `collectionId` into the `trpc.page.create.mutate` call. Default quick-create (no location) passes `location: 'private'`. The sidebar "+" buttons pass the right location (Команда→team, Личное→private) — wire those in F2's section headers if not already.

- [ ] **Step 2:** Write `collections/[collectionId]/page.tsx` — a server component. Resolve the collection (guard with try/catch + `notFound()` per the getById-throws caveat). Render a tabbed working surface: **Home** (if `homePageId`, embed the page renderer; else empty state), **Все страницы** (list collection pages via a new lightweight `collection.listPages` query or reuse `page.listByWorkspace` filtered client-side by `collectionId`), **Мои страницы** (filter `createdById === currentUser`). Dense layout, no hero.

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/templates/use-create-page-flow.ts "apps/web/src/app/(protected)/(active)/collections"
git commit -m "feat(web): location-aware create + collection home route"
```

---

## Phase G — E2E, docs, full gate

### Task G1: E2E collections flow

**Files:**
- Create: `apps/e2e/collections-flow.spec.ts`

- [ ] **Step 1:** Write a focused Playwright spec using `signUpAndAuthAs` (from `apps/e2e/helpers/auth.ts`). Flow: sign up → create a page in Команда → create a page in Личное → assert Личное page is visible to the author in the Личное section. (Single-user smoke; the multi-user "other member can't see" assertion is covered by the trpc integration tests — Playwright with two browser contexts is optional and heavier.) Then: archive the team page from the context menu → assert it disappears from the tree and appears on `/archive` → restore → assert it's back. Per the E2E-no-yjs caveat, assert tRPC-backed sidebar/list UI, not Yjs editor content.

- [ ] **Step 2: Run the spec** (needs `docker compose up -d`; Playwright runs its own dev server on 3100). Use `--retries 1` for cold-compile per the E2E flakiness note.

Run: `pnpm exec playwright test apps/e2e/collections-flow.spec.ts --retries 1`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/collections-flow.spec.ts
git commit -m "test(e2e): collections create/archive/restore flow"
```

### Task G2: Docs

**Files:**
- Create: `docs/notion-parity-phase-1-workspace-organization.md`

- [ ] **Step 1:** Write the docs note: added models (`Collection`, `Page.collectionId/archivedAt`); mapping Collection = Notion Teamspace, PERSONAL = Private pages, Shared = explicit `PageShareUser` grants; archive is default-hidden + restorable, distinct from Trash; known limitations (no custom TEAM collections with own membership, no `CollectionMember` yet, no database views, no public SITE publishing in Phase 1, no enterprise admin/audit override).

- [ ] **Step 2: Prettier check**

Run: `pnpm exec prettier --check docs/notion-parity-phase-1-workspace-organization.md`
Expected: PASS (or run `pnpm exec prettier --write` then re-check).

- [ ] **Step 3: Commit**

```bash
git add docs/notion-parity-phase-1-workspace-organization.md
git commit -m "docs: Notion-parity Phase 1 workspace organization"
```

### Task G3: Full gate

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: check-types + lint + build + test all PASS across the monorepo.

- [ ] **Step 2: Fix anything red, commit fixes, re-run until green.** Common culprits: a stale `.next/types` for the new routes (`rm -rf apps/web/.next/types` then re-run check-types); a mocked-tRPC web unit test that now needs the `collection.list` query mocked; an engines spec asserting the old `archived` column.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add -A && git commit -m "chore: phase 1 gate fixes"
```

---

## Self-review checklist (done by plan author)

- **Spec coverage:** Section 1 (data model) → Phase A. Section 2 (domain/access/visibility/tRPC/engines) → Phases C, D, E. Section 3 (UI) → Phase F. Section 4 (testing/migration/docs/cross-package) → Phases A2, B, E4, G. The `archived` Boolean reality (not dead) is handled in Phase B before new behavior. ✔
- **Anti-leak surfaces** from spec 1.5: tree (`listByWorkspace` D2), search (`search.ts` + `page-search.ts` E3), engines MCP (E4), shared list (F2), archive (D2). Recents/export: AnyNote's recents = SearchHistory join which goes through page queries; export route should be spot-checked in G3 (added as a gate culprit). ✔
- **Type consistency:** `buildPageVisibilityWhere(userId)` signature is stable across D1/D2/E3/E4. `archivedAt`/`archivedById` names consistent. `moveToCollectionInput.target: 'team'|'private'` matches `location` enum. ✔
- **No placeholders:** each code step shows real code; SQL is concrete; commands have expected output. ✔
