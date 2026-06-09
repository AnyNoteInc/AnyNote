# Notion-parity Phase 4C — Database Access Rules + Structure Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side page-level (row-level) database access rules (person/created-by based, restrictive-when-present, broadest-access-wins) and structure permissions (content vs structure editing + a structure lock), enforced across every read/write surface.

**Architecture:** Migration adds `DatabasePageAccessRule` + `DatabaseAccessLevel` enum + `DatabaseSource.structureLocked`. A pure `DatabaseRowAccessResolver` in `@repo/domain` computes the effective level per (viewer, row); a `buildRowAccessWhere` predicate pushes filtering into the DB. All read paths (listRows/grouped/item, relation/rollup traversal, export) funnel through it; all structure mutations call `assertCanEditStructure`. UI gets a page-level-access section + structure-lock toggle + permission-aware affordances.

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8, Next.js 16, MUI v6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-notion-parity-phase-4c-database-access-design.md`

**Reference patterns (study first):** the cl2 `PublicShareAccessResolver` discriminated-result pattern (`packages/domain/src/share-access/`), the cl4B computed-cells batching + `database.service.ts` (`assertCanRead`/`assertCanEdit`, `listRows`/`augmentRows`, the resolver wiring into the view-model), `query-planner.ts` (the `multiSelectPostFilters` + `relationPostFilters` post-filter pattern), `packages/trpc/src/routers/database/*`, the workspace role checks in `page-access.ts`. Architecture: services import `@repo/db` type-only; cross-module via index barrels.

---

## File Structure

**Created:**
- `packages/domain/src/database/services/row-access-resolver.ts` — pure resolver + `buildRowAccessWhere`.
- `packages/domain/test/database/services/row-access-resolver.test.ts`.
- `apps/web/src/components/database/access/{page-access-rules-panel,access-rule-row,structure-lock-toggle}.tsx`.
- Tests: `packages/trpc/test/database-access.test.ts`, `apps/e2e/database-access.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` + migration.
- `packages/domain/src/database/dto/database.dto.ts` (DatabaseAccessLevel re-export, access-rule DTOs, myAccess view-model, setStructureLocked input).
- `packages/domain/src/database/repositories/database.repository.ts` (access-rule CRUD, structureLocked update, role/share lookups for the resolver context, batch rule fetch).
- `packages/domain/src/database/services/database.service.ts` (assertCanEditStructure on structure ops; row-resolver wiring into listRows/grouped/item + per-row edit gating in updateCellValue/updateRow/deleteRow; relation/rollup target filtering through the resolver; access-rule CRUD; setStructureLocked; getMyAccess/myAccess in the view-model).
- `packages/trpc/src/routers/database/{property,view,row,cell,relation,source}.ts` + `index.ts` (assertCanEditStructure-backed procedures; new access-rule + structure-lock procedures).
- `apps/web/src/components/database/property-header-cell.tsx`, `property-config/*`, `database-toolbar.tsx`, `database-table-view.tsx` (permission-aware disabling; mount the access panel).

---

## Phase A — Schema + DTOs

### Task A1: DatabasePageAccessRule + structureLocked migration

**Files:** Modify `packages/db/prisma/schema.prisma`; create migration.

- [ ] **Step 1:** Add `enum DatabaseAccessLevel { CAN_VIEW CAN_COMMENT CAN_EDIT_CONTENT CAN_EDIT FULL_ACCESS }`, the `DatabasePageAccessRule` model (per the spec), `DatabaseSource.structureLocked Boolean @default(false) @map("structure_locked")` + `accessRules DatabasePageAccessRule[]`, and `DatabaseProperty.accessRules DatabasePageAccessRule[]`.
- [ ] **Step 2:** `pnpm --filter @repo/db exec prisma validate` → valid.
- [ ] **Step 3:** Generate migration on a FRESH scratch DB (`anynote_p4c_scratch`, role user/password): baseline `migrate deploy`, then `migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → `packages/db/prisma/migrations/20260609140000_database_access_rules/migration.sql` (CREATE TYPE + CREATE TABLE + ALTER TABLE database_sources ADD structure_locked).
- [ ] **Step 4:** Re-deploy fresh + `migrate diff ... --exit-code` → "No difference detected". Apply the additive DDL to the shared dev DB (`CREATE TYPE`, `CREATE TABLE IF NOT EXISTS` + indexes + FKs, `ALTER TABLE database_sources ADD COLUMN IF NOT EXISTS structure_locked BOOLEAN NOT NULL DEFAULT false`). Drop scratch.
- [ ] **Step 5:** `prisma generate`; commit `feat(db): database page access rules + structure lock`.

### Task A2: access-rule DTOs + access-level mapping

**Files:** Modify `packages/domain/src/database/dto/database.dto.ts`.

- [ ] **Step 1:** Re-export `DatabaseAccessLevel` (value) from `@repo/db`. Add `accessLevelSchema = z.nativeEnum(DatabaseAccessLevel)`. Add DTOs: `createAccessRuleInput = z.object({ pageId: uuid, propertyId: uuid, accessLevel: accessLevelSchema })`, `updateAccessRuleInput = z.object({ pageId: uuid, ruleId: uuid, accessLevel: accessLevelSchema.optional(), enabled: z.boolean().optional() })`, `deleteAccessRuleInput = z.object({ pageId: uuid, ruleId: uuid })`, `setStructureLockedInput = z.object({ pageId: uuid, locked: z.boolean() })`.
- [ ] **Step 2:** Add view-model types: `AccessRuleView = { id, propertyId, accessLevel, enabled }`, `MyDatabaseAccess = { canEditContent: boolean; canEditStructure: boolean; structureLocked: boolean }`. Extend the `getByPage` result type to include `myAccess: MyDatabaseAccess`.
- [ ] **Step 3:** `pnpm --filter @repo/domain check-types`. Commit `feat(domain): access-rule + structure-lock DTOs`.

---

## Phase B — Row access resolver (pure, TDD)

### Task B1: resolveRowAccess + level ordering

**Files:** Create `packages/domain/src/database/services/row-access-resolver.ts`; test `row-access-resolver.test.ts`.

- [ ] **Step 1: Failing tests.** Export `LEVEL_ORDER` (a Record level→number), `maxLevel(a,b)`, and
  `resolveRowAccess(ctx: RowAccessContext, rules: AccessRule[], row: { rowCreatedById: string|null; cellsByProperty: Map<string, unknown> }): DatabaseAccessLevel | null`.
  Tests:
  - no rules + workspace EDITOR → CAN_EDIT_CONTENT; COMMENTER → CAN_COMMENT; VIEWER → CAN_VIEW; non-member (role null, not creator) → null.
  - OWNER/ADMIN → FULL_ACCESS regardless of rules.
  - source page creator → FULL_ACCESS.
  - rules present + viewer NOT matched + only VIEWER role → null (restrictive: a plain member loses access to unmatched rows once rules exist). [This is the key restrictive-semantics test.]
  - a CAN_VIEW PERSON rule where the row's cell = viewerId → CAN_VIEW for that viewer.
  - a CREATED_BY rule where rowCreatedById === viewerId → the rule's level.
  - broadest-access-wins: viewer matched by a CAN_VIEW rule AND has pageShareLevel CAN_EDIT_CONTENT → CAN_EDIT_CONTENT (max).
  - multiple matching rules → max level.
  - anonymous (viewerId null) + rules → null.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test row-access-resolver` → FAIL.
- [ ] **Step 3:** Implement. `RowAccessContext = { viewerId: string|null; workspaceRole: RoleType|null; isSourcePageCreator: boolean; pageShareLevel: DatabaseAccessLevel|null }`. `AccessRule = { propertyId: string; propertyType: 'PERSON'|'CREATED_BY'|...; accessLevel: DatabaseAccessLevel; enabled: boolean }`. Compute the direct level (owner/admin→FULL, creator→FULL, share→mapped, else role-derived ONLY when no enabled rules). When enabled rules exist, start from direct broad-access (owner/admin/creator/share — NOT the plain role level) and raise per matched rule. Return max or null.
- [ ] **Step 4:** Run → PASS. Commit `feat(domain): database row access resolver (broadest-access-wins, restrictive rules)`.

### Task B2: resolveRowAccessForRows + buildRowAccessWhere

**Files:** Modify `row-access-resolver.ts`; extend the test.

- [ ] **Step 1: Failing tests:** `resolveRowAccessForRows(ctx, rules, rows[])` → Map<rowId, level|null> (batch; same semantics per row). `buildRowAccessWhere(ctx, rules): Prisma.DatabaseRowWhereInput | null` → returns `null` when the viewer has broad access (owner/admin/creator → see all); when restricted-with-rules returns an OR of `{ page: { is: { createdById: viewerId } } }` (for CREATED_BY rules) + `{ cells: { some: { propertyId, value: { equals: viewerId } } } }` (for PERSON rules); when rules exist but the viewer matches none structurally AND has no broad access, returns a never-match predicate `{ id: { in: [] } }`.
- [ ] **Step 2:** Run → FAIL. Implement both.
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): batch row-access + DB-level access predicate`.

---

## Phase C — Repository + service integration

### Task C1: repository — access-rule CRUD + resolver context lookups

**Files:** Modify `packages/domain/src/database/repositories/database.repository.ts`.

- [ ] **Step 1:** Add `listAccessRules(sourceId)`, `createAccessRule({sourceId,propertyId,accessLevel})`, `updateAccessRule({id, accessLevel?, enabled?})`, `deleteAccessRule(id)`, `setStructureLocked(sourceId, locked)`, `findEnabledAccessRules(sourceId)` (with the property type joined, for the resolver). Add `findWorkspaceRole(userId, workspaceId)` and `findItemPageShareRole(pageId, userId)` (→ map to a DatabaseAccessLevel) and `isSourcePageCreatedBy(sourcePageId, userId)` for the resolver context — OR confirm existing helpers cover these.
- [ ] **Step 2:** `pnpm --filter @repo/domain check-types`. Commit `feat(domain): access-rule repo + resolver-context lookups`.

### Task C2: service — assertCanEditStructure + access-rule ops + getMyAccess (TDD)

**Files:** Modify `packages/domain/src/database/services/database.service.ts`; test `database.service.test.ts`.

- [ ] **Step 1: Failing tests:** `assertCanEditStructure` allows OWNER/ADMIN/creator when unlocked, blocks a plain EDITOR, blocks everyone but OWNER/ADMIN when `structureLocked`; createProperty/updateProperty/deleteProperty/reorderProperties/createView/updateView/deleteView now require it (a plain EDITOR is blocked). `createAccessRule` rejects a non-PERSON/non-CREATED_BY property; `setStructureLocked`; `getMyAccess` returns the viewer's {canEditContent, canEditStructure, structureLocked}.
- [ ] **Step 2:** Run → FAIL. Implement: `assertCanEditStructure(actor, source)`; gate all structure procedures with it; `createAccessRule`/`updateAccessRule`/`deleteAccessRule`/`listAccessRules` (assertCanEditStructure — managing rules is a structure op); `setStructureLocked` (OWNER/ADMIN); `getMyAccess`. Build the `RowAccessContext` from the repo lookups.
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): structure-edit guard + access-rule ops + getMyAccess`.

### Task C3: service — enforce row access in reads + mutations (TDD)

**Files:** Modify `packages/domain/src/database/services/database.service.ts`; test.

- [ ] **Step 1: Failing tests** (real-DB-ish via mocked repo + a couple integration in trpc-D1): `listRows` with an enabled CAN_VIEW rule hides rows the viewer isn't assigned to (and shows them to the assigned user + owner); `updateCellValue`/`updateRow`/`deleteRow` on a row the viewer only has CAN_VIEW for → FORBIDDEN; with no rules, behavior is unchanged (all members edit). The getByPage `myAccess` is populated.
- [ ] **Step 2:** Run → FAIL. Implement: in `listRows`/`listGroupedRows`/the item-row fetch, build the `RowAccessContext`, apply `buildRowAccessWhere` to the DB query (merged into the existing where) AND post-filter via `resolveRowAccessForRows` (for PERSON-cell precision the DB predicate already covers; the post-filter is the authoritative backstop). In `updateCellValue`/`updateRow`/`deleteRow`, resolve the specific row's level and require `canEditRow`. `getByPage` includes `myAccess`.
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): enforce row access in list/read/mutation paths`.

### Task C4: relation/rollup traversal access filtering (TDD)

**Files:** Modify `packages/domain/src/database/services/{database.service.ts,computed-cells.ts}`; test.

- [ ] **Step 1: Failing tests:** a RELATION chip set excludes target rows the viewer can't access (resolve the TARGET source's rules + viewer); a ROLLUP aggregation only counts accessible target rows.
- [ ] **Step 2:** Run → FAIL. Implement: when resolving relation links + rollup target cells, resolve each target row through the target source's `findEnabledAccessRules` + the viewer context; filter inaccessible targets out of `chipByRowId` and the rollup input set. (Batch the target-source rule fetch per target source.)
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): relation/rollup traversal respects target-row access`.

---

## Phase D — tRPC

### Task D1: router — access-rule + structure-lock procedures; structure guards

**Files:** Modify `packages/trpc/src/routers/database/*` + `index.ts`. Test `packages/trpc/test/database-access.test.ts`.

- [ ] **Step 1: Failing integration tests** (self-contained real-DB, two users: an owner + a restricted member): owner creates a Person property + 2 rows assigned to different users + a CAN_VIEW rule → the restricted member's `listRows` shows only their assigned row; the member's `updateCellValue` on the other row → FORBIDDEN; `createAccessRule` on a TEXT property → error; `setStructureLocked(true)` then the member's `createProperty` → FORBIDDEN (already was, but now also a plain EDITOR is blocked from structure); `getByPage().myAccess` reflects the member's caps; an embedded/export path (if testable at trpc level) respects the rule.
- [ ] **Step 2:** Run `pnpm --filter @repo/trpc test database-access` → FAIL.
- [ ] **Step 3:** Add procedures `database.listAccessRules`, `createAccessRule`, `updateAccessRule`, `deleteAccessRule`, `setStructureLocked` (all → domain, `assertPageEditAccess` at the tRPC layer + `assertCanEditStructure` in the domain). The existing structure procedures (createProperty/view/etc.) already call the domain which now guards — verify. Mount the new procedures. The row read/mutation procedures pass `ctx.user.id` (already do) so the domain resolver runs.
- [ ] **Step 4:** Run → PASS. Commit `feat(trpc): database access-rule + structure-lock procedures`.

---

## Phase E — UI

### Task E1: page-level access panel + structure-lock toggle

**Files:** Create `apps/web/src/components/database/access/{page-access-rules-panel,access-rule-row,structure-lock-toggle}.tsx`; modify `property-config/property-settings-dialog.tsx` or `database-toolbar.tsx` to mount them.

- [ ] **Step 1:** `PageAccessRulesPanel({pageId})` — lists rules (`database.listAccessRules`): each row = the property name + access-level Select + enabled toggle + delete; an "add rule" picking a PERSON/CREATED_BY property (filter `data.properties` to those types) + a level. Clear copy: "Правила ограничивают доступ к строкам на сервере (в отличие от видимости колонок)". `StructureLockToggle({pageId, locked})` → `setStructureLocked` (visible to OWNER/ADMIN). Mount the panel in a "Доступ" section of the database (the property settings dialog or a toolbar menu).
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint`. Commit `feat(web): database page-access rules panel + structure-lock toggle`.

### Task E2: permission-aware affordances

**Files:** Modify `database-toolbar.tsx`, `property-header-cell.tsx`, `property-config/*`, `database-table-view.tsx`, `types.ts`.

- [ ] **Step 1:** Read `data.myAccess` (from `getByPage`). When `!myAccess.canEditStructure` (or `structureLocked`), disable the add-property button, the property settings "Настроить"/rename/delete items, the view-config (filter/sort/add-view) controls, and the access panel's edit controls — each with a tooltip ("Структура заблокирована" when locked, else "Недостаточно прав"). Cell editors: a row the viewer can't edit (only CAN_VIEW) renders readonly — but since `listRows` only returns viewable rows and the per-row level isn't in the row view-model yet, the simplest correct approach for cl4C: gate cell editing on `myAccess.canEditContent` at the source level (a viewer without content-edit can't edit any cell); per-row readonly is a documented follow-up. (If the row view-model already carries a per-row editable flag, use it; otherwise source-level is acceptable + documented.)
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test`. `set -a; . ./.env; set +a; pnpm --filter web build` → exit 0. Commit `feat(web): permission-aware database controls (structure lock + content rights)`.

---

## Phase F — E2E + gate

### Task F1: Playwright database-access spec

**Files:** Create `apps/e2e/database-access.spec.ts`.

- [ ] **Step 1:** Using `signUpAndAuthAs` (two users — the owner + a second member added to the workspace; check how a spec adds a 2nd member, or create the rule scenario such that the owner is restricted by sharing): create a DATABASE with a Person property + 2 rows; add a CAN_VIEW rule on the Person property; assign one row to user B. As user B (a restricted member), `listRows` (via the table) shows only the assigned row. Toggle structure lock → the add-property button is disabled. Note no-yjs; assert tRPC/route-state. If a 2-user flow is too heavy for E2E, assert the structure-lock disabling + the rule panel CRUD + that the OWNER still sees all rows, and cover the restricted-visibility purely at the trpc test level (D1) with a comment.
- [ ] **Step 2:** `pnpm exec playwright test apps/e2e/database-access.spec.ts --retries 1` → pass. Commit `test(e2e): database access rules + structure lock`.

### Task F2: full gate + changelog

- [ ] **Step 1:** `pnpm check-types` (22/22), `pnpm lint`, `pnpm check-architecture`, `pnpm --filter @repo/domain test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web test`, `pnpm --filter engines test` → all pass.
- [ ] **Step 2:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 3:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 4:** Update `docs/changelog.md` (Базы данных: правила доступа + блокировка структуры). Commit.

---

## Self-review notes

- Spec coverage: A1–A2 = model+DTOs; B1–B2 = resolver (the access authority); C1–C4 = repo + structure guard + read/mutation enforcement + relation/rollup traversal; D1 = tRPC; E1–E2 = access panel + structure lock + permission-aware UI; F = e2e + gate.
- The resolver is the SINGLE authority; every read/mutation/relation-rollup path funnels through it (C3, C4). Restrictive-when-present + broadest-access-wins is pinned by the B1 tests.
- Structure permissions: `assertCanEditStructure` guards ALL structure ops (C2); content stays at CAN_EDIT_CONTENT; the lock flag is enforced server-side (not just UI).
- Public/anonymous: viewerId null matches no rule (B1 test) → a ruled database is empty/forbidden publicly (documented in C3/spec).
- Per-row cell-edit readonly is gated at source level in cl4C with a documented follow-up for per-row (E2) — the authoritative mutation gate is server-side (C3), so the UI gap is cosmetic only.
- Type consistency: `RowAccessContext`/`AccessRule`/`resolveRowAccess→level|null`/`buildRowAccessWhere→WhereInput|null`/`resolveRowAccessForRows→Map` (B), `MyDatabaseAccess`/`AccessRuleView` (A2) used by C/D/E. `DatabaseAccessLevel` from @repo/db re-exported via dto.
- Property visibility stays cosmetic everywhere (never gated as ACL); the access panel copy makes the distinction explicit (E1).
