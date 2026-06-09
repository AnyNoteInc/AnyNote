# Notion-parity Phase 4B — Rich Properties, Formula Engine, Relations/Rollups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the full database property type set with real editors, a sandboxed compute-on-read formula engine, relations/back-relations, and rollups — plus a property-settings panel to configure them.

**Architecture:** Migration adds enum types + a `DatabaseRelationLink` table. A pure `@repo/domain/database/formula/` engine (tokenizer→parser→evaluator, date-fns) evaluates formulas on read. The row view-model resolves computed cells (relation chips, rollups, formulas, readonly metadata) in dependency order. New cell editors + a property-settings panel make it usable.

**Tech Stack:** Prisma 7, tRPC v11, Zod, inversify 8, date-fns (new domain dep), Next.js 16, MUI v6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-notion-parity-phase-4b-database-rich-properties-design.md`

**Reference patterns (study first):** Phase-3/4A database module `packages/domain/src/database/` (dto `propertySettingsSchema`, service `validateCellValue`/`mapRow`/`listRows`, `query-planner.ts` `multiSelectPostFilters`), `apps/web/src/components/database/cell-editors/{cell-dispatch.tsx,select-cell.tsx,use-optimistic-cell.ts}`, `database-toolbar.tsx` `CREATABLE_PROPERTY_TYPES`, `property-header-cell.tsx` (rename/delete only — extend), `trpc.workspace.listMembers`, `/api/files/upload?kind=attachment` + `apps/web/src/components/kanban/task/task-attachments.tsx`, `page.listByWorkspace`. Architecture: services import `@repo/db` type-only; cross-module via index barrel; dto re-exports enum values.

---

## File Structure

**Created:**
- `packages/domain/src/database/formula/` — `tokenizer.ts`, `parser.ts`, `ast.ts` (AST types + zod), `evaluator.ts`, `functions.ts`, `index.ts`.
- `packages/domain/test/database/formula/{tokenizer,parser,evaluator}.test.ts`.
- `packages/domain/src/database/services/computed-cells.ts` (resolve formula/rollup/relation/metadata for a row set).
- `apps/web/src/components/database/cell-editors/{multi-select-cell,person-cell,file-cell,url-cell,email-cell,phone-cell,page-link-cell,relation-cell,computed-cell}.tsx`.
- `apps/web/src/components/database/property-config/{property-settings-dialog,options-editor,formula-editor,relation-config,rollup-config,number-format-picker}.tsx`.
- Tests: `packages/trpc/test/database-rich.test.ts`, `apps/e2e/database-rich.spec.ts`.

**Modified:**
- `packages/db/prisma/schema.prisma` + migration; `packages/domain/package.json` (date-fns).
- `packages/domain/src/database/dto/database.dto.ts` (enum re-exports, settings schema, relation/rollup/formula DTOs, AST schema import).
- `packages/domain/src/database/services/database.service.ts` (validateCellValue cases, computed-cell integration, setRelationLinks, listLinkableRows, createProperty/updateProperty settings validation).
- `packages/domain/src/database/repositories/database.repository.ts` (relation-link CRUD, isWorkspaceMember, linkable rows).
- `packages/domain/src/database/services/query-planner.ts` (RELATION is_any_of post-filter; PERSON/URL/EMAIL/PHONE need no special case).
- `packages/trpc/src/routers/database/{property,row,cell}.ts` + `index.ts` (setRelationLinks, listLinkableRows, validateFormula; FILE/PAGE_LINK/PERSON existence checks).
- `apps/web/src/components/database/cell-editors/cell-dispatch.tsx`, `database-toolbar.tsx`, `property-header-cell.tsx`, `types.ts`.

---

## Phase A — Schema + settings types

### Task A1: enum + DatabaseRelationLink migration

**Files:** Modify `packages/db/prisma/schema.prisma`; create migration.

- [ ] **Step 1:** Add to `DatabasePropertyType`: `URL EMAIL PHONE FORMULA RELATION ROLLUP PAGE_LINK CREATED_TIME CREATED_BY LAST_EDITED_TIME LAST_EDITED_BY`. Add the `DatabaseRelationLink` model exactly per the spec, with the two `DatabaseRow` reverse relations (`relationLinks @relation("RelationLinkSource")`, `relationLinksTo @relation("RelationLinkTarget")`) and `DatabaseProperty.relationLinks DatabaseRelationLink[]`.
- [ ] **Step 2:** `pnpm --filter @repo/db exec prisma validate` → valid.
- [ ] **Step 3:** Generate migration on a FRESH scratch DB (`anynote_p4b_scratch`, role user/password): baseline `migrate deploy`, then `migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` → `packages/db/prisma/migrations/20260609120000_database_rich_properties/migration.sql`. Review: ALTER TYPE ADD VALUE ×11 + CREATE TABLE database_relation_links + indexes/FKs. (Postgres 16 allows multiple ADD VALUE; the table CREATE is a separate statement — fine.)
- [ ] **Step 4:** Re-deploy fresh + `migrate diff ... --exit-code` → "No difference detected". Apply the additive DDL to the shared dev DB (`ALTER TYPE ... ADD VALUE IF NOT EXISTS` ×11 + the CREATE TABLE IF NOT EXISTS + indexes). Drop scratch.
- [ ] **Step 5:** `prisma generate`; commit `feat(db): rich database property types + relation-link table`.

### Task A2: settings schema + relation/rollup/formula DTOs

**Files:** Modify `packages/domain/src/database/dto/database.dto.ts`.

- [ ] **Step 1:** Extend `propertySettingsSchema`: add `numberFormat: z.enum(['plain','integer','decimal','percent','currency_rub']).optional()`, `formula: z.string().optional()`, `relation: z.object({ targetSourceId: z.string().uuid(), backRelationPropertyId: z.string().uuid().optional() }).optional()`, `rollup: z.object({ relationPropertyId: z.string().uuid(), targetPropertyId: z.string(), aggregation: z.enum([...the 13 aggregations]) }).optional()`. Keep `options`.
- [ ] **Step 2:** Add `setRelationLinksInput = z.object({ pageId: uuid, rowId: uuid, propertyId: uuid, targetRowIds: z.array(uuid) })`, `listLinkableRowsInput = z.object({ pageId: uuid, propertyId: uuid, query: z.string().optional() })`. Add view-model types `RelationChip = { rowId, pageId, title, icon }`, `ComputedCell = { value: unknown } | { error: string }`, and extend `DatabaseRowView.cells` doc to note computed entries.
- [ ] **Step 3:** `pnpm --filter @repo/domain check-types` → pass.
- [ ] **Step 4:** Commit `feat(domain): rich property settings + relation/rollup DTOs`.

---

## Phase B — Formula engine (pure, TDD)

### Task B1: tokenizer

**Files:** Create `packages/domain/src/database/formula/tokenizer.ts`; test `packages/domain/test/database/formula/tokenizer.test.ts`.

- [ ] **Step 1: Failing tests:** `tokenize('1 + 2')` → `[{num 1},{op +},{num 2}]`; strings `"abc"`; idents/function names; `prop("Name")` (ident `prop` + paren + string + paren); operators `+ - * / == != >= <= > < && || !`; parens/commas; whitespace skipped; an unterminated string → throws a tokenizer error; numbers with decimals.
- [ ] **Step 2:** Run `pnpm --filter @repo/domain test tokenizer` → FAIL.
- [ ] **Step 3:** Implement `tokenize(src: string): Token[]` (a `Token` union: number/string/ident/operator/paren/comma). Pure, no deps.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(domain): formula tokenizer`.

### Task B2: AST + parser

**Files:** Create `packages/domain/src/database/formula/ast.ts`, `parser.ts`; test `parser.test.ts`.

- [ ] **Step 1:** `ast.ts` — the AST node union (`NumberLit, StringLit, BoolLit, PropRef {name}, Call {fn, args}, Unary {op, arg}, Binary {op, left, right}`) + a zod schema validating a parsed AST shape.
- [ ] **Step 2: Failing tests:** `parse('1 + 2 * 3')` respects precedence (`Binary + (1, Binary * (2,3))`); `prop("A")` → `PropRef`; `if(prop("x") > 1, "hi", "lo")` → `Call if [Binary, Str, Str]`; `!empty(prop("x"))` → `Unary ! (Call)`; `&&`/`||` precedence; parens override; unbalanced parens → parser error; trailing tokens → error.
- [ ] **Step 3:** Run → FAIL. Implement `parse(tokens: Token[]): AstNode` (recursive descent with operator precedence: `|| < && < comparison < additive < multiplicative < unary < primary`).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(domain): formula parser (recursive descent + precedence)`.

### Task B3: evaluator + functions

**Files:** Create `packages/domain/src/database/formula/{functions.ts,evaluator.ts,index.ts}`; test `evaluator.test.ts`. Modify `packages/domain/package.json` (add `date-fns`).

- [ ] **Step 1:** Add `date-fns` to `packages/domain/package.json` dependencies; `pnpm install`. Verify `pnpm check-architecture` still clean (date-fns is adapter-tier-pure).
- [ ] **Step 2: Failing tests:** `evaluate(parse(tokenize('1+2')), scope)` → 3; `prop("A")` reads `scope.A`; `if(true,"x","y")` → "x"; `concat("a","b")` → "ab"; `empty(null)` → true, `empty("")` → true, `empty("x")` → false; `round(3.14159, 2)` → 3.14; `sum(1,2,3)` → 6; `min/max`; `length("ab")` → 2; `contains("abc","b")` → true; date: `dateBetween(d1,d2,'days')`, `dateAdd(d,1,'days')`, `formatDate(d,'yyyy-MM-dd')` (via date-fns); comparison/logical operators; division by zero → error; unknown function → FormulaError; unknown prop → null (or error — pick null for forgiving Notion-like behavior); a scope value that's an `{__error}` propagates as error; **sandbox tests**: a formula can't reach `process`/`global`/`constructor`/`Function` (these aren't idents the evaluator resolves — assert `prop("constructor")` → null, `eval(...)` → unknown-function error).
- [ ] **Step 3:** Run → FAIL. Implement `functions.ts` (the whitelist map name→impl, date fns using date-fns), `evaluator.ts` (`evaluate(node, scope): FormulaValue` where `FormulaValue = string|number|boolean|Date|null|{__error}`), `index.ts` exporting `runFormula(expression: string, scope: Record<string, unknown>): FormulaValue` (tokenize→parse→evaluate, catching parse/eval errors into `{__error}`).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(domain): formula evaluator + function library (sandboxed, date-fns)`.

---

## Phase C — Domain: computed cells + relations/rollups + validation

### Task C1: relation-link repository + isWorkspaceMember + linkable rows

**Files:** Modify `packages/domain/src/database/repositories/database.repository.ts`.

- [ ] **Step 1:** Add `replaceRelationLinks({ propertyId, rowId, targetRowIds })` (delete existing links for (propertyId,rowId), insert the new set, in a tx), `findRelationLinks(propertyId, rowIds[])` (→ Map rowId→targetRowId[]), `findRowsByIds(ids[])` (→ title/icon/pageId for relation chips, excluding deleted), `isWorkspaceMember(userId, workspaceId)`, `findLinkableRows(targetSourceId, query?)` (rows of the target source for the picker, with title, excluding deleted). Wrap multi-write ops in `this.uow.transaction`.
- [ ] **Step 2:** `pnpm --filter @repo/domain check-types`. Commit `feat(domain): relation-link repo + member/linkable-row lookups`.

### Task C2: computed-cells resolver (TDD)

**Files:** Create `packages/domain/src/database/services/computed-cells.ts`; test in `database.service.test.ts` or a focused `computed-cells.test.ts`.

- [ ] **Step 1: Failing tests** (pure-ish, mock the relation/page lookups): `resolveComputedCells(rows, properties, deps)` returns, per row, a `cells` map where FORMULA cells = `runFormula(prop.settings.formula, scopeByName)`, ROLLUP cells = the aggregation over related target values, RELATION cells = the target chips, readonly metadata = from the row's page meta. A circular formula (A refs B refs A) → `{__error:'circular'}` on both, no crash. ROLLUP `sum`/`count_all`/`count_values`/`min`/`max`/`average`/`earliest`/`latest`.
- [ ] **Step 2:** Run → FAIL. Implement `resolveComputedCells`: build a name→value scope from stored cells + metadata; topologically evaluate formulas with a visiting-set cycle guard; aggregate rollups from the pre-fetched relation links + target cells. Returns the augmented cells per row. Pure given its `deps` (the relation links map, target cell values, page metadata) — the service fetches those and passes them in.
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): compute-on-read formula/rollup/relation/metadata resolver`.

### Task C3: service integration — validateCellValue, setRelationLinks, listLinkableRows, property validation

**Files:** Modify `packages/domain/src/database/services/database.service.ts`; test `database.service.test.ts`.

- [ ] **Step 1: Failing tests:** `updateCellValue` rejects writes to FORMULA/ROLLUP/CREATED_*/LAST_EDITED_* (BAD_REQUEST); PERSON validates membership (non-member → BAD_REQUEST); URL/EMAIL/PHONE format validation; `setRelationLinks` replaces links + syncs back-relation when configured; cross-workspace target rejected; `listLinkableRows` returns target-source rows; `createProperty`/`updateProperty` validate FORMULA (parseable), RELATION (targetSourceId is a source in the workspace), ROLLUP (relationPropertyId is a RELATION prop + targetPropertyId valid); `listRows`/`getByPage`-row-fetch now return computed cells.
- [ ] **Step 2:** Run → FAIL. Implement: extend `validateCellValue` (PERSON/URL/EMAIL/PHONE cases; reject read-only types); `setRelationLinks` (assertCanEdit, validate targets same workspace, replaceRelationLinks + mirror); `listLinkableRows`; property-settings validation in create/update; wire `resolveComputedCells` into `listRows`/`listGroupedRows`/the item-row fetch (fetch relation links + rollup target cells + page metadata for the page of rows, then resolve).
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): rich cell validation + relations + computed cells in view-model`.

### Task C4: query planner — RELATION post-filter; hide computed from filterable

**Files:** Modify `packages/domain/src/database/services/query-planner.ts`; test `query-planner.test.ts`.

- [ ] **Step 1: Failing tests:** a RELATION `is_any_of` condition → pushed to `multiSelectPostFilters`-style (reuse the mechanism: a relation post-filter checking the row's linked target ids); FORMULA/ROLLUP/CREATED_*/LAST_EDITED_* conditions are ignored (return null — they're not filterable in 4B). 
- [ ] **Step 2:** Run → FAIL. Implement: treat RELATION like MULTI_SELECT for is_any_of/is_none_of (a relation post-filter; the service resolves the row's links to apply it). Computed types return null from the planner (documented no-filter).
- [ ] **Step 3:** Run → PASS. Commit `feat(domain): relation filter post-pass; computed columns non-filterable`.

---

## Phase D — tRPC

### Task D1: router — setRelationLinks, listLinkableRows, validateFormula, existence checks

**Files:** Modify `packages/trpc/src/routers/database/{property,row,cell}.ts` + `index.ts`. Test `packages/trpc/test/database-rich.test.ts`.

- [ ] **Step 1: Failing tests** (self-contained real-DB): `setRelationLinks` links rows + the row view-model shows the relation chip; a back-relation mirror appears on the target; `listLinkableRows` returns target-source rows; `createProperty` ROLLUP shows a count in the view-model; a FORMULA property shows a computed value; `updateCellValue` on a FILE cell with a non-existent fileId → error (tRPC existence check); PERSON with a non-member → error; writing a FORMULA cell → error.
- [ ] **Step 2:** Run `pnpm --filter @repo/trpc test database-rich` → FAIL.
- [ ] **Step 3:** Add `setRelationLinks` (`assertPageEditAccess` → `domainSvc.database.setRelationLinks`), `listLinkableRows` (`assertPageAccess`), `validateFormula` (parse-only, returns `{ok}|{error}`); in the `updateCellValue` procedure, BEFORE the domain call, when the property is FILE validate the `File` exists in the workspace, when PAGE_LINK validate the page exists+visible (the domain does the UUID/type-format checks). Mount the new procedures.
- [ ] **Step 4:** Run → PASS. Commit `feat(trpc): relation links, linkable rows, formula validation, file/page existence checks`.

---

## Phase E — UI: cell editors

### Task E1: multi-select, person, file editors

**Files:** Create `cell-editors/{multi-select-cell,person-cell,file-cell}.tsx`; modify `cell-dispatch.tsx`.

- [ ] **Step 1:** `MultiSelectCell` (chips from `property.settings.options`, add/remove, commit string[] via the optimistic hook). `PersonCell` (`trpc.workspace.listMembers` picker, stores userId, renders avatar+name). `FileCell` (upload via `fetch('/api/files/upload?kind=attachment')` → `updateCellValue value=fileId`; render link/`/api/files/[id]` thumbnail via `trpc.file.getById`). Wire all three into `cell-dispatch.tsx` (replace the TextCell fallthrough).
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint` → pass. Commit `feat(web): multi-select/person/file cell editors`.

### Task E2: url/email/phone, page-link, relation, computed editors

**Files:** Create `cell-editors/{url-cell,email-cell,phone-cell,page-link-cell,relation-cell,computed-cell}.tsx`; modify `cell-dispatch.tsx`.

- [ ] **Step 1:** `Url/Email/PhoneCell` (validated text input + a clickable open/mailto/tel affordance). `PageLinkCell` (page picker over `page.listByWorkspace` cache, renders icon+title chip → `/pages/[id]`). `RelationCell` (picker via `trpc.database.listLinkableRows` → `setRelationLinks`; renders target-row title chips that open the target item modal `?rowId=`). `ComputedCell` (readonly renderer for FORMULA/ROLLUP/CREATED_*/LAST_EDITED_* — formats the value, shows an error chip for `{__error}`, formats numbers per format, dates per locale). Wire into `cell-dispatch.tsx`.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint` → pass. Commit `feat(web): url/email/phone/page-link/relation/computed cell editors`.

---

## Phase F — UI: property settings panel + creatable types

### Task F1: property settings dialog (options/colors, number format, formula, relation, rollup)

**Files:** Create `property-config/{property-settings-dialog,options-editor,formula-editor,relation-config,rollup-config,number-format-picker}.tsx`; modify `property-header-cell.tsx`.

- [ ] **Step 1:** `PropertySettingsDialog` opened from `PropertyHeaderCell` (add a "Настроить" menu item). Sections by type: `OptionsEditor` (SELECT/STATUS/MULTI_SELECT: add/remove/reorder options + a color picker per option), `NumberFormatPicker` (NUMBER), `FormulaEditor` (FORMULA: a textarea + a function reference list + live validation via `trpc.database.validateFormula`), `RelationConfig` (RELATION: target database-source picker [list the workspace's DATABASE pages/sources] + optional "create back-relation"), `RollupConfig` (ROLLUP: pick a RELATION property on this source + a target property + an aggregation). All write via `trpc.database.updateProperty`.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint && pnpm --filter web test` → pass (fix any web test referencing the old property header). Commit `feat(web): property settings panel (options/format/formula/relation/rollup)`.

### Task F2: creatable property types + build verify

**Files:** Modify `database-toolbar.tsx`, `types.ts`.

- [ ] **Step 1:** Extend `CREATABLE_PROPERTY_TYPES` to include MULTI_SELECT, PERSON, FILE, URL, EMAIL, PHONE, PAGE_LINK, FORMULA, RELATION, ROLLUP (with Russian labels + icons via `@repo/ui/components`); readonly metadata types (CREATED_TIME/BY, LAST_EDITED_TIME/BY) in a "Системные" submenu. On creating FORMULA/RELATION/ROLLUP, open the settings dialog immediately to configure.
- [ ] **Step 2:** `pnpm check-types && pnpm --filter web lint`. `set -a; . ./.env; set +a; pnpm --filter web build` → exit 0 (client-bundle: import dto types TYPE-ONLY, never the runtime formula/settings schema — the Phase-4A gotcha). Commit `feat(web): creatable rich property types`.

---

## Phase G — E2E + gate

### Task G1: Playwright database-rich spec

**Files:** Create `apps/e2e/database-rich.spec.ts`.

- [ ] **Step 1:** Using `signUpAndAuthAs` + the warmed create-DATABASE-page flow (see `apps/e2e/database-views.spec.ts`): add a FORMULA property (e.g. `concat(prop("Название")," !")`) → a row shows the computed value; add a PERSON property → pick a member; open the property settings dialog → edit a STATUS option color; add a second database + a RELATION property → link a row → the chip appears. Note the no-yjs constraint (assert tRPC-backed state). Drag/upload flows that are flaky in headless → assert the reliable proxy.
- [ ] **Step 2:** `pnpm exec playwright test apps/e2e/database-rich.spec.ts --retries 1` → pass. Commit `test(e2e): database rich — formula, person, relation, options`.

### Task G2: full gate + changelog

- [ ] **Step 1:** `pnpm check-types` (22/22), `pnpm lint`, `pnpm check-architecture`, `pnpm --filter @repo/domain test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web test`, `pnpm --filter engines test` → all pass.
- [ ] **Step 2:** `set -a; . ./.env; set +a; pnpm --filter web build` → succeeds.
- [ ] **Step 3:** Re-verify migration on a fresh scratch DB (zero drift).
- [ ] **Step 4:** Update `docs/changelog.md` (Базы данных: свойства, формулы, связи). Commit.

---

## Self-review notes

- Spec coverage: A1–A2 = enum/relation-table/settings; B1–B3 = formula engine (4.4); C1–C4 = relations/rollups/computed/validation (4.3 person/file/etc validation + 4.5 relations/rollups); D1 = tRPC; E1–E2 = cell editors (4.3 editors); F1–F2 = settings panel + creatable types (4.3 config); G = e2e + gate.
- Formula engine is pure + sandboxed by construction (no eval/Function); compute-on-read (C2) so no stale values + no recalc machinery. Cycle detection in C2's resolver.
- Computed columns (FORMULA/ROLLUP/metadata) are NOT filterable in 4B (C4 returns null from planner; F1 filter UI should hide them as targets) — documented limit.
- date-fns added to @repo/domain (B3 step 1) — verify check-architecture stays clean (it's adapter-tier-pure).
- Type consistency: `runFormula(expr, scope) → FormulaValue` (B3) used by C2; `resolveComputedCells(rows, properties, deps)` (C2) used by C3; `setRelationLinksInput`/`listLinkableRowsInput` (A2) used by D1/E2; `PropertySettings` extension (A2) used everywhere. RELATION post-filter reuses the multiSelectPostFilters mechanism (C4).
- Client-bundle: cell editors + settings dialog import dto TYPES only (F2 build verify catches violations).
