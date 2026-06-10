# Notion-parity Phase 6A — Import/Export Center: foundation + core formats

**Date:** 2026-06-10
**Branch:** `feat/notion-phase-6a-import-export`
**Status:** approved design (cl6 prompt 6.1 + the first-party half of 6.2)

Phase 6 of the cl1–cl9 roadmap is split into three sequential sub-phases:

- **6A (this spec):** ImportJob/ExportJob infrastructure + Import/Export Center UI +
  core Markdown/HTML/ZIP import + workspace/collection/subtree export to Markdown & HTML ZIP.
- **6B (later):** Notion-export ZIP parser + third-party import wizards
  (Confluence/Asana/Monday/Yandex Wiki).
- **6C (later):** CSV database import/export + PDF bulk export.

## 1. Goals and non-goals

**Goals**

1. Async job infrastructure for imports/exports, with progress, error states, and
   crash recovery — without a new service or queue.
2. Import: a single `.md` file, a single `.html` file, or a `.zip` of
   Markdown/HTML files (folder hierarchy → page tree), into a user-chosen
   destination (collection + optional parent page).
3. Export: a whole workspace, one collection, or a page subtree as a ZIP of
   Markdown or HTML — Notion-style layout, images as real files, internal links
   rewritten.
4. An «Импорт и экспорт» section in the workspace settings dialog (the Center):
   start imports/exports, watch progress, download artifacts, delete jobs.
5. Export never leaks content the requesting user cannot see.

**Non-goals (deferred)**

- Notion/Confluence/Asana/Monday/Yandex parsers — 6B.
- CSV database import/export, PDF bulk export — 6C.
- Import of canvas page types (Excalidraw/Genogram/Mermaid/PlantUML/Kanban) — out of cl6.
- Any change to the existing **single-page** export route
  (`GET /api/pages/[pageId]/export/[format]`) — it remains the synchronous
  one-page path and is not part of the Center.

## 2. Execution model

All work runs in **apps/web**. No new engines app, no package extraction.

- **1 page → sync stream** (the existing route, unchanged; not a job).
- **Anything multi-page or any ZIP → a job row**, processed in the web process
  by a fire-and-forget background task kicked after the creating call returns.

**Orphan recovery (lazy reclaim).** A deploy/restart can kill an in-flight task.
`job.list` — which the Center polls — reclaims any job stuck in `PROCESSING`
whose `heartbeatAt` is older than 10 minutes: it resets the job to `QUEUED` and
re-kicks it. Re-running is safe in both directions:

- **Export** re-runs are trivially idempotent (the ZIP is rebuilt from scratch;
  the artifact is written last).
- **Import** re-runs are idempotent via `ImportMapping`: every created page is
  recorded as `(jobId, sourceKey → pageId)` immediately after creation; on
  re-run, entries whose `sourceKey` already has a mapping are skipped.

The runner updates `heartbeatAt` as it processes (at least once per page), so a
slow-but-alive job is never reclaimed.

**Concurrency guard:** at most 1 active (`QUEUED`/`PROCESSING`) import job and 1
active export job per workspace; `create` rejects with a Russian user-facing
error otherwise.

## 3. Data model (Prisma, additive migration)

New enums:

```prisma
enum JobStatus           { QUEUED PROCESSING DONE FAILED }
enum ExportJobScope      { WORKSPACE COLLECTION SUBTREE }
enum ExportJobFormat     { MARKDOWN_ZIP HTML_ZIP }
enum ImportJobFormat     { MARKDOWN HTML ZIP }
enum ImportArtifactKind  { SOURCE REPORT }
```

New models (names follow the roadmap):

```prisma
model ExportJob {
  id           String          @id @default(uuid(7)) @db.Uuid
  workspaceId  String          @db.Uuid
  userId       String          @db.Uuid           // creator & only reader
  status       JobStatus       @default(QUEUED)
  scope        ExportJobScope
  scopeId      String?         @db.Uuid           // collectionId | root pageId, null for WORKSPACE
  format       ExportJobFormat
  processed    Int             @default(0)
  total        Int             @default(0)
  error        String?
  heartbeatAt  DateTime?
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime        @default(now())
  workspace    Workspace       @relation(...)
  user         User            @relation(...)
  artifacts    ExportArtifact[]
  @@index([workspaceId, userId, createdAt])
  @@index([status, heartbeatAt])
}

model ImportJob {
  id           String          @id @default(uuid(7)) @db.Uuid
  workspaceId  String          @db.Uuid
  userId       String          @db.Uuid
  status       JobStatus       @default(QUEUED)
  format       ImportJobFormat
  options      Json            // { collectionId: string|null, parentId: string|null }
  result       Json?           // { pagesCreated, rootPageIds: string[], warnings: string[] }
  processed    Int             @default(0)
  total        Int             @default(0)
  error        String?
  heartbeatAt  DateTime?
  startedAt    DateTime?
  finishedAt   DateTime?
  createdAt    DateTime        @default(now())
  workspace    Workspace       @relation(...)
  user         User            @relation(...)
  artifacts    ImportArtifact[]
  mappings     ImportMapping[]
  @@index([workspaceId, userId, createdAt])
  @@index([status, heartbeatAt])
}

model ExportArtifact {
  id        String    @id @default(uuid(7)) @db.Uuid
  jobId     String    @db.Uuid
  fileId    String    @db.Uuid     // private File row; File.expiresAt = now()+7d
  createdAt DateTime  @default(now())
  job       ExportJob @relation(...)
  file      File      @relation(...)
  @@unique([jobId, fileId])
}

model ImportArtifact {
  id        String             @id @default(uuid(7)) @db.Uuid
  jobId     String             @db.Uuid
  fileId    String             @db.Uuid     // SOURCE = the uploaded file
  kind      ImportArtifactKind @default(SOURCE)
  createdAt DateTime           @default(now())
  job       ImportJob          @relation(...)
  file      File               @relation(...)
  @@unique([jobId, fileId])
}

model ImportMapping {
  id        String    @id @default(uuid(7)) @db.Uuid
  jobId     String    @db.Uuid
  sourceKey String                         // normalized path inside the source (or the single file name)
  pageId    String    @db.Uuid
  createdAt DateTime  @default(now())
  job       ImportJob @relation(...)
  page      Page      @relation(...)
  @@unique([jobId, sourceKey])
  @@index([jobId])
}
```

`REPORT` artifacts and richer mappings are reserved for 6B (Notion link
rewriting across files reuses `ImportMapping` as-is).

**Privacy rule:** jobs and artifacts are visible **only to their creator**.
A workspace export contains the creator's personal pages, so even workspace
admins must not list or download another user's jobs/artifacts. All job queries
filter `userId = ctx.user.id` (plus workspace membership).

## 4. API surface

### tRPC `job` router (`packages/trpc/src/routers/job.ts`)

All procedures assert workspace membership and operate only on the caller's own jobs.

- `job.export.create({ workspaceId, scope, scopeId?, format })` → validates the
  scope target exists and is visible to the caller, enforces the concurrency
  guard, inserts `ExportJob(QUEUED)`, calls `ctx.jobs.kick(id, 'export')`,
  returns the job.
- `job.import.create({ workspaceId, fileId, format, collectionId?, parentId? })`
  → validates the uploaded `File` (owned by caller, allowed MIME), validates the
  destination (collection belongs to workspace; parent visible+editable),
  inserts `ImportJob(QUEUED)` + `ImportArtifact(SOURCE)`, kicks, returns the job.
- `job.list({ workspaceId })` → the caller's import+export jobs (newest first,
  capped at 50) **and performs the lazy reclaim**: any of the caller's jobs in
  `PROCESSING` with `heartbeatAt < now()-10min` is reset to `QUEUED` and
  re-kicked before the list is returned.
- `job.delete({ workspaceId, kind, jobId })` → owner-only; deletes the job row
  (cascade artifacts/mappings rows) and best-effort deletes artifact File rows +
  S3 objects. Mappings deletion does NOT delete imported pages.

### The kick port

`packages/trpc` cannot import apps/web runner code, so the runner is injected
through tRPC context — the same pattern as the existing `yookassa` client:

```ts
// context shape addition
jobs: { kick(jobId: string, kind: 'import' | 'export'): void }
```

`apps/web` wires the real implementation (dynamic-imports the runner and fires
it un-awaited); `createCaller` for RSC and unit tests injects a no-op.

### Artifact download route

`GET /api/jobs/export/[jobId]/artifact` (apps/web, `runtime='nodejs'`):
session user must **own** the job; job must be `DONE` with an artifact; the
linked `File.expiresAt` must be in the future. Streams from `storage.get` with
`Content-Disposition: attachment`. 404 in every failure case (no existence leak).

## 5. Export pipeline (`apps/web/src/server/page-export/bulk/`)

1. **Collect the page set.** Canonical predicate — `buildPageVisibilityWhere(userId)`
   AND `excludeDatabaseRowPages` AND `deletedAt: null` AND `archivedAt: null` —
   bounded by scope:
   - `WORKSPACE`: all pages of the workspace,
   - `COLLECTION`: pages with that `collectionId`,
   - `SUBTREE`: the scope page + descendants (BFS over `parentId`), each node
     still passing the visibility predicate (a hidden descendant prunes its branch).
   `total` = page count; `processed`/`heartbeatAt` update per page.
2. **Layout (Notion-style).** A page becomes `Title.md`/`.html`; a page with
   children also gets a sibling folder `Title/` containing the children.
   Filenames are slugified with numeric-suffix dedup per directory.
3. **Convert.** TEXT pages: existing `tiptapJsonToHtml` (+`htmlToMarkdown` for
   MD format). **Images become real files**: instead of base64-embedding,
   the bulk pipeline downloads each referenced `/api/files/<id>` body from
   `storage` into `assets/<fileId>.<ext>` inside the ZIP and rewrites `src` to a
   relative path. Internal page links: relative path when the target page is in
   the export, absolute URL otherwise.
4. **DATABASE pages (6A treatment):** a simple Markdown/HTML table — column per
   visible property, row per row returned by `DatabaseService.listRows` for the
   requesting user (per-row access rules from 4C therefore apply). Full CSV is 6C.
5. **Canvas types** (EXCALIDRAW/GENOGRAM/MERMAID/PLANTUML/KANBAN): a stub file
   with the title and a one-line note that this page type is not included in 6A
   exports.
6. **Bundle and store.** ZIP built with `fflate`, written via `storage.put`
   under `exports/<jobId>.zip`; a private `File` row
   (`isPublic:false`, `workspaceId`, `expiresAt = now()+7d`, `mimeType
   application/zip`) + `ExportArtifact` row. Artifacts count toward
   `WorkspaceLimit.maxFileBytes` while they live; deleting the job frees the quota.
   Physical S3 cleanup of expired artifacts past the route-level 404 is *not*
   part of 6A (noted as follow-up).

## 6. Import pipeline (`apps/web/src/server/page-import/`)

1. **Source upload** uses the existing `/api/files/upload?kind=attachment`
   (ZIP/MD/HTML already pass MIME validation; the 50 MB cap is 6A's import size
   limit and the quota check applies).
2. **Format handling.**
   - `MARKDOWN`: one page from one `.md`.
   - `HTML`: one page from one `.html`.
   - `ZIP` (unpacked with `fflate`): walk entries; `.md`/`.html` become pages,
     image entries become assets, everything else is skipped with a warning in
     `result.warnings`. Folder hierarchy → page tree. Convention: a folder is a
     parent page titled by the folder name; if a sibling `Foo.md` matches folder
     `Foo/`, that file's content becomes the parent page `Foo`'s body (common
     wiki/Notion layout). ZIP-slip guard: entry paths are normalized and any
     entry escaping the root is rejected.
3. **Conversion core** — one canonical path:
   - `.md` → `marked`-based Markdown→Tiptap parser, ported from the engines
     `MarkdownParser` into `apps/web/src/server/page-import/markdown-to-tiptap.ts`
     (paragraphs, headings, bullet/ordered/task lists, blockquotes, code blocks,
     hr, bold/italic/code/links, images).
   - `.html` → existing `turndown` (`htmlToMarkdown`) → the same parser
     (accepted lossiness on tables/custom nodes for 6A).
   - Title = first H1 (stripped from the body) else the filename.
4. **`contentYjs` is computed at creation** — the yjs loader seeds *only* from
   `contentYjs` (verified: `apps/yjs/src/persistence.ts` `loadPageDocument`),
   so imports follow the `buildWelcomePageContent` pattern
   (`packages/trpc/src/helpers/welcome-page-content.ts`):
   `TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)` +
   `Y.encodeStateAsUpdate`, with an extension set matching every node type the
   parser emits. Pages are created via the page domain service with both
   `content` and `contentYjs`; the indexing outbox event comes for free.
5. **Page creation** is top-down (parents before children) into the chosen
   destination (`collectionId` + optional `parentId`); each created page is
   recorded in `ImportMapping` immediately (idempotent resume).
6. **Images**: ZIP image entries referenced by documents become `File` rows
   (content-hash dedup, quota-checked) + `PageFile` links; `src` rewritten to
   `/api/files/<id>`.
7. **Link rewriting (second pass):** relative links between imported files are
   resolved through `ImportMapping` and rewritten to `/pages/<pageId>`; this
   pass re-saves `content`+`contentYjs` for affected pages only.
8. **Failure is non-transactional:** already-created pages remain; `result`
   carries `rootPageIds` and `warnings`; the job goes `FAILED` with a
   user-facing Russian `error`.

## 7. UI — Import/Export Center

- New `'import-export'` slug («Импорт и экспорт») in
  `workspace-settings-dialog.tsx`, following the existing `SettingsItem` pattern.
- The panel: two action cards («Импортировать» / «Экспортировать») + the job
  history table — kind, scope/source label, status chip (queued/in
  progress with `processed/total`, done, failed with tooltip error), created
  date, actions (download for DONE exports, delete).
- **Import wizard** (dialog, 3 steps): file pick (plain `<input type="file">`,
  the task-attachments pattern; accepts `.md,.html,.zip`) → destination
  (collection select + optional parent page picker) → confirm (uploads the file,
  then `job.import.create`).
- **Export dialog**: scope (workspace / collection select / subtree page picker)
  + format (Markdown ZIP / HTML ZIP) → `job.export.create`.
- Polling: React Query `refetchInterval` ≈ 2.5 s while any listed job is
  `QUEUED`/`PROCESSING` (this also drives the server-side lazy reclaim);
  otherwise no polling.
- The page action menu gets «Экспортировать с подстраницами…», opening the
  export dialog pre-scoped to `SUBTREE` of that page.

## 8. Limits, errors, security summary

- Import size ≤ 50 MB (existing attachment cap). Export artifacts expire after
  7 days and count toward workspace storage quota until deleted/expired.
- 1 active import + 1 active export per workspace.
- Export page set: visibility predicate + row-access resolver everywhere; the
  creator-only artifact gate prevents cross-user artifact reads; download route
  404s uniformly.
- Import destination requires edit access to the parent (or membership for a
  collection root); imported pages get `createdById = job.userId`.
- ZIP-slip path normalization; non-md/html/image entries skipped, never executed.
- No new env vars; no plan-feature gating in 6A (any plan may import/export).

## 9. Dependencies

Added to `apps/web` only: **`fflate`** (ZIP pack/unpack, zero deps) and
**`marked`** (Markdown lexing — same library the engines parser uses).
No engines/agents changes. Additive-only Prisma migration.

## 10. Testing

- **Unit (apps/web vitest):** markdown-to-tiptap parser table (headings, nested
  lists, task lists, code blocks, blockquote, links, images, inline marks);
  HTML→MD→Tiptap chain; slug/dedup; ZIP tree mapping (folder conventions,
  `Foo.md`+`Foo/` merge, zip-slip rejection); export layout naming; link-rewrite
  pass; reclaim decision logic.
- **Real-DB tRPC tests (packages/trpc):** export page-set filtering — another
  user's personal pages, trashed, archived pages and access-restricted database
  rows never enter the collected set; artifact owner-gating; concurrency guard;
  import create→mapping idempotency (simulated re-run skips mapped entries);
  `job.list` reclaim of a stale-heartbeat job.
- **E2E (Playwright):** import a small fixture ZIP (2 md files + a folder) →
  pages appear in the tree with correct nesting; subtree export → job reaches
  DONE → download button appears. Content-text assertions stay at title/tree
  level (E2E has no yjs server).
