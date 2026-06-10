# Notion-parity Phase 6C — CSV database import/export + PDF bulk export

**Date:** 2026-06-10
**Branch:** `feat/notion-phase-6c-csv-pdf`
**Status:** approved design (cl6 prompt 6.4 — closes the cl6 roadmap)
**Builds on:** 6A (job infra, export pipeline, `htmlToPdf`/Gotenberg, database HTML tables)
and 6B (`csv.ts` RFC-4180 parser, `infer-columns.ts`, `materializeCsvDatabase`, the wizard).

## 1. Goals and non-goals

**Goals**

1. **CSV import** — upload a `.csv` through the wizard's «Файлы» source; a preview
   step shows sample rows + the inferred type per column with a user override
   (including «пропустить»); the job creates a real DATABASE page via the 6B
   materializer.
2. **CSV export** — «Экспорт CSV» on a database view: synchronous download
   applying the view's filters/sorts (via `listRows`), the view's property
   visibility, and the 4C row-access resolver; SELECT/MULTI_SELECT export
   **labels**, not option ids.
3. **PDF bulk export** — `ExportJobFormat.PDF_ZIP` for SUBTREE/COLLECTION scopes,
   capped at 50 collected pages; per-page Gotenberg render; a failed render
   degrades to that page's HTML file in-archive + a note in `ExportJob.result`;
   WORKSPACE scope never offers PDF (UI + server both enforce).

**Non-goals**

- No new import sources (6B owns those). No changes to the single-page export
  route. No Excel/.xlsx anywhere. No PDF for WORKSPACE scope (the roadmap:
  point users at Markdown/HTML for whole-workspace export).

## 2. Data model (additive migration)

- `enum ImportJobFormat` += `CSV`.
- `enum ExportJobFormat` += `PDF_ZIP`.
- `model ExportJob` += `result Json?` — `{ pdfFailures: string[] }` (page titles
  whose render fell back to HTML).
- `ImportJob.options` (JSON, no schema change) gains
  `columnOverrides?: Record<string /* column index */, InferredType | 'skip'>`
  and `databaseTitle?: string` (defaults to the file name).

## 3. CSV import

- **Wizard:** the GENERIC source card's `accept` gains `.csv`;
  `detectImportFormat` maps `.csv` → `CSV`. Picking a CSV inserts a **preview
  step** between file pick and destination: the file is read client-side
  (FileReader) and parsed with the SAME pure modules (`parseCsv` limited to the
  first ~200 rows for preview, `inferColumns`) — both are dependency-free and
  client-safe. The step renders up to 10 sample rows and, per column, a Select
  with the inferred type preselected (options: текст/число/чекбокс/дата/выбор/
  мультивыбор/URL/email/телефон/пропустить). Column 0 is fixed as «Название»
  (the row title) and cannot be overridden/skipped. A title field pre-filled
  with the file stem sets `databaseTitle`.
- **Router:** `importCreateInput.format` += `'CSV'` with ext check `csv`;
  `options` carries the overrides + title (validated by a zod record of the
  type-enum ∪ 'skip').
- **Processor:** `format === 'CSV'` (source GENERIC) builds a single
  `CsvDatabaseBlueprint` from the parsed file (title = `options.databaseTitle ??
  file stem`; header/rows from `parseCsv` with the 6B bounds) and runs
  `materializeCsvDatabase` — no page-tree pass. `inferColumns` gains an optional
  `overrides` parameter: an override pins the column type (value mapping follows
  the pinned type; unparseable cells degrade per-cell as in 6B); `'skip'` drops
  the column entirely (journal notes it). `totalPages = 1 + rows`.
- The upload allowlist already admits `text/csv`? — verification point: the 6A
  wizard forces safe MIME (`text/plain`) for non-zip files, which the allowlist
  admits; CSV rides the same path (`uploadMimeFor` returns text/plain for CSV).

## 4. CSV export (sync route)

`GET /api/pages/[pageId]/export/csv?viewId=<uuid?>` (apps/web, nodejs runtime):

1. Session → 404/401 as in the single-page export route; page must be a
   DATABASE page in a workspace the caller belongs to AND visible per
   `buildPageVisibilityWhere` (uniform 404 otherwise).
2. Resolve the view: `viewId` if given and belonging to this source, else the
   default (first TABLE) view. The view's `settings.propertyVisibility` (the
   Phase-4A shape — verified at plan time) decides exported columns; hidden
   properties are NOT exported. Computed read-only properties (FORMULA/ROLLUP/
   CREATED_*/LAST_EDITED_*/RELATION) export their `listRows`-resolved display
   values stringified.
3. Rows via `domain.database.listRows(actor, { pageId, viewId, limit: 200 })`
   cursor loop — filters/sorts/row access all apply server-side (the 4C
   resolver is the authority).
4. Serialization: a new pure `apps/web/src/server/page-export/csv-stringify.ts`:
   RFC-4180 escaping; header = «Название» + visible property names;
   SELECT/STATUS ids → option labels, MULTI_SELECT id arrays → label list
   joined `, `, CHECKBOX → `Да/Нет`, DATE → ISO date, others via the 6A
   `stringifyCellValue`. Property settings provide the id→label maps.
5. Stream `text/csv; charset=utf-8` with BOM (Excel compatibility), attachment
   disposition `<page-title>.csv`, `private, no-store`, nosniff.
6. UI: «Экспорт CSV» action in the database view toolbar menu (next to existing
   view actions), passing the CURRENT view id.

## 5. PDF bulk export

- **Router:** `exportCreateInput.format` += `'PDF_ZIP'`; validation: PDF_ZIP +
  WORKSPACE → BAD_REQUEST «PDF недоступен для всего пространства — используйте
  Markdown или HTML».
- **Processor (`process-export-job.ts`):** for PDF_ZIP, after `collectExportPages`:
  `if (pages.length > PDF_PAGE_LIMIT /* 50 */)` → FAILED with «Слишком много
  страниц для PDF (N > 50) — используйте Markdown или HTML». Rendering per page:
  build the same `wrapHtmlDocument` output as the HTML format, then
  `htmlToPdf` (existing Gotenberg client) → `<path>.pdf` entry. On any
  Gotenberg error: write `<path>.html` instead, record the page title in
  `pdfFailures`, continue. After the loop, persist
  `result: { pdfFailures }` on the job (empty array when clean). DATABASE pages
  render their table HTML (6A builders) → PDF like any page. Assets are NOT
  bundled for PDF (images are embedded by Gotenberg from absolute URLs? — NO:
  Gotenberg cannot fetch app-internal authed URLs; instead PDF rendering uses
  the 6A `embedImagesAndRewriteLinks` (base64 data-URIs) exactly like the
  existing single-page PDF route, so images appear in the PDFs and no assets/
  dir is emitted).
- **Center UI:** the export dialog's format toggle gains «PDF», disabled when
  scope is WORKSPACE (with the hint); job rows with non-empty `result.pdfFailures`
  show a warning tooltip («N страниц не удалось отрендерить — вложены как HTML»).
- **Env:** `GOTENBERG_URL` is already required and wired (compose port 3001).

## 6. Security summary

- CSV export: visibility predicate + row-access resolver + view property
  visibility — the only new authority decision is honoring `propertyVisibility`,
  which 4C explicitly treats as COSMETIC, not ACL; per the roadmap («respect …
  property visibility») hidden columns are excluded from the export as a
  UX-consistency measure, while real per-row security stays with the resolver.
- CSV import runs through the 6B materializer authority chain (actor = job
  owner, importer-created database).
- PDF artifacts follow the 6A artifact rules unchanged (workspaceId:null File,
  owner-gated download, 7-day expiry).

## 7. Testing

- **Unit:** csv-stringify (escaping, BOM, label mapping, Да/Нет, hidden
  columns); inferColumns overrides (pin + skip); detectImportFormat csv.
- **Integration (real DB):** CSV import job end-to-end (rows/properties created,
  override respected, skip dropped, journal notes); CSV export route (mock
  session): hidden property excluded, view filters applied, restricted rows
  absent (4C fixture), labels not ids; PDF_ZIP processor with a MOCKED htmlToPdf
  (inject failure for one page → that page lands as .html + result.pdfFailures;
  no Gotenberg dependency in unit/integration tests); >50-page cap → FAILED;
  WORKSPACE+PDF_ZIP router rejection.
- **E2E:** CSV import via the wizard preview (override one column) → database
  appears with typed columns; subtree PDF export (small fixture, REAL Gotenberg
  from compose) → job DONE → artifact downloads.
