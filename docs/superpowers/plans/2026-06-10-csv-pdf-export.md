# Phase 6C — CSV Database Import/Export + PDF Bulk Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** CSV import with a preview/override UI, synchronous view-aware CSV export, and PDF_ZIP bulk export with HTML fallback — per `docs/superpowers/specs/2026-06-10-csv-pdf-export-design.md`. Closes cl6.

**Architecture:** CSV import = a new `ImportJobFormat.CSV` branch in the processor building one `CsvDatabaseBlueprint` for the 6B materializer, with `inferColumns` honoring user overrides from `ImportJob.options`. CSV export = a sync route applying the view's filters/sorts via `listRows` + the view's `visibleProperties` + an id→label cell stringifier. PDF_ZIP = a new `ExportJobFormat` branch rendering each page through the existing `renderPageBodyHtml`/`htmlToPdf` with per-page HTML fallback recorded in a new `ExportJob.result`; failures surface through the EXISTING journal viewer (export rows gain `warnings`).

**Tech Stack:** all existing (no new deps).

---

## Worker ground rules (every task)

- Worktree: `/Users/victor/.config/superpowers/worktrees/anynote/notion-phase-6c-csv-pdf`, branch `feat/notion-phase-6c-csv-pdf`. Commands from the worktree root.
- Prettier: semi false, single quotes, trailing commas, 100-char. **Never `git add -A`** (untracked `cl*.md` must never be committed). Conventional Commits, one commit per task with the given message.
- Real-DB tests: postgres is up; web + trpc test setups load the root `.env`.
- Read the committed files before editing — every integration point below cites the real file; the 6A/6B test harnesses (`process-import-job.test.ts` seed/cleanFixtures/makeFakeStorage, `job-router.test.ts` makeCaller/seed, the `api/` route-test mock pattern) are the templates.

### Verified facts you will rely on

- `ViewSettings` (packages/domain/src/database/dto/database.dto.ts:86-154): `visibleProperties?: string[]` is a VISIBLE list (absent/undefined = all visible); may contain the `'__title__'` sentinel (TITLE_SENTINEL export). Filters/sorts live in the same settings blob and are applied by `listRows` when `viewId` is passed.
- `resolveViewContext` with `viewId: undefined` → EMPTY settings (no default-view fallback server-side). The CSV route must pick the default view itself: `domain.database.listViews(actor, pageId)` → sort by `position` → first.
- `listRows` cells per property id: SELECT/STATUS = option-id string; MULTI_SELECT = string[] of ids; CHECKBOX = boolean; DATE = ISO string; NUMBER = number; RELATION = `RelationChip[] {rowId,pageId,title,icon}`; FORMULA/ROLLUP = computed value or `{__error: string}`; CREATED_*/LAST_EDITED_* = derived values. `stringifyCellValue` (bulk/database-table.ts) does NOT map option ids to labels.
- Property option labels live in `DatabaseProperty.settings.options: {id,label,color}[]`.
- `DatabaseToolbar` (apps/web/src/components/database/database-toolbar.tsx) receives `pageId` and the active `view: DatabaseViewEntry` (so `view.id`); right-side actions begin after `<Box sx={{ flex: 1 }} />` (line ~385). An export action is read-only — do NOT gate it on `canEditStructure`/`editable`.
- `htmlToPdf(html)` (apps/web/src/server/page-export/html-to-pdf.ts) → web `ReadableStream<Uint8Array>`, throws Gotenberg*Error; bytes via `new Uint8Array(await new Response(stream).arrayBuffer())`. `renderPageBodyHtml(page, {prisma, storage, baseUrl})` = tiptapJsonToHtml + base64 image embedding (exactly what single-page PDF uses).
- The export format union exists in THREE places that must change together: `bulk-export-dialog.tsx` (ExportFormat + FORMAT_OPTIONS), `job.ts` exportCreateInput, `process-export-job.ts` (isMd/ext branching). Import formats likewise: `import-format.ts`, `job.ts` importCreateInput, the processor dispatch + `singleFilePlan` (accepts only 'MARKDOWN'|'HTML').
- `materializeCsvDatabase` (6B, csv-to-database.ts) takes `CsvDatabaseBlueprint {sourceKey,title,header,rows,rowDocs?}` + callbacks; `parseCsv` enforces 50k/500/100k bounds; `inferColumns(header, rows)` has no overrides param yet (buildColumn dispatch at infer-columns.ts:44).
- `JobListItem` already carries `warnings: string[]` + `warningsCount` (exports currently hardcode `[]`/0); the Журнал button in import-export-section.tsx is gated `j.kind === 'import' && (...)`.

### Plan-level refinements vs the spec (intentional)

1. The CSV preview is an INLINE section of the wizard's form screen (file → preview table + per-column type Selects + database-title field → destination → submit), not a separate step — same information architecture, less step machinery.
2. PDF failures reuse the existing journal viewer: export rows populate `JobListItem.warnings` from `ExportJob.result.pdfFailures` and the Журнал button un-gates from `kind === 'import'`. No new tooltip surface.
3. The enum migration applies via psql WITHOUT `--single-transaction` (ALTER TYPE ADD VALUE + autocommit, the cl5 precedent); the new values are not used by any statement in the same migration.

---

## Task 1: Schema — format enum values + ExportJob.result

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260610200000_csv_pdf_formats/migration.sql`.

- [ ] **Step 1:** In the schema: `enum ImportJobFormat` gains `CSV`; `enum ExportJobFormat` gains `PDF_ZIP`; `model ExportJob` gains (after `error`):
```prisma
  result      Json?
```
`pnpm --filter @repo/db exec prisma validate` → pass.

- [ ] **Step 2:** Generate via diff (Prisma 7.7 flags `--from-schema`/`--to-schema`; strip stray log lines):
```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-before-6c.prisma
mkdir -p packages/db/prisma/migrations/20260610200000_csv_pdf_formats
pnpm --filter @repo/db exec prisma migrate diff --from-schema /tmp/schema-before-6c.prisma --to-schema prisma/schema.prisma --script > packages/db/prisma/migrations/20260610200000_csv_pdf_formats/migration.sql
```
Inspect: exactly two `ALTER TYPE ... ADD VALUE` + one `ALTER TABLE "export_jobs" ADD COLUMN "result" JSONB` — nothing else, or STOP (BLOCKED).

- [ ] **Step 3:** Apply WITHOUT --single-transaction (enum ADD VALUE; psql in the `anynote-postgres-1` container, creds from `.env`):
```bash
docker exec -i anynote-postgres-1 psql -U <user> -d <db> -v ON_ERROR_STOP=1 < packages/db/prisma/migrations/20260610200000_csv_pdf_formats/migration.sql
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260610200000_csv_pdf_formats
pnpm --filter @repo/db prisma:generate
```
Verify: `\d export_jobs` shows `result`; `SELECT unnest(enum_range(NULL::"ImportJobFormat"))` includes CSV; same for ExportJobFormat/PDF_ZIP; ledger row finished=t. (Ignore the pre-existing foreign ledger drift — `migrate status` exits 1 for unrelated reasons.)

- [ ] **Step 4 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260610200000_csv_pdf_formats
git commit -m "feat(db): CSV import format, PDF_ZIP export format, ExportJob.result"
```

---

## Task 2: Pure modules — csv-stringify, inferColumns overrides, format detection (TDD)

**Files:** Create `apps/web/src/server/page-export/csv-stringify.ts`; Modify `apps/web/src/server/page-import/infer-columns.ts`, `apps/web/src/components/import-export/import-format.ts`; Tests: `apps/web/test/server/csv-stringify.test.ts`, extend `apps/web/test/server/infer-columns.test.ts`, extend `apps/web/test/import-export-helpers.test.ts`.

- [ ] **Step 1 — failing tests.** `csv-stringify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildCsv, csvCellValue } from '@/server/page-export/csv-stringify'

const SELECT_PROP = {
  id: 'p1',
  name: 'Статус',
  type: 'SELECT',
  settings: { options: [{ id: 'opt-1', label: 'Открыто', color: null }] },
}
const CHECK_PROP = { id: 'p2', name: 'Готово', type: 'CHECKBOX', settings: null }

describe('csvCellValue', () => {
  it('maps select option ids to labels and multi-select arrays to label lists', () => {
    expect(csvCellValue(SELECT_PROP, 'opt-1')).toBe('Открыто')
    expect(
      csvCellValue({ ...SELECT_PROP, type: 'MULTI_SELECT' }, ['opt-1', 'opt-1'])
    ).toBe('Открыто, Открыто')
  })
  it('renders checkboxes as Да/Нет and computed errors as empty', () => {
    expect(csvCellValue(CHECK_PROP, true)).toBe('Да')
    expect(csvCellValue(CHECK_PROP, false)).toBe('Нет')
    expect(csvCellValue(CHECK_PROP, { __error: 'x' })).toBe('')
  })
  it('renders relation chips by title and unknown ids as-is', () => {
    expect(
      csvCellValue(
        { id: 'p3', name: 'Связь', type: 'RELATION', settings: null },
        [{ rowId: 'r', pageId: 'p', title: 'Цель', icon: null }],
      ),
    ).toBe('Цель')
    expect(csvCellValue(SELECT_PROP, 'no-such-option')).toBe('no-such-option')
  })
})

describe('buildCsv', () => {
  it('escapes per RFC-4180, prefixes BOM, and emits the title column first', () => {
    const csv = buildCsv(
      [SELECT_PROP],
      [
        { title: 'A,B', cells: { p1: 'opt-1' } },
        { title: 'C"D', cells: {} },
      ],
    )
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Название,Статус')
    expect(lines[1]).toBe('"A,B",Открыто')
    expect(lines[2]).toBe('"C""D",')
  })
})
```

`infer-columns.test.ts` additions:

```ts
describe('inferColumns overrides', () => {
  it('pins a column type and skips skipped columns', () => {
    const cols = inferColumns(
      ['Имя', 'Код', 'Мусор'],
      [
        ['А', '1', 'x'],
        ['Б', '2', 'y'],
      ],
      { overrides: { 1: 'TEXT', 2: 'skip' } },
    )
    expect(cols[1]!.type).toBe('TEXT') // would infer NUMBER without the pin
    expect(cols[1]!.toValue('3')).toBe('3')
    expect(cols[2]!.skip).toBe(true)
  })
})
```

`import-export-helpers.test.ts` addition: `detectImportFormat('a.csv')` → `'CSV'` (and uploadMimeFor('CSV') → 'text/plain').

Run all three → FAIL.

- [ ] **Step 2 — implement.** `csv-stringify.ts` (pure; no imports from page-import):

```ts
export type CsvProperty = {
  id: string
  name: string
  type: string
  settings: unknown
}

export type CsvRow = { title: string | null; cells: Record<string, unknown> }

function optionLabels(settings: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (settings && typeof settings === 'object') {
    const options = (settings as { options?: unknown }).options
    if (Array.isArray(options)) {
      for (const o of options) {
        if (o && typeof o === 'object') {
          const { id, label } = o as { id?: unknown; label?: unknown }
          if (typeof id === 'string' && typeof label === 'string') out.set(id, label)
        }
      }
    }
  }
  return out
}

/** Stringify one listRows cell value for CSV (labels, Да/Нет, chips by title). */
export function csvCellValue(prop: CsvProperty, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (typeof o.__error === 'string') return ''
    if (typeof o.title === 'string') return o.title
    if (typeof o.label === 'string') return o.label
    if (typeof o.name === 'string') return o.name
    return JSON.stringify(value)
  }
  if (prop.type === 'CHECKBOX') return value === true ? 'Да' : 'Нет'
  if (prop.type === 'SELECT' || prop.type === 'STATUS') {
    const labels = optionLabels(prop.settings)
    return typeof value === 'string' ? (labels.get(value) ?? value) : String(value)
  }
  if (Array.isArray(value)) {
    const labels = optionLabels(prop.settings)
    return value
      .map((v) =>
        typeof v === 'string'
          ? (labels.get(v) ?? v)
          : csvCellValue({ ...prop, type: 'TEXT' }, v),
      )
      .filter(Boolean)
      .join(', ')
  }
  return String(value)
}

function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** RFC-4180 CSV with BOM (Excel) and CRLF line endings; title column first. */
export function buildCsv(props: CsvProperty[], rows: CsvRow[]): string {
  const header = ['Название', ...props.map((p) => p.name)].map(escapeField).join(',')
  const lines = rows.map((r) =>
    [r.title ?? '', ...props.map((p) => csvCellValue(p, r.cells[p.id]))]
      .map(escapeField)
      .join(','),
  )
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n'
}
```
(NOTE the test asserts `lines[2] === '"C""D",'` — the trailing `\r\n` means the split has a final empty element; assert accordingly or trim — keep the TEST's semantics: adjust the test's split handling if needed BUT keep BOM/CRLF/escaping assertions intact.)

`infer-columns.ts`: add to `InferredColumn` an optional `skip?: boolean`; extend the signature:
```ts
export type InferOverrides = { overrides?: Record<number, InferredType | 'skip'> }

export function inferColumns(
  header: string[],
  rows: string[][],
  opts: InferOverrides = {},
): InferredColumn[] {
  return header.map((name, idx) => {
    const ov = opts.overrides?.[idx]
    const cleanName = name.trim() || `Колонка ${idx + 1}`
    if (ov === 'skip') return { ...textColumn(cleanName), skip: true }
    const values = rows.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '')
    if (ov) return pinnedColumn(cleanName, ov, values)
    return buildColumn(cleanName, values)
  })
}
```
`pinnedColumn(name, type, values)`: for SELECT/MULTI_SELECT build options from the values exactly as `buildColumn`'s select block does (extract that option-building into a small shared helper) but with the type FORCED; for every other type return the same shape `buildColumn` would (reuse its per-type `toValue` constructors — refactor the per-type returns into named builders so pinning reuses them; behavior of the non-override path must stay identical — the existing tests are the net).
`csv-to-database.ts`: skip columns with `col.skip` when creating properties/cells (verify it maps by index — adjust the cols loop to filter skipped while PRESERVING the column-index alignment with row values).

`import-format.ts`: `ImportFormat` += `'CSV'`; `detectImportFormat` maps ext `csv`; `uploadMimeFor` unchanged (CSV falls into the non-ZIP branch → text/plain).

- [ ] **Step 3:** run the three test files + the FULL `test/server/` (no regressions in 6B inference/materializer suites) → green. **Step 4 — commit:**
```bash
git add apps/web/src/server/page-export/csv-stringify.ts apps/web/src/server/page-import/infer-columns.ts apps/web/src/server/page-import/csv-to-database.ts apps/web/src/components/import-export/import-format.ts apps/web/test/server/csv-stringify.test.ts apps/web/test/server/infer-columns.test.ts apps/web/test/import-export-helpers.test.ts
git commit -m "feat(web): csv stringifier with label mapping, inference overrides, csv format"
```

---

## Task 3: CSV export route + toolbar action

**Files:** Create `apps/web/src/app/api/pages/[pageId]/export/csv/route.ts`; Modify `apps/web/src/components/database/database-toolbar.tsx`; Test `apps/web/test/api/pages-export-csv-route.test.ts` (real DB, mocked session).

- [ ] **Step 1 — route.** Model on the single-page export route (read it) with these differences: page `type: 'DATABASE'`, visibility predicate included, view resolution, uniform 404:

```ts
import type { NextRequest } from 'next/server'
import { prisma } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'
import { z } from 'zod'

import { domain } from '@/lib/domain'
import { getSession } from '@/lib/get-session'
import { contentDisposition } from '@/server/page-export'
import { buildCsv, type CsvProperty, type CsvRow } from '@/server/page-export/csv-stringify'

export const runtime = 'nodejs'

const NOT_FOUND = new Response(null, { status: 404 })

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ pageId: string }> },
) {
  const { pageId } = await ctx.params
  if (!z.string().uuid().safeParse(pageId).success) return NOT_FOUND
  const viewIdRaw = new URL(req.url).searchParams.get('viewId')
  const viewId = viewIdRaw && z.string().uuid().safeParse(viewIdRaw).success ? viewIdRaw : undefined

  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  // DATABASE page, in a workspace the caller can see the page in (visibility
  // predicate — NOT just membership), not trashed/archived. Uniform 404.
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      type: 'DATABASE',
      deletedAt: null,
      archivedAt: null,
      workspace: { members: { some: { userId: session.user.id } } },
      AND: [buildPageVisibilityWhere(session.user.id)],
    },
    select: { id: true, title: true },
  })
  if (!page) return NOT_FOUND

  // Resolve the effective view: the requested one, else the default (first by
  // position) — resolveViewContext treats undefined as "no settings", so the
  // route supplies the default itself to honor the view's filters/visibility.
  let effectiveViewId = viewId
  let visible: string[] | undefined
  try {
    const views = await domain.database.listViews(session.user.id, pageId)
    const sorted = [...views].sort((a, b) => a.position - b.position)
    const view = (viewId ? sorted.find((v) => v.id === viewId) : undefined) ?? sorted[0]
    effectiveViewId = view?.id
    const settings = view?.settings
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const vp = (settings as { visibleProperties?: unknown }).visibleProperties
      if (Array.isArray(vp)) visible = vp.filter((v): v is string => typeof v === 'string')
    }
  } catch {
    return NOT_FOUND
  }

  try {
    const all = (await domain.database.listProperties(
      session.user.id,
      pageId,
    )) as unknown as CsvProperty[]
    const props = visible ? all.filter((p) => visible.includes(p.id)) : all

    const rows: CsvRow[] = []
    let cursor: string | undefined
    do {
      const batch = await domain.database.listRows(session.user.id, {
        pageId,
        ...(effectiveViewId ? { viewId: effectiveViewId } : {}),
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      rows.push(...batch.rows)
      cursor = batch.nextCursor ?? undefined
    } while (cursor)

    const csv = buildCsv(props, rows)
    const filename = `${(page.title ?? '').trim() || 'database'}.csv`
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': contentDisposition(filename),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NOT_FOUND
  }
}
```
Notes: `contentDisposition` comes from the page-export barrel (it builds the UTF-8 filename header; if its signature expects a pre-built filename string, pass `<title>.csv` — read filename.ts; do NOT use buildFilename which forces pdf/html/md extensions). `listViews` return shape: verify its row shape (id/position/settings) in the domain service and adapt the route's field access.

- [ ] **Step 2 — toolbar action.** In `database-toolbar.tsx`: after the right-side actions begin (after the `<Box sx={{ flex: 1 }} />`), add a small text/icon Button «Экспорт CSV» (`data-testid="export-csv"`, NOT gated by editable/canEditStructure — it's read-only), opening `/api/pages/${pageId}/export/csv?viewId=${view.id}` via `window.open(url, '_blank')` or an anchor — match how the page-export dialog triggers downloads if a pattern exists; a plain `component="a" href` Button is fine.

- [ ] **Step 3 — route test** (`apps/web/test/api/pages-export-csv-route.test.ts`): mock `@/lib/get-session` via the vi.hoisted pattern (copy from `jobs-export-artifact-route.test.ts`), real prisma + real domain. Seed (mirror the database fixtures from `packages/trpc/test/database-rows.test.ts`, adapted to apps/web — EMAIL_SUFFIX `+csv-export-route-test@anynote.dev`; cleanFixtures must also delete database* models before pages): owner + workspace + TEAM collection + DATABASE page via prisma + `domain.database.seedDefaults(pageId, wsId, title)`; a NUMBER property via `domain.database.createProperty`; two rows via `domain.database.createRow` + `updateCellValue` (one STATUS option set by id, one number). Then a second view created via `domain.database.createView`-equivalent (find the create-view service method; if only the tRPC router exposes it, create the view row via prisma with `settings: { visibleProperties: ['__title__', <statusPropId>], filters: {...} }`). Tests (4):
  1. Default view: CSV contains the header «Название,Статус,<Number-prop>», option LABEL «Готово» (not `status-done`), BOM prefix, `text/csv` + nosniff headers.
  2. View with `visibleProperties` excluding the NUMBER property → its column absent.
  3. View with a filter (e.g. STATUS equals one option) → only matching rows in the CSV.
  4. Access: a non-member session → 404; a member but the page in another user's PERSONAL collection → 404 (visibility predicate).
  (Row-access-rule filtering is already covered by the 4C suites through listRows — no duplicate fixture needed; assert in a comment.)

- [ ] **Step 4:** run the route test (4 passed) + `pnpm --filter web lint && pnpm --filter web check-types`. **Step 5 — commit:**
```bash
git add "apps/web/src/app/api/pages/[pageId]/export/csv/route.ts" apps/web/src/components/database/database-toolbar.tsx apps/web/test/api/pages-export-csv-route.test.ts
git commit -m "feat(web): view-aware csv export route + database toolbar action"
```

---

## Task 4: CSV import — router + processor + integration test

**Files:** Modify `packages/trpc/src/routers/job.ts`, `apps/web/src/server/jobs/process-import-job.ts`; Tests: extend `packages/trpc/test/job-router.test.ts`, create `apps/web/test/server/process-csv-import.test.ts`.

- [ ] **Step 1 — router.** `importCreateInput`: `format` enum += `'CSV'`; add
```ts
  columnOverrides: z.record(z.string(), z.enum(['TEXT','NUMBER','CHECKBOX','DATE','SELECT','MULTI_SELECT','URL','EMAIL','PHONE','skip'])).optional(),
  databaseTitle: z.string().trim().min(1).max(200).optional(),
```
In `import.create`: ext check gains `(input.format === 'CSV' && file.ext === 'csv')`; CSV is GENERIC-source-only — if `input.source !== 'GENERIC' && input.format === 'CSV'` → BAD_REQUEST «CSV импортируется только как файл»; persist into options: `options: { location, parentId, ...(input.columnOverrides ? { columnOverrides: input.columnOverrides } : {}), ...(input.databaseTitle ? { databaseTitle: input.databaseTitle } : {}) }`.
Router tests (+2): CSV format with a .csv file creates the job with options carrying overrides; CSV + source NOTION → BAD_REQUEST.

- [ ] **Step 2 — processor.** In `process-import-job.ts`:
  - `parseOptions` also extracts `columnOverrides` (validate shape defensively: object of string→string, keys parseInt-able) and `databaseTitle` (string).
  - Dispatch: in the GENERIC branch, `job.format === 'CSV'` → a NEW path: parse the source bytes with `parseCsv` (import from page-import/csv); empty/headerless CSV → `ImportSourceError('CSV-файл пуст')`. Build the blueprint:
```ts
const header = rows[0]!
const dataRows = rows.slice(1)
const blueprint: CsvDatabaseBlueprint = {
  sourceKey: source.name,
  title: options.databaseTitle ?? source.name.replace(/\.[^.]+$/, ''),
  header,
  rows: dataRows,
}
```
  Set `plan` to an EMPTY ImportPlan (`{roots: [], assets: new Map(), warnings: [], totalPages: 1 + dataRows.length}`) and route the blueprint through the existing `materializeDatabases` call (generalize its `databases` param type from `NotionDatabaseBlueprint[]` to `CsvDatabaseBlueprint[]` + an optional `parentKey` — for the CSV path parentKey is `''` so it lands at `options.parentId`; the Notion type already extends the Csv type structurally, keep one signature).
  - Thread the overrides: `materializeCsvDatabase` gets `inferOpts?: InferOverrides` in its args (numeric-keyed record from options) and passes it to its `inferColumns` call; journal one line per override («Колонка N: тип задан вручную»).
  - The materializer's `existingMappings` resume semantics already cover idempotency (db page key = source.name; row keys `#idx`).

- [ ] **Step 3 — integration test** (`process-csv-import.test.ts`, mirror the 6B harness; EMAIL_SUFFIX `+csv-import-test@anynote.dev`; cleanFixtures incl. database models): seed an ImportJob `format: 'CSV', source: 'GENERIC'` whose SOURCE file bytes are
```
Name,Код,Статус,Мусор
А,1,Open,x
Б,2,Done,y
```
with `options: { location: 'team', parentId: null, columnOverrides: { '1': 'TEXT', '3': 'skip' }, databaseTitle: 'Реестр' }`. Tests (3):
  1. DATABASE page «Реестр» created; properties = TEXT «Код» (override pinned — would infer NUMBER) + SELECT «Статус» (labels Open/Done); NO «Мусор» property; 2 rows titled А/Б with `cells` carrying '1'/'2' as STRINGS and option ids resolving to the right labels; result/journal mentions the manual override; REPORT artifact written.
  2. Idempotent re-run → still 2 rows, 2 properties.
  3. Empty CSV (only header or zero bytes) → FAILED with «CSV-файл пуст».

- [ ] **Step 4:** run the new test (3) + the FULL `test/server/` + `job-router.test.ts` (18) + lint + check-types (web + trpc). **Step 5 — commit:**
```bash
git add packages/trpc/src/routers/job.ts packages/trpc/test/job-router.test.ts apps/web/src/server/jobs/process-import-job.ts apps/web/src/server/page-import/csv-to-database.ts apps/web/test/server/process-csv-import.test.ts
git commit -m "feat(web): csv import path — overrides, database title, empty-file guard"
```
(stage csv-to-database.ts only if the InferOverrides threading touched it — it will)

---

## Task 5: PDF_ZIP — router validation + processor branch

**Files:** Modify `packages/trpc/src/routers/job.ts`, `apps/web/src/server/jobs/process-export-job.ts`, `apps/web/src/server/jobs/kick.ts`; Tests: extend `packages/trpc/test/job-router.test.ts`, extend `apps/web/test/server/process-export-job.test.ts`.

- [ ] **Step 1 — router.** `exportCreateInput.format` enum += `'PDF_ZIP'`. In `export.create`, directly after the scope/scopeId basic check:
```ts
      if (input.format === 'PDF_ZIP' && input.scope === 'WORKSPACE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'PDF недоступен для всего пространства — используйте Markdown или HTML',
        })
      }
```
Router test (+1): WORKSPACE + PDF_ZIP → BAD_REQUEST; SUBTREE + PDF_ZIP creates QUEUED.

- [ ] **Step 2 — processor.** In `process-export-job.ts`:
  - `ExportJobContext` gains an injectable renderer: `pdf?: (html: string) => Promise<ReadableStream<Uint8Array>>` (tests inject a fake; production defaults to the real one). Resolve once: `const renderPdf = ctx.pdf ?? htmlToPdf` (import `htmlToPdf` from `@/server/page-export/html-to-pdf`).
  - Constants: `export const PDF_PAGE_LIMIT = 50`.
  - In `run`: `const isPdf = job.format === 'PDF_ZIP'`; `const ext = isPdf ? 'pdf' : isMd ? 'md' : 'html'` (the Notion-style layout walk is format-agnostic). After collect: `if (isPdf && pages.length > PDF_PAGE_LIMIT) throw new ExportSourceError(\`Слишком много страниц для PDF (\${pages.length} > \${PDF_PAGE_LIMIT}) — используйте Markdown или HTML\`)`.
  - PDF rendering branch (inside the entries loop): for PDF the page body uses the SINGLE-PAGE pipeline (base64 images so Gotenberg sees them; archive-relative links are meaningless inside PDFs):
```ts
    if (isPdf) {
      const body =
        rec.type === PageType.TEXT
          ? await renderPageBodyHtml(
              { content: rec.content },
              { prisma: ctx.prisma, storage: ctx.storage, baseUrl: ctx.baseUrl },
            )
          : rec.type === PageType.DATABASE
            ? await renderDatabaseBodyHtml(ctx, job.userId, rec) // extract: the existing renderDatabasePage's table-HTML path returning BODY html (not wrapped)
            : `<p>Тип страницы «${rec.type}» не входит в экспорт этой версии.</p>`
      const fullHtml = wrapHtmlDocument({ bodyHtml: body, title, icon: rec.icon })
      try {
        const stream = await renderPdf(fullHtml)
        entries[filePath] = new Uint8Array(await new Response(stream).arrayBuffer())
      } catch (err) {
        console.warn('[export-job] pdf render failed, falling back to html', { pageId: rec.id, err })
        pdfFailures.push(title)
        entries[filePath.replace(/\.pdf$/, '.html')] = strToU8(fullHtml)
      }
      // progress bump as in the existing loop, then continue to the next page
    }
```
    Restructure the loop so the three formats share the progress bump; extract `renderDatabaseBodyHtml` from `renderDatabasePage` so MD/HTML behavior is unchanged (the existing renderDatabasePage keeps its try/catch + stub semantics and calls the new helper; `renderPageBodyHtml` import comes from the barrel `@/server/page-export`). NOTE: `renderPageBodyHtml` takes `{ content }` — check its exact param type (it's `page: { content: unknown }`).
  - Skip the asset pre-scan/bundling entirely for PDF (`if (!isPdf) { ...pre-scan... }` and the assets loop) — images are embedded base64 by renderPageBodyHtml.
  - After the loop: `await ctx.prisma.exportJob.update({ where: { id: jobId }, data: { result: { pdfFailures } as Prisma.InputJsonValue } })` (always for PDF jobs, `pdfFailures: []` when clean; do NOT write result for non-PDF formats).
  - `kick.ts`: no change needed (ctx.pdf stays undefined in production → real htmlToPdf). Verify the ExportJobContext construction there still typechecks.

- [ ] **Step 3 — tests** (extend `process-export-job.test.ts`; remember the single-active-job invariant — mark the seed job DONE before creating new ones, as the existing tests do). Fake renderer:
```ts
const fakePdf = (opts: { failTitles?: string[] } = {}) => {
  const calls: string[] = []
  return {
    calls,
    render: async (html: string): Promise<ReadableStream<Uint8Array>> => {
      calls.push(html)
      const failed = (opts.failTitles ?? []).some((t) => html.includes(t))
      if (failed) throw new Error('gotenberg down')
      return new Response(Buffer.from('%PDF-fake')).body!
    },
  }
}
```
Tests (+3):
  1. SUBTREE PDF_ZIP (the seeded Родитель/Ребёнок tree): both entries are `.pdf` with `%PDF-fake` bytes; no `assets/` entries; `result.pdfFailures` is `[]`; job DONE.
  2. Same with `failTitles: ['Ребёнок']`: the child lands as `Родитель/Ребёнок.html` containing the wrapped HTML, the parent as `.pdf`; `result.pdfFailures` equals `['Ребёнок']`; job still DONE.
  3. A 51-page subtree (seed a loop of 51 children) → FAILED with the cap message. (Build pages in a fast prisma `createMany`-style loop; titles `P1..P51`.)

- [ ] **Step 4:** run `process-export-job.test.ts` (8 total) + full `test/server/` + `job-router.test.ts` + lint + check-types. **Step 5 — commit:**
```bash
git add packages/trpc/src/routers/job.ts packages/trpc/test/job-router.test.ts apps/web/src/server/jobs/process-export-job.ts apps/web/src/server/jobs/kick.ts apps/web/test/server/process-export-job.test.ts
git commit -m "feat(web): pdf bulk export — 50-page cap, per-page html fallback, result notes"
```

---

## Task 6: UI — export dialog PDF, journal for exports, wizard CSV preview

**Files:** Modify `apps/web/src/components/import-export/bulk-export-dialog.tsx`, `packages/trpc/src/routers/job.ts` (list mapping only), `apps/web/src/components/workspace/settings/import-export-section.tsx`, `apps/web/src/components/import-export/import-wizard-dialog.tsx`, `apps/web/src/components/import-export/import-sources.ts`, `apps/web/src/components/import-export/job-presentation.ts`; extend `apps/web/test/import-export-helpers.test.ts`.

- [ ] **Step 1 — export dialog.** `ExportFormat` += `'PDF_ZIP'`; `FORMAT_OPTIONS` += `{ value: 'PDF_ZIP', label: 'PDF' }`. The PDF button: `disabled={effectiveScope === 'WORKSPACE'}` wrapped in a Tooltip «PDF недоступен для всего пространства» (span-wrap the disabled button for MUI tooltip); when scope switches to WORKSPACE while format is PDF_ZIP, reset format to MARKDOWN_ZIP (small `useEffect` or inline in the scope onClick). Also surface the cap in the dialog: a caption under the format row when PDF selected: «До 50 страниц; страницы с ошибкой рендеринга будут вложены как HTML.»

- [ ] **Step 2 — journal for exports.** In `job.ts` list mapping for EXPORTS: replace the hardcoded `warnings: []` / `warningsCount: 0` with values derived from `j.result` pdfFailures:
```ts
function exportWarnings(result: Prisma.JsonValue | null): string[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const raw = (result as Prisma.JsonObject).pdfFailures
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => `Не удалось отрендерить PDF: «${t}» — вложен HTML`)
}
```
(`warnings: exportWarnings(j.result).slice(0, WARNINGS_CAP)`, `warningsCount: exportWarnings(j.result).length` — compute once.) In `import-export-section.tsx`: un-gate the Журнал button from `j.kind === 'import'` → show for any row with `j.warningsCount > 0 || j.hasReport` (the log dialog's download link is already gated on hasReport, so export rows just show the warning list). FORMAT_LABEL in `job-presentation.ts` += `PDF_ZIP: 'PDF'`.

- [ ] **Step 3 — wizard CSV preview.** `import-sources.ts`: GENERIC card `accept` += `.csv`, description mentions CSV («Markdown/HTML/CSV-файлы или ZIP-архив…»). In `import-wizard-dialog.tsx` (read the committed file):
  - New state: `const [preview, setPreview] = useState<{ header: string[]; rows: string[][] } | null>(null)`, `const [overrides, setOverrides] = useState<Record<number, string>>({})`, `const [dbTitle, setDbTitle] = useState('')`.
  - On file pick with `detectImportFormat(name) === 'CSV'`: read the file text (`file.text()`), parse CLIENT-SIDE with `parseCsv` from `@/server/page-import/csv` (pure, dependency-free — verify it imports nothing server-only; its ImportSourceError import from zip-plan pulls fflate — that's bundleable and fine, but if the import chain drags anything server-only, split ImportSourceError into its own tiny module and update imports) limited to the first 201 lines (slice the text by newlines BEFORE parsing to keep it cheap — note in a comment this is preview-only; the server parses authoritatively). Store `{header, rows: first 10 data rows}` + init `dbTitle` to the file stem. On non-CSV picks reset preview state.
  - Preview UI (rendered between the file button and «Куда импортировать» when `format === 'CSV' && preview`): a db-title TextField («Название базы», data-testid="csv-db-title"); a compact table: header row = column names, second row = a Select per column (size small, data-testid={`csv-col-type-${idx}`}) with the inferred type preselected (run `inferColumns(preview.header, previewRows)` client-side for defaults; column 0 renders a static «Название» chip — not overridable), options: текст/число/чекбокс/дата/выбор/мультивыбор/URL/email/телефон/пропустить mapping to the InferredType union + 'skip'; then up to 10 sample rows (Typography, truncated). Selecting sets `overrides[idx]`.
  - Submit: when format CSV include `columnOverrides: Object.fromEntries(Object.entries(overrides))` (keys as strings) and `databaseTitle: dbTitle.trim() || undefined` in the mutate payload. Reset preview/overrides/dbTitle in handleBack/handleClose.
  - `requiresZip` logic untouched (CSV only on GENERIC).
  - Helpers test additions: FORMAT_LABEL PDF_ZIP; GENERIC card accepts .csv.

- [ ] **Step 4:** `pnpm --filter web exec vitest run test/import-export-helpers.test.ts` + lint + check-types + **`pnpm --filter web build`** (client-bundle gate — the wizard now imports parseCsv/inferColumns; if the build drags server-only modules, apply the ImportSourceError split noted above). **Step 5 — commit:**
```bash
git add apps/web/src/components/import-export packages/trpc/src/routers/job.ts apps/web/src/components/workspace/settings/import-export-section.tsx apps/web/test/import-export-helpers.test.ts
git commit -m "feat(web): pdf export option, export journal, csv preview with type overrides"
```
(plus apps/web/src/server/page-import/* if the error-split refactor was needed)

---

## Task 7: E2E — CSV import with override + PDF subtree export

**Files:** Modify `apps/e2e/import-export.spec.ts`; Create `apps/e2e/fixtures/import-table.csv`.

- [ ] **Step 1 — fixture** (plain text file, commit as-is):
```csv
Name,Код,Статус
Альфа,1,Open
Бета,2,Done
Гамма,3,Open
```

- [ ] **Step 2 — CSV import test** (new test in the existing describe; reuse the helpers):
```ts
  test('imports a csv with a type override into a typed database', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'csv-import')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    await page.getByTestId('import-source-generic').click()
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'import-table.csv'))
    // Preview appears with per-column type selects; pin «Код» (index 1) to text.
    await expect(page.getByTestId('csv-db-title')).toBeVisible()
    await page.getByTestId('csv-col-type-1').click()
    await page.getByRole('option', { name: 'Текст' }).click()
    await page.getByTestId('import-submit').click()
    await expect(page.getByTestId('import-wizard').getByText(/Импорт запущен/)).toBeVisible({
      timeout: 20_000,
    })
    await page.getByTestId('import-wizard').getByRole('button', { name: 'Закрыть' }).click()
    await expect(
      page.getByTestId('job-row').filter({ hasText: 'import-table.csv' }).getByText('Готово'),
    ).toBeVisible({ timeout: 60_000 })

    await page.reload()
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await page.locator('aside').getByText('import-table', { exact: false }).click()
    // The database renders with the Status select labels and 3 rows.
    await expect(page.getByText('Альфа')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Open').first()).toBeVisible()
  })
```
(Adapt the type-select labels/locators to the actual Select implementation; the assertions' semantics — override applied, database visible with rows + option labels — are fixed.)

- [ ] **Step 3 — PDF export test** (REAL Gotenberg from compose; GOTENBERG_URL comes from the root .env which the webServer env inherits — verify by running):
```ts
  test('exports a subtree as a pdf archive', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'pdf-export')
    await openImportExportSettings(page)
    await page.getByTestId('open-export').click()
    // Scope: subtree of the seeded welcome page; format PDF.
    await page.getByRole('button', { name: 'Поддерево' }).click()
    await page.getByTestId('bulk-export-dialog').getByText(/.+/).first() // picker renders
    // pick the first page in the tree picker
    await page
      .getByTestId('bulk-export-dialog')
      .locator('[role="button"], li, div')
      .filter({ hasText: /Добро|Начало|Welcome|стартов/i })
      .first()
      .click()
    await page.getByRole('button', { name: 'PDF', exact: true }).click()
    await page.getByTestId('export-submit').click()
    await expect(page.getByText('Экспорт запущен')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('bulk-export-dialog').getByRole('button', { name: 'Закрыть' }).click()
    await expect(
      page.getByTestId('job-row').filter({ hasText: 'PDF' }).getByText('Готово'),
    ).toBeVisible({ timeout: 90_000 })
    const href = await page.getByTestId('job-download').getAttribute('href')
    expect(href ?? '').toContain('/api/jobs/export/')
  })
```
(The subtree-picker locator WILL need adaptation — read the PageTreePicker DOM or reuse how the existing export test handles pickers; the semantics — PDF job reaches Готово with a download — are fixed. If Gotenberg isn't reachable from the Playwright dev server, report it: do NOT mock in E2E.)

- [ ] **Step 4 — run** `pnpm exec playwright test apps/e2e/import-export.spec.ts --retries=2` (root .env sourced) → 5 passed (3 existing + 2 new). **Step 5 — commit:**
```bash
git add apps/e2e/import-export.spec.ts apps/e2e/fixtures/import-table.csv
git commit -m "test(e2e): csv import with override, pdf subtree export"
```

---

## Task 8: Changelog + full gates

- [ ] **Step 1:** `docs/changelog.md` — append to the «Импорт и экспорт» block:
```md
- Импорт CSV-файла как базы данных: предпросмотр колонок с ручным выбором типов; экспорт любой базы в CSV с учётом фильтров, сортировок и видимости свойств текущего представления.
- Экспорт в PDF: страница с подстраницами или раздел (до 50 страниц) — архив PDF-файлов; страницы с ошибкой рендеринга вкладываются как HTML с пометкой в журнале.
```
- [ ] **Step 2:** `set -a; source .env; set +a && pnpm gates` → all green (known trip-points as before; fix minimally and report anything smelling like a product bug).
- [ ] **Step 3:**
```bash
git add docs/changelog.md
git commit -m "docs(changelog): csv database import/export + pdf bulk export"
```

---

## Completion

After all tasks: final whole-branch review focused on (1) the CSV export access chain (visibility predicate + view resolution + listRows authority — and that `visibleProperties` filtering can't EXPAND access, only narrow columns), (2) PDF fallback consistency (no silent incompleteness — every failure either in pdfFailures or job FAILED), (3) the client-side csv/infer imports not dragging server-only code into the bundle, (4) GENERIC/6B import + MD/HTML export regression. Then the merge checkpoint — closing cl6.

## Self-review (at plan-writing time)

- Spec coverage: §2→Task 1; §3 (preview/overrides/processor)→Tasks 2/4/6; §4 (route/labels/visibility/toolbar)→Tasks 2/3; §5 (cap/fallback/result/UI)→Tasks 5/6; §7 tests→Tasks 3/4/5 + E2E Task 7.
- Type consistency: `CsvProperty/CsvRow` (Task 2) consumed by the route (Task 3); `InferOverrides` (Task 2) threaded through processor+materializer (Task 4) and the wizard (Task 6); `PDF_PAGE_LIMIT`/`ctx.pdf` (Task 5) used by its tests; `exportWarnings` (Task 6) reads the `result.pdfFailures` Task 5 writes.
- Deviations from spec flagged in the header (inline preview, journal reuse, autocommit enum migration).
