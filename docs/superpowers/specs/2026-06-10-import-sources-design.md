# Notion-parity Phase 6B — Import sources: Notion ZIP, Confluence, Yandex Wiki, import log

**Date:** 2026-06-10
**Branch:** `feat/notion-phase-6b-import-sources`
**Status:** approved design (cl6 prompt 6.3)
**Builds on:** Phase 6A (`docs/superpowers/specs/2026-06-10-import-export-center-design.md`) —
ImportJob infra, zip plan builder, MD/HTML→Tiptap converters, ImportMapping idempotency,
the import wizard, and the reserved `ImportArtifactKind.REPORT`.

## 1. Goals and non-goals

**Goals**

1. **NotionExportZipParser** — import Notion's Markdown&CSV and HTML export ZIPs:
   page tree with cleaned titles, assets, inter-page links rewritten, database
   CSVs mapped to **real DATABASE pages**, unsupported constructs surfaced as
   warnings (never failures).
2. **Confluence ZIP importer** — space-export HTML tree → pages + attachments;
   permissions/history explicitly not imported (journal note).
3. **Yandex Wiki path** — the generic markdown/ZIP importer behind a dedicated,
   clearly labeled («расширение AnyNote») wizard card with documented limitations.
4. **Honest-unavailable states** for Asana and Monday (no OAuth/API in MVP):
   disabled wizard cards with export-workaround hints (their CSV exports → 6C).
5. **Import journal (ImportLogViewer)** — a human-readable downloadable log per
   import job (the 6A `REPORT` artifact) + a dialog in the Center.

**Non-goals (deferred or out)**

- Asana/Monday API/OAuth integrations — explicitly out (roadmap honesty mandate).
- Standalone CSV file import and database CSV **export** — 6C (which reuses this
  phase's `csv-to-database` mapper).
- PDF bulk export — 6C.
- Importing Notion comments, permissions, page history, formulas/relations/
  rollups as live constructs — degraded with warnings by design.

## 2. Data model (additive migration)

```prisma
enum ImportSource {
  GENERIC
  NOTION
  CONFLUENCE
  YANDEX_WIKI
}
```

`ImportJob.source ImportSource @default(GENERIC)` — a new column; existing rows
and the 6A flow are untouched (GENERIC = the 6A path verbatim). `format` keeps
meaning the uploaded file kind (MARKDOWN/HTML/ZIP); `source` selects the parser.

No other schema changes: the journal uses the existing `ImportArtifact` with
`kind: REPORT` pointing at a `File` row (`workspaceId: null`, owner-only — the
same privacy rule as export artifacts, enforced by the same reasoning: the
journal can name skipped private items).

## 3. Processor dispatch and the journal

`processImportJob` gains a source dispatch when building the plan:

- `GENERIC` / `YANDEX_WIKI` → `buildImportPlan` (6A, unchanged). Yandex Wiki is
  the same parser; the distinction is UI labeling + journal header.
- `NOTION` → `buildNotionImportPlan` (new).
- `CONFLUENCE` → `buildConfluenceImportPlan` (new).

All parsers return the same `ImportPlan` shape (roots/assets/warnings/totalPages)
**extended** with two optional capabilities consumed by the processor:

```ts
type ImportPlanExtras = {
  /** Extra mapping keys per node (e.g. the Notion 32-hex page id) — registered
   *  in ImportMapping alongside the path key so link rewriting can resolve
   *  source-native references. */
  aliasKeys?: Map<string /* sourceKey */, string[]>
  /** Database blueprints to materialize after page creation (Notion CSVs). */
  databases?: NotionDatabaseBlueprint[]
}
```

**Journal (REPORT artifact).** The processor accumulates a structured journal
(entry → action/warning/skip with reasons) throughout the run; on completion
(DONE or FAILED) it renders a human-readable UTF-8 `.txt`, stores it via
`storage.put` under `imports/<jobId>-report.txt`, creates the `File` row
(`workspaceId: null`, no expiry) + `ImportArtifact(kind: REPORT)`. `result` JSON
keeps the structured warnings (capped) as today. Journal write failures must not
fail the job (best-effort, logged).

New route `GET /api/jobs/import/[jobId]/report` — exact mirror of the export
artifact route: session → job owned by caller → REPORT artifact file ACTIVE →
stream `text/plain; charset=utf-8` with attachment disposition, `nosniff`,
uniform 404.

## 4. NotionExportZipParser (`apps/web/src/server/page-import/notion/`)

Notion export structure (both flavors): every entry name carries a 32-hex id
suffix — `Страница a1b2c3…f0.md`, dir `Страница a1b2c3…f0/`, database
`База a1b2c3…f0.csv` (+ optional `_all.csv` duplicate) beside a same-named dir
of row pages. HTML flavor: same tree with `.html` files.

1. **Name cleaning:** `splitNotionName(entryName) → { title, notionId | null }`
   (strip the trailing 32-hex token; keep full name when absent). Cleaned titles
   become page titles; ids become **alias mapping keys**.
2. **Tree building:** reuse the 6A tree conventions (folder merge etc.) on the
   CLEANED names, operating on a transformed entry list. `_all.csv` duplicates
   are dropped.
3. **Links:** Notion inter-page links embed the hex id (URL-encoded paths or
   `https://www.notion.so/<slug>-<id>`). The 6A second pass is extended: the
   processor registers each node under BOTH its path key and its alias keys, and
   the resolve callback also tries (a) the URL-decoded path, (b) a bare 32-hex
   id extracted from the href, (c) notion.so URLs by trailing id. Unresolvable
   links stay as-is (journal warning).
4. **Databases:** a `.csv` whose sibling dir contains row `.md`/`.html` files
   (or a standalone `.csv` with a Notion id) becomes a `NotionDatabaseBlueprint`
   `{ title, columns, rows, rowDocBySourceKey }`. The processor materializes it
   AFTER the page pass via the **`csv-to-database` mapper** (section 5): a
   DATABASE page at the blueprint's tree position, properties from columns, item
   pages from rows (row `.md` content parsed into the item page body; the row's
   alias id maps to the created item page for link rewriting).
5. **Warnings:** unsupported column kinds (person/relation/rollup/formula →
   imported as text), HTML-flavor constructs with no Tiptap mapping, comments/
   permissions/history (one summary note), files that fail asset rules.

## 5. csv-to-database mapper (`apps/web/src/server/page-import/csv-to-database.ts`)

Built for reuse by 6C. Input: `{ title, columns: string[], rows: string[][] }` +
destination (workspaceId, parentId, location) + actor. Behavior:

- CSV parsing: RFC-4180 (quotes, embedded commas/newlines), UTF-8 with BOM
  tolerance. A tiny hand-rolled parser (no new dependency) with unit tests.
- **Type inference per column** (sampling all values; empty cells ignored):
  every value numeric → NUMBER; checkbox-ish (`Yes/No`, `true/false`, `✓`) →
  CHECKBOX; ISO/Notion date formats → DATE; URL/EMAIL/PHONE by pattern; ≤24
  distinct short values with repeats → SELECT (comma-separated multi-values →
  MULTI_SELECT with options); otherwise TEXT. The FIRST column is the row title
  (Notion convention: "Name").
- Materialization through the Phase-3/4 domain service (`DatabaseService`):
  create the DATABASE page (provisions source + default view), create properties,
  create rows (item pages) and cell values. Person/relation/rollup/formula
  columns are NOT inferred — they import as TEXT with a journal warning each.
- Returns created ids + per-column decisions for the journal.

## 6. Confluence importer (`apps/web/src/server/page-import/confluence/`)

Confluence space HTML exports: an `index.html` + per-page `.html` files (+
`attachments/` and `images/` dirs). Parsing is best-effort and honest:

- Pages: every content `.html` → the 6A HTML→Tiptap chain; title from `<title>`/
  first `<h1>`; Confluence chrome (breadcrumbs, footer) stripped via a small
  pre-clean (linkedom: drop `#breadcrumbs`, `#footer`, `.page-metadata` when present).
- Hierarchy: from the directory structure when present, else flat under the
  import root with a journal note (Confluence exports are commonly flat).
- Attachments/images: bundled files become Files (same asset rules as 6A —
  image extensions only; other attachments are journal-skipped in 6B).
- Inter-page `.html` links rewritten via the standard second pass (path keys).
- Journal header states: permissions, history, comments, macros not imported.

## 7. Wizard UI + ImportLogViewer

- **Source step** (new first step in `ImportWizardDialog`): «Откуда импортируете?»
  cards — Файлы (.md/.html/.zip) [GENERIC], Notion, Confluence,
  Яндекс Wiki («расширение AnyNote» badge), plus disabled Asana and Monday cards
  («Недоступно в MVP» + a hint: export to CSV and import as a database — coming
  in 6C). Each enabled card shows its limitations under the title BEFORE upload
  (e.g. Notion: «комментарии, права и история не переносятся; формулы и связи
  станут текстом»). Selecting a card sets `source` and constrains the file
  accept (Notion/Confluence → .zip only).
- `job.import.create` input gains `source` (zod enum, default GENERIC); the
  router stores it; ext↔format validation unchanged.
- **ImportLogViewer**: import job rows in the Center get a «Журнал» action when
  warnings exist or the job finished — a dialog listing structured warnings from
  `result` + a «Скачать журнал» link to `/api/jobs/import/<id>/report` when the
  REPORT artifact exists. `job.list` adds `hasReport: boolean` and
  `warningsCount: number` to `JobListItem`.

## 8. Security summary

- All new parsers run inside the existing processor sandbox rules: zip-slip +
  depth guards (reused — Notion/Confluence entries pass through
  `normalizeEntryPath`), SVG still excluded, asset MIME by extension allowlist.
- REPORT artifact File rows: `workspaceId: null`, owner-gated route, uniform 404
  (journals can name skipped private items).
- The database mapper creates content as the JOB OWNER via the domain service —
  same actor model as page creation; no new ACL surface.
- Notion/Confluence parsing never executes source HTML: the HTML→Tiptap chain
  goes through turndown→markdown (script/event-handler content is dropped).

## 9. Dependencies and scope guards

- **No new dependencies** (CSV parser hand-rolled; everything else reuses 6A's
  fflate/marked/turndown/linkedom).
- The 6A generic flow must remain byte-identical for `source: GENERIC` —
  regression-guarded by the existing 6A test suites.
- Additive-only migration (1 enum + 1 column with default).

## 10. Testing

- **Unit:** splitNotionName; Notion link resolution (path/encoded/bare-id/
  notion.so forms); CSV parser (quotes/newlines/BOM); type inference table
  (number/checkbox/date/select/multi-select/url/email/text fallbacks, first-col
  title); Confluence pre-clean.
- **Integration (real DB + fake storage):** Notion MD&CSV fixture (id-suffixed
  tree + database CSV + inter-page links) → pages with cleaned titles, real
  DATABASE page with inferred properties + rows + row content, links → /pages/,
  REPORT artifact written; Notion HTML fixture with assets; Confluence-like
  fixture → tree + journal notes; idempotent re-run (alias keys don't duplicate);
  REPORT route owner-gating (mirror of the artifact-route tests).
- **E2E:** wizard source step → Notion card → fixture upload → job DONE →
  database page visible in tree → journal dialog opens with warnings.
