# Phase 6A — Import/Export Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Async ImportJob/ExportJob infrastructure + Import/Export Center UI + Markdown/HTML/ZIP import (folder hierarchy → page tree) + workspace/collection/subtree export to Markdown/HTML ZIP, per the approved spec `docs/superpowers/specs/2026-06-10-import-export-center-design.md`.

**Architecture:** All work runs in apps/web. Jobs are Prisma rows claimed atomically (`updateMany QUEUED→PROCESSING`), processed by fire-and-forget async functions kicked through a tRPC context port (`ctx.jobs.kick`, injected like `yookassa`). `job.list` lazily reclaims stale jobs (heartbeat > 10 min). Import idempotency via `ImportMapping` (sourceKey→pageId). Export reuses the existing page-export converters + the canonical visibility predicate.

**Tech Stack:** Prisma 7, tRPC v11, fflate (zip), marked@^14.1.3 (md→Tiptap, ported from engines), turndown (html→md, already in web), `@hocuspocus/transformer` + yjs (contentYjs, welcome-page pattern), MUI via `@repo/ui/components`, Vitest, Playwright.

---

## Worker ground rules (apply to every task)

- Worktree: `/Users/victor/.config/superpowers/worktrees/anynote/notion-phase-6a-import-export`, branch `feat/notion-phase-6a-import-export`. All commands run from the worktree root unless stated.
- Prettier: `semi: false`, single quotes, trailing commas, 100-char width. Run `pnpm format` on touched files if unsure.
- **Never `git add -A` / `git add .`** — stage explicit paths only (the repo root has untracked `cl*.md` scratch files that must never be committed; shared-stash contamination has bitten this repo before).
- Conventional Commits with scope; husky runs lint-staged on commit — do not bypass with `--no-verify` (the only allowed exception: `docs(specs)`/`docs(plans)`-only commits where gates are irrelevant, and even then prefer the normal path).
- Real-DB tests need `docker compose up -d` (postgres). Both `packages/trpc/test/setup.ts` and `apps/web/test/setup.ts` already load the repo-root `.env`.
- New server files in apps/web live under `apps/web/src/server/`; they may import `@repo/domain` root barrel (server-side only — the client-barrel restriction applies to client components).
- Do NOT import dto runtime (zod) from `@repo/domain` into client components — type-only imports there (pulls `pg` into the browser bundle otherwise; `pnpm --filter web build` catches it).
- No new env vars in 6A. No new workspace packages (so no `transpilePackages` changes).

### Plan-level refinements vs the spec (intentional)

1. `ImportJob.options` stores `{ location: 'team' | 'private', parentId: string | null }` instead of `collectionId` — this matches the domain's `createPageInput.location` semantics exactly (resolveCollectionId handles team/personal fallback); when `parentId` is set the collection is inherited from the parent.
2. SVG is **excluded** from importable assets: `/api/files/[id]` serves `inline` with the stored MIME, so stored SVG would be a same-origin XSS vector. SVG entries become warnings. For the same reason the import wizard uploads `.md`/`.html` sources as `text/plain` (`text/html` is deliberately absent from the upload allowlist).
3. New models use the recent id convention `@default(dbgenerated("gen_random_uuid()"))`, not `uuid(7)`.

---

## Task 1: Prisma schema — 5 models + 5 enums + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append models at end; add reverse relations to `User`, `Workspace`, `Page`, `File`)
- Create: `packages/db/prisma/migrations/20260610120000_import_export_jobs/migration.sql` (generated)

- [ ] **Step 1: Append enums + models to the END of `packages/db/prisma/schema.prisma`**

```prisma
// ── Phase 6A: import/export jobs ─────────────────────────────────────────────

enum JobStatus {
  QUEUED
  PROCESSING
  DONE
  FAILED
}

enum ExportJobScope {
  WORKSPACE
  COLLECTION
  SUBTREE
}

enum ExportJobFormat {
  MARKDOWN_ZIP
  HTML_ZIP
}

enum ImportJobFormat {
  MARKDOWN
  HTML
  ZIP
}

enum ImportArtifactKind {
  SOURCE
  REPORT
}

model ExportJob {
  id          String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String          @map("workspace_id") @db.Uuid
  userId      String          @map("user_id") @db.Uuid
  status      JobStatus       @default(QUEUED)
  scope       ExportJobScope
  scopeId     String?         @map("scope_id") @db.Uuid
  format      ExportJobFormat
  processed   Int             @default(0)
  total       Int             @default(0)
  error       String?         @db.Text
  heartbeatAt DateTime?       @map("heartbeat_at") @db.Timestamptz(6)
  startedAt   DateTime?       @map("started_at") @db.Timestamptz(6)
  finishedAt  DateTime?       @map("finished_at") @db.Timestamptz(6)
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User             @relation("ExportJobUser", fields: [userId], references: [id], onDelete: Cascade)
  artifacts ExportArtifact[]

  @@index([workspaceId, userId, createdAt])
  @@index([status, heartbeatAt])
  @@map("export_jobs")
}

model ImportJob {
  id          String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String          @map("workspace_id") @db.Uuid
  userId      String          @map("user_id") @db.Uuid
  status      JobStatus       @default(QUEUED)
  format      ImportJobFormat
  options     Json            @default("{}")
  result      Json?
  processed   Int             @default(0)
  total       Int             @default(0)
  error       String?         @db.Text
  heartbeatAt DateTime?       @map("heartbeat_at") @db.Timestamptz(6)
  startedAt   DateTime?       @map("started_at") @db.Timestamptz(6)
  finishedAt  DateTime?       @map("finished_at") @db.Timestamptz(6)
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User             @relation("ImportJobUser", fields: [userId], references: [id], onDelete: Cascade)
  artifacts ImportArtifact[]
  mappings  ImportMapping[]

  @@index([workspaceId, userId, createdAt])
  @@index([status, heartbeatAt])
  @@map("import_jobs")
}

model ExportArtifact {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  jobId     String   @map("job_id") @db.Uuid
  fileId    String   @map("file_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  job  ExportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  file File      @relation("ExportArtifactFile", fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([jobId, fileId])
  @@map("export_artifacts")
}

model ImportArtifact {
  id        String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  jobId     String             @map("job_id") @db.Uuid
  fileId    String             @map("file_id") @db.Uuid
  kind      ImportArtifactKind @default(SOURCE)
  createdAt DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  job  ImportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  file File      @relation("ImportArtifactFile", fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([jobId, fileId])
  @@map("import_artifacts")
}

model ImportMapping {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  jobId     String   @map("job_id") @db.Uuid
  sourceKey String   @map("source_key") @db.Text
  pageId    String   @map("page_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  job  ImportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)
  page Page      @relation("ImportMappingPage", fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([jobId, sourceKey])
  @@map("import_mappings")
}
```

- [ ] **Step 2: Add reverse relations to existing models** (same file)

In `model User` (relation list region), add:

```prisma
  exportJobs ExportJob[] @relation("ExportJobUser")
  importJobs ImportJob[] @relation("ImportJobUser")
```

In `model Workspace` (relation list region), add:

```prisma
  exportJobs ExportJob[]
  importJobs ImportJob[]
```

In `model Page` (relation list, after `notificationPrefs`), add:

```prisma
  importMappings ImportMapping[] @relation("ImportMappingPage")
```

In `model File` (relation list, after `tasks`), add:

```prisma
  exportArtifacts ExportArtifact[] @relation("ExportArtifactFile")
  importArtifacts ImportArtifact[] @relation("ImportArtifactFile")
```

- [ ] **Step 3: Generate the migration via schema-to-schema diff (no shadow DB; established shared-dev-DB-safe pattern)**

```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-before-6a.prisma
mkdir -p packages/db/prisma/migrations/20260610120000_import_export_jobs
pnpm --filter @repo/db exec prisma migrate diff \
  --from-schema-datamodel /tmp/schema-before-6a.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > packages/db/prisma/migrations/20260610120000_import_export_jobs/migration.sql
```

Inspect the SQL: it must contain ONLY `CREATE TYPE` ×5, `CREATE TABLE` ×5, `CREATE INDEX`/`CREATE UNIQUE INDEX`, and `ADD CONSTRAINT ... FOREIGN KEY` statements (purely additive). If anything else appears (ALTER/DROP on existing tables), STOP and report.

- [ ] **Step 4: Apply + mark applied + regenerate client**

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" --single-transaction -f packages/db/prisma/migrations/20260610120000_import_export_jobs/migration.sql
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260610120000_import_export_jobs
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec prisma migrate status
```

Expected: `Database schema is up to date!` (no drift, no pending).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260610120000_import_export_jobs
git commit -m "feat(db): import/export job models (ExportJob, ImportJob, artifacts, mappings)"
```

---

## Task 2: Dependencies + UI icon re-exports

**Files:**
- Modify: `apps/web/package.json` (+ lockfile)
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add deps to apps/web** (versions matched to the workspace: `marked` pins ^14.1.3 like engines/editor; transformer/yjs match packages/trpc)

```bash
pnpm --filter web add fflate marked@^14.1.3 "@hocuspocus/transformer@^3.4.4" "yjs@^13.6.30"
```

- [ ] **Step 2: Add icon re-exports to `packages/ui/src/components/index.ts`** — next to the existing icon block (e.g. after the `DownloadIcon`/`FileDownloadIcon` lines at ~181-182), following the exact same pattern:

```ts
export { default as ImportExportIcon } from '@mui/icons-material/ImportExport'
export { default as UploadFileIcon } from '@mui/icons-material/UploadFile'
```

- [ ] **Step 3: Verify build of the two touched workspaces**

```bash
pnpm --filter @repo/ui lint && pnpm --filter web check-types
```

Expected: clean (check-types may take a while; acceptable).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml packages/ui/src/components/index.ts
git commit -m "feat(web): add fflate/marked/transformer deps + ui import-export icons"
```

---

## Task 3: Markdown → Tiptap converter (ported from engines, + images + task lists + title extraction)

**Files:**
- Create: `apps/web/src/server/page-import/markdown-to-tiptap.ts`
- Test: `apps/web/test/server/markdown-to-tiptap.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'

import {
  markdownToTiptap,
  parseMarkdownDocument,
} from '../../src/server/page-import/markdown-to-tiptap'

describe('markdownToTiptap', () => {
  it('parses headings with clamped levels', () => {
    const doc = markdownToTiptap('# H1\n\n###### H6')
    expect(doc.content[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
    expect(doc.content[1]).toMatchObject({ type: 'heading', attrs: { level: 6 } })
  })

  it('parses nested bullet lists', () => {
    const doc = markdownToTiptap('- a\n  - b')
    expect(doc.content[0]!.type).toBe('bulletList')
    const item = doc.content[0]!.content![0]!
    expect(item.type).toBe('listItem')
    expect(JSON.stringify(item)).toContain('bulletList')
  })

  it('parses GFM task lists into taskList/taskItem with checked attrs', () => {
    const doc = markdownToTiptap('- [ ] open\n- [x] done')
    expect(doc.content[0]!.type).toBe('taskList')
    expect(doc.content[0]!.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: false } })
    expect(doc.content[0]!.content![1]).toMatchObject({ type: 'taskItem', attrs: { checked: true } })
  })

  it('parses fenced code blocks with language', () => {
    const doc = markdownToTiptap('```ts\nconst a = 1\n```')
    expect(doc.content[0]).toMatchObject({ type: 'codeBlock', attrs: { language: 'ts' } })
    expect(doc.content[0]!.content![0]!.text).toBe('const a = 1')
  })

  it('parses blockquote and hr', () => {
    const doc = markdownToTiptap('> quote\n\n---')
    expect(doc.content[0]!.type).toBe('blockquote')
    expect(doc.content[1]!.type).toBe('horizontalRule')
  })

  it('parses inline marks: bold, italic, code, link (nested)', () => {
    const doc = markdownToTiptap('**bold _both_** `code` [link](https://example.com)')
    const text = JSON.stringify(doc)
    expect(text).toContain('"type":"bold"')
    expect(text).toContain('"type":"italic"')
    expect(text).toContain('"type":"code"')
    expect(text).toContain('"href":"https://example.com"')
  })

  it('hoists images out of paragraphs as block image nodes', () => {
    const doc = markdownToTiptap('before ![alt](pic.png) after')
    const types = doc.content.map((n) => n.type)
    expect(types).toEqual(['paragraph', 'image', 'paragraph'])
    expect(doc.content[1]).toMatchObject({ type: 'image', attrs: { src: 'pic.png', alt: 'alt' } })
  })

  it('applies resolveImageSrc and keeps original on null', () => {
    const doc = markdownToTiptap('![a](images/a.png)\n\n![b](https://x/b.png)', {
      resolveImageSrc: (src) => (src.startsWith('images/') ? '/api/files/f1' : null),
    })
    expect(doc.content[0]).toMatchObject({ type: 'image', attrs: { src: '/api/files/f1' } })
    expect(doc.content[1]).toMatchObject({ type: 'image', attrs: { src: 'https://x/b.png' } })
  })

  it('returns an empty doc for blank input', () => {
    expect(markdownToTiptap('  \n ')).toEqual({ type: 'doc', content: [] })
  })
})

describe('parseMarkdownDocument', () => {
  it('extracts a leading H1 as the title and strips it from the body', () => {
    const { title, doc } = parseMarkdownDocument('# Заголовок\n\nТело.', 'fallback')
    expect(title).toBe('Заголовок')
    expect(JSON.stringify(doc)).not.toContain('Заголовок')
    expect(JSON.stringify(doc)).toContain('Тело.')
  })

  it('falls back to the provided title when there is no leading H1', () => {
    const { title } = parseMarkdownDocument('Просто текст', 'Имя файла')
    expect(title).toBe('Имя файла')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run test/server/markdown-to-tiptap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/web/src/server/page-import/markdown-to-tiptap.ts`**

Port of `apps/engines/src/apps/mcp/services/markdown-parser.service.ts` (class → functions) with three additions: GFM task lists, block-image hoisting with `resolveImageSrc`, and `parseMarkdownDocument` title extraction.

```ts
import { marked, type Token, type Tokens } from 'marked'

type Mark = { type: string; attrs?: Record<string, unknown> }

export type TiptapNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: Mark[]
}

export type TiptapDoc = { type: 'doc'; content: TiptapNode[] }

export type ParseOptions = {
  /** Rewrite image srcs (e.g. archive-relative paths → /api/files/<id>). Return null to keep the original. */
  resolveImageSrc?: (src: string) => string | null
}

export function markdownToTiptap(markdown: string, opts: ParseOptions = {}): TiptapDoc {
  if (!markdown?.trim()) return { type: 'doc', content: [] }
  const tokens = marked.lexer(markdown, { gfm: true })
  return { type: 'doc', content: tokens.flatMap((t) => parseBlock(t, opts)) }
}

/**
 * Parse a whole imported document: a leading H1 becomes the page title (stripped
 * from the body); otherwise the fallback (file/folder name) is used.
 */
export function parseMarkdownDocument(
  markdown: string,
  fallbackTitle: string,
  opts: ParseOptions = {},
): { title: string; doc: TiptapDoc } {
  const tokens = marked.lexer(markdown ?? '', { gfm: true })
  let title = fallbackTitle
  let body: Token[] = tokens
  const firstIdx = tokens.findIndex((t) => t.type !== 'space')
  const first = firstIdx >= 0 ? tokens[firstIdx] : undefined
  if (first && first.type === 'heading' && (first as Tokens.Heading).depth === 1) {
    title = (first as Tokens.Heading).text.trim() || fallbackTitle
    body = tokens.filter((_, i) => i !== firstIdx)
  }
  return { title, doc: { type: 'doc', content: body.flatMap((t) => parseBlock(t, opts)) } }
}

function parseBlock(token: Token, opts: ParseOptions): TiptapNode[] {
  switch (token.type) {
    case 'paragraph': {
      const t = token as Tokens.Paragraph
      return splitParagraphWithImages(t.tokens, opts)
    }
    case 'heading': {
      const t = token as Tokens.Heading
      return [
        {
          type: 'heading',
          attrs: { level: Math.max(1, Math.min(6, t.depth)) },
          content: parseInline(t.tokens, opts),
        },
      ]
    }
    case 'list':
      return [parseList(token as Tokens.List, opts)]
    case 'blockquote': {
      const t = token as Tokens.Blockquote
      return [
        {
          type: 'blockquote',
          content: t.tokens.flatMap((child) => parseBlock(child, opts)),
        },
      ]
    }
    case 'code': {
      const t = token as Tokens.Code
      return [
        {
          type: 'codeBlock',
          attrs: t.lang ? { language: t.lang } : {},
          content: [{ type: 'text', text: t.text }],
        },
      ]
    }
    case 'hr':
      return [{ type: 'horizontalRule' }]
    case 'space':
      return []
    default: {
      const inlineTokens = (token as { tokens?: Token[] }).tokens
      if (inlineTokens) return splitParagraphWithImages(inlineTokens, opts)
      const raw = (token as { text?: string }).text ?? ''
      if (!raw) return []
      return [{ type: 'paragraph', content: [{ type: 'text', text: raw }] }]
    }
  }
}

function parseList(token: Tokens.List, opts: ParseOptions): TiptapNode {
  const isTask = token.items.some((i) => i.task)
  if (isTask) {
    return {
      type: 'taskList',
      content: token.items.map((item) => ({
        type: 'taskItem',
        attrs: { checked: item.checked === true },
        content: item.tokens.flatMap((child) => parseBlock(child, opts)),
      })),
    }
  }
  return {
    type: token.ordered ? 'orderedList' : 'bulletList',
    content: token.items.map((item) => ({
      type: 'listItem',
      content: item.tokens.flatMap((child) => parseBlock(child, opts)),
    })),
  }
}

// The Tiptap Image node is block-level (the editor's schema mirrors this), but
// markdown allows images inline. Split the paragraph around each image so the
// emitted JSON is schema-valid: text runs become paragraphs, images become
// sibling block nodes.
function splitParagraphWithImages(tokens: Token[], opts: ParseOptions): TiptapNode[] {
  const out: TiptapNode[] = []
  let run: Token[] = []
  const flush = () => {
    if (run.length === 0) return
    const inline = parseInline(run, opts)
    if (inline.length > 0) out.push({ type: 'paragraph', content: inline })
    run = []
  }
  for (const tok of tokens) {
    if (tok.type === 'image') {
      flush()
      const img = tok as Tokens.Image
      const resolved = opts.resolveImageSrc?.(img.href) ?? null
      out.push({
        type: 'image',
        attrs: { src: resolved ?? img.href, ...(img.text ? { alt: img.text } : {}) },
      })
    } else {
      run.push(tok)
    }
  }
  flush()
  return out
}

function parseInline(tokens: Token[], opts: ParseOptions): TiptapNode[] {
  const out: TiptapNode[] = []
  for (const token of tokens) out.push(...parseInlineToken(token, [], opts))
  return out
}

function parseInlineToken(token: Token, marks: Mark[], opts: ParseOptions): TiptapNode[] {
  switch (token.type) {
    case 'text': {
      const t = token as Tokens.Text
      if (t.tokens) return t.tokens.flatMap((nested) => parseInlineToken(nested, marks, opts))
      return [{ type: 'text', text: t.text, ...(marks.length ? { marks } : {}) }]
    }
    case 'strong': {
      const t = token as Tokens.Strong
      return t.tokens.flatMap((nested) =>
        parseInlineToken(nested, [...marks, { type: 'bold' }], opts),
      )
    }
    case 'em': {
      const t = token as Tokens.Em
      return t.tokens.flatMap((nested) =>
        parseInlineToken(nested, [...marks, { type: 'italic' }], opts),
      )
    }
    case 'codespan': {
      const t = token as Tokens.Codespan
      return [{ type: 'text', text: t.text, marks: [...marks, { type: 'code' }] }]
    }
    case 'link': {
      const t = token as Tokens.Link
      const linkMark: Mark = { type: 'link', attrs: { href: t.href } }
      return t.tokens.flatMap((nested) => parseInlineToken(nested, [...marks, linkMark], opts))
    }
    case 'image':
      // Images are hoisted to block level by splitParagraphWithImages; an image
      // in a context that cannot split (e.g. a heading) is dropped.
      return []
    case 'br':
      return [{ type: 'hardBreak', ...(marks.length ? { marks } : {}) }]
    default: {
      const text = (token as { text?: string }).text ?? ''
      if (!text) return []
      return [{ type: 'text', text, ...(marks.length ? { marks } : {}) }]
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run test/server/markdown-to-tiptap.test.ts`
Expected: PASS (11 tests). If the task-list expectation fails, inspect `marked.lexer('- [ ] x', {gfm:true})` items — `task`/`checked` live on `Tokens.ListItem`; adjust ONLY the implementation, not the test semantics.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-import/markdown-to-tiptap.ts apps/web/test/server/markdown-to-tiptap.test.ts
git commit -m "feat(web): markdown→tiptap import parser (port of engines MarkdownParser)"
```

---

## Task 4: HTML → Tiptap chain (own turndown instance — NOT the export one)

**Files:**
- Create: `apps/web/src/server/page-import/html-to-tiptap.ts`
- Test: `apps/web/test/server/html-to-tiptap.test.ts`

**CRITICAL:** do NOT reuse `@/server/page-export/html-to-markdown` — it collapses `\n{2,}` → `\n` for export cosmetics, which would merge separate paragraphs when re-parsed as markdown (single newline = soft break). The import chain needs a plain turndown instance.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest'

import { parseHtmlDocument } from '../../src/server/page-import/html-to-tiptap'

describe('parseHtmlDocument', () => {
  it('keeps separate <p> elements as separate paragraphs', () => {
    const { doc } = parseHtmlDocument('<p>Один</p><p>Два</p>', 'f')
    const paras = doc.content.filter((n) => n.type === 'paragraph')
    expect(paras.length).toBe(2)
  })

  it('takes the title from a leading <h1>', () => {
    const { title, doc } = parseHtmlDocument('<h1>Заголовок</h1><p>Тело</p>', 'fallback')
    expect(title).toBe('Заголовок')
    expect(JSON.stringify(doc)).toContain('Тело')
  })

  it('converts lists and inline marks', () => {
    const { doc } = parseHtmlDocument('<ul><li><strong>жирный</strong></li></ul>', 'f')
    expect(doc.content[0]!.type).toBe('bulletList')
    expect(JSON.stringify(doc)).toContain('"type":"bold"')
  })

  it('passes image srcs through the resolver', () => {
    const { doc } = parseHtmlDocument('<p><img src="img/a.png" alt="a"></p>', 'f', {
      resolveImageSrc: () => '/api/files/f9',
    })
    expect(JSON.stringify(doc)).toContain('/api/files/f9')
  })
})
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `pnpm --filter web exec vitest run test/server/html-to-tiptap.test.ts`

- [ ] **Step 3: Implement `apps/web/src/server/page-import/html-to-tiptap.ts`**

```ts
import TurndownService from 'turndown'

import {
  parseMarkdownDocument,
  type ParseOptions,
  type TiptapDoc,
} from './markdown-to-tiptap'

// Plain turndown for the import chain. The export-side htmlToMarkdown collapses
// blank lines (cosmetic for downloads) which would merge paragraphs if its
// output were re-parsed — so imports keep standard markdown spacing.
const td = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
})

export function parseHtmlDocument(
  html: string,
  fallbackTitle: string,
  opts: ParseOptions = {},
): { title: string; doc: TiptapDoc } {
  const markdown = td.turndown(html ?? '')
  return parseMarkdownDocument(markdown, fallbackTitle, opts)
}
```

- [ ] **Step 4: Run tests — expect PASS (4 tests)**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-import/html-to-tiptap.ts apps/web/test/server/html-to-tiptap.test.ts
git commit -m "feat(web): html→tiptap import chain via dedicated turndown instance"
```

---

## Task 5: contentYjs builder (welcome-page pattern)

**Files:**
- Create: `apps/web/src/server/page-import/content-yjs.ts`
- Test: `apps/web/test/server/content-yjs.test.ts`

- [ ] **Step 1: Failing test** — roundtrip through Yjs proves schema-compatibility of every node type the parser emits:

```ts
import { describe, expect, it } from 'vitest'
import { TiptapTransformer } from '@hocuspocus/transformer'
import * as Y from 'yjs'

import { buildImportContentYjs } from '../../src/server/page-import/content-yjs'
import { markdownToTiptap } from '../../src/server/page-import/markdown-to-tiptap'

const FULL_MD = [
  '# H',
  '',
  'Текст **жирный** _курсив_ `код` [ссылка](https://e.com)',
  '',
  '- [ ] задача',
  '- пункт',
  '',
  '1. раз',
  '',
  '> цитата',
  '',
  '```js',
  'x()',
  '```',
  '',
  '---',
  '',
  '![img](https://e.com/i.png)',
].join('\n')

describe('buildImportContentYjs', () => {
  it('encodes every parser-emitted node type and survives a Yjs roundtrip', () => {
    const doc = markdownToTiptap(FULL_MD)
    const bytes = buildImportContentYjs(doc)
    expect(bytes.byteLength).toBeGreaterThan(0)

    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, bytes)
    const roundtripped = TiptapTransformer.fromYdoc(ydoc, 'default') as { type: string }
    expect(roundtripped.type).toBe('doc')
    expect(JSON.stringify(roundtripped)).toContain('задача')
  })
})
```

- [ ] **Step 2: Run — FAIL (module not found)**

- [ ] **Step 3: Implement `apps/web/src/server/page-import/content-yjs.ts`** — same pattern as `packages/trpc/src/helpers/welcome-page-content.ts:85` and engines `page-writer.service.ts:266` (the yjs loader seeds ONLY from contentYjs, so imports must compute it):

```ts
import { TiptapTransformer } from '@hocuspocus/transformer'
import Image from '@tiptap/extension-image'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

// StarterKit v3 covers paragraph/heading/lists/codeBlock/blockquote/hr/hardBreak
// + bold/italic/code/link marks; Image and task lists are separate extensions.
const EXTENSIONS = [StarterKit, Image, TaskList, TaskItem.configure({ nested: true })]

export function buildImportContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
```

- [ ] **Step 4: Run — expect PASS.** If `toYdoc` throws on a node type, the parser emitted something outside the extension set — fix the EXTENSIONS list (not the parser).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-import/content-yjs.ts apps/web/test/server/content-yjs.test.ts
git commit -m "feat(web): contentYjs builder for imported pages"
```

---

## Task 6: ZIP import plan builder (tree mapping + zip-slip guard)

**Files:**
- Create: `apps/web/src/server/page-import/zip-plan.ts`
- Test: `apps/web/test/server/zip-plan.test.ts`

- [ ] **Step 1: Failing tests** (fixtures built in-memory with fflate):

```ts
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { buildImportPlan, ImportSourceError } from '../../src/server/page-import/zip-plan'

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const data: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(files)) data[k] = typeof v === 'string' ? strToU8(v) : v
  return zipSync(data)
}

describe('buildImportPlan', () => {
  it('maps a flat zip to root-level doc nodes', () => {
    const plan = buildImportPlan(zip({ 'a.md': '# A', 'b.html': '<p>B</p>' }))
    expect(plan.roots.map((r) => r.name).sort()).toEqual(['a', 'b'])
    expect(plan.totalPages).toBe(2)
    expect(plan.roots.find((r) => r.name === 'b')!.doc!.format).toBe('html')
  })

  it('maps folders to parent nodes and nests children', () => {
    const plan = buildImportPlan(zip({ 'Proj/notes.md': 'n', 'Proj/Sub/deep.md': 'd' }))
    expect(plan.roots.length).toBe(1)
    const proj = plan.roots[0]!
    expect(proj.name).toBe('Proj')
    expect(proj.doc).toBeNull()
    expect(proj.children.map((c) => c.name).sort()).toEqual(['Sub', 'notes'])
    expect(plan.totalPages).toBe(4)
  })

  it('merges Foo.md onto sibling folder Foo/ (wiki convention)', () => {
    const plan = buildImportPlan(zip({ 'Foo.md': '# Foo body', 'Foo/child.md': 'c' }))
    expect(plan.roots.length).toBe(1)
    const foo = plan.roots[0]!
    expect(foo.name).toBe('Foo')
    expect(foo.doc).not.toBeNull()
    expect(foo.sourceKey).toBe('Foo.md')
    expect(foo.children.map((c) => c.name)).toEqual(['child'])
    expect(plan.totalPages).toBe(2)
  })

  it('collects image assets and warns on unsupported entries', () => {
    const plan = buildImportPlan(
      zip({ 'a.md': 'x', 'img/p.png': new Uint8Array([1]), 'evil.svg': '<svg/>', 'doc.pdf': 'x' }),
    )
    expect(plan.assets.has('img/p.png')).toBe(true)
    expect(plan.warnings.length).toBe(2) // svg + pdf skipped
  })

  it('ignores macOS junk entries', () => {
    const plan = buildImportPlan(
      zip({ '__MACOSX/x.md': 'x', '.DS_Store': 'x', 'real.md': 'r' }),
    )
    expect(plan.totalPages).toBe(1)
    expect(plan.warnings.length).toBe(0)
  })

  it('throws ImportSourceError on zip-slip paths', () => {
    expect(() => buildImportPlan(zip({ '../evil.md': 'x' }))).toThrow(ImportSourceError)
  })
})
```

- [ ] **Step 2: Run — FAIL (module not found)**

Run: `pnpm --filter web exec vitest run test/server/zip-plan.test.ts`

- [ ] **Step 3: Implement `apps/web/src/server/page-import/zip-plan.ts`**

```ts
import { unzipSync } from 'fflate'

/** User-facing import source problems (message is shown as the job error). */
export class ImportSourceError extends Error {}

const DOC_EXTS = new Set(['md', 'markdown', 'html', 'htm'])
// SVG deliberately excluded: /api/files/[id] serves inline with the stored MIME,
// so importable SVG would be a same-origin XSS vector.
const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export type ImportDoc = {
  sourceKey: string
  baseName: string
  format: 'md' | 'html'
  bytes: Uint8Array
}

export type ImportAsset = { sourceKey: string; baseName: string; ext: string; bytes: Uint8Array }

export type ImportNode = {
  /** Folder name or doc filename without extension. */
  name: string
  /** Mapping key: the doc path, or `<dir>/` for doc-less folder nodes. */
  sourceKey: string
  doc: ImportDoc | null
  children: ImportNode[]
}

export type ImportPlan = {
  roots: ImportNode[]
  assets: Map<string, ImportAsset>
  warnings: string[]
  totalPages: number
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
}

function baseNameOf(path: string): string {
  const seg = path.split('/').at(-1) ?? path
  const dot = seg.lastIndexOf('.')
  return dot <= 0 ? seg : seg.slice(0, dot)
}

function dirNameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx < 0 ? '' : path.slice(0, idx)
}

/** Normalize one zip entry path; null = ignore the entry; throws on traversal. */
export function normalizeEntryPath(raw: string): string | null {
  const path = raw.replaceAll('\\', '/').replace(/\/+$/, '')
  if (path === '') return null
  if (path.startsWith('/')) throw new ImportSourceError('Небезопасный путь в архиве')
  const segs = path.split('/')
  if (segs.some((s) => s === '..')) throw new ImportSourceError('Небезопасный путь в архиве')
  if (segs.some((s) => s === '__MACOSX' || s === '.DS_Store' || s.startsWith('._'))) return null
  return segs.filter((s) => s !== '' && s !== '.').join('/')
}

export function buildImportPlan(zipBytes: Uint8Array): ImportPlan {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zipBytes)
  } catch {
    throw new ImportSourceError('Не удалось прочитать ZIP-архив')
  }

  const docs = new Map<string, ImportDoc>()
  const assets = new Map<string, ImportAsset>()
  const warnings: string[] = []
  const dirs = new Set<string>()

  for (const [raw, bytes] of Object.entries(entries)) {
    if (raw.endsWith('/')) continue // directory marker entries
    const path = normalizeEntryPath(raw)
    if (path === null) continue
    for (let d = dirNameOf(path); d !== ''; d = dirNameOf(d)) dirs.add(d)
    const ext = extOf(path)
    if (DOC_EXTS.has(ext)) {
      docs.set(path, {
        sourceKey: path,
        baseName: baseNameOf(path),
        format: ext === 'html' || ext === 'htm' ? 'html' : 'md',
        bytes,
      })
    } else if (ASSET_EXTS.has(ext)) {
      assets.set(path, { sourceKey: path, baseName: baseNameOf(path), ext, bytes })
    } else {
      warnings.push(`Пропущен файл «${path}» — формат не поддерживается`)
    }
  }

  // Build folder nodes for every dir.
  const nodeByDir = new Map<string, ImportNode>()
  for (const dir of dirs) {
    nodeByDir.set(dir, {
      name: dir.split('/').at(-1)!,
      sourceKey: `${dir}/`,
      doc: null,
      children: [],
    })
  }

  // Merge `<dir>.md|html` onto a sibling folder node `<dir>/` (wiki convention).
  const merged = new Set<string>()
  for (const [path, doc] of docs) {
    const candidateDir = dirNameOf(path) === '' ? doc.baseName : `${dirNameOf(path)}/${doc.baseName}`
    const target = nodeByDir.get(candidateDir)
    if (target && target.doc === null) {
      target.doc = doc
      target.sourceKey = path // mapping keys on the doc path
      merged.add(path)
    }
  }

  // Leaf doc nodes.
  const leaves: Array<{ dir: string; node: ImportNode }> = []
  for (const [path, doc] of docs) {
    if (merged.has(path)) continue
    leaves.push({
      dir: dirNameOf(path),
      node: { name: doc.baseName, sourceKey: path, doc, children: [] },
    })
  }

  // Assemble the tree.
  const roots: ImportNode[] = []
  const attach = (dir: string, node: ImportNode) => {
    if (dir === '') roots.push(node)
    else nodeByDir.get(dir)!.children.push(node)
  }
  for (const dir of dirs) attach(dirNameOf(dir), nodeByDir.get(dir)!)
  for (const { dir, node } of leaves) attach(dir, node)

  const sortRec = (nodes: ImportNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  let totalPages = 0
  const count = (nodes: ImportNode[]) => {
    for (const n of nodes) {
      totalPages += 1
      count(n.children)
    }
  }
  count(roots)

  return { roots, assets, warnings, totalPages }
}
```

- [ ] **Step 4: Run — expect PASS (6 tests).** Note the merge test: `Foo.md` + `Foo/` → ONE node with `sourceKey: 'Foo.md'`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-import/zip-plan.ts apps/web/test/server/zip-plan.test.ts
git commit -m "feat(web): zip import plan builder with folder→tree mapping and zip-slip guard"
```

---

## Task 7: Export naming + relative paths (pure helpers)

**Files:**
- Create: `apps/web/src/server/page-export/bulk/naming.ts`
- Test: `apps/web/test/server/export-naming.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest'

import {
  createNameAllocator,
  relativePath,
  safeEntryName,
} from '../../src/server/page-export/bulk/naming'

describe('safeEntryName', () => {
  it('strips filesystem-unsafe characters and trims', () => {
    expect(safeEntryName('  A/B:C*?"<>| ')).toBe('A B C')
  })
  it('falls back for empty titles', () => {
    expect(safeEntryName(null)).toBe('Без названия')
    expect(safeEntryName('///')).toBe('page')
  })
})

describe('createNameAllocator', () => {
  it('dedupes per directory with numeric suffixes, case-insensitively', () => {
    const alloc = createNameAllocator()
    expect(alloc('', 'Page')).toBe('Page')
    expect(alloc('', 'page')).toBe('page 2')
    expect(alloc('dir', 'Page')).toBe('Page')
  })
})

describe('relativePath', () => {
  it('resolves between archive paths', () => {
    expect(relativePath('', 'assets/a.png')).toBe('assets/a.png')
    expect(relativePath('Proj', 'assets/a.png')).toBe('../assets/a.png')
    expect(relativePath('Proj', 'Proj/Sub/x.md')).toBe('Sub/x.md')
    expect(relativePath('A/B', 'C/d.md')).toBe('../../C/d.md')
  })
})
```

- [ ] **Step 2: Run — FAIL.** `pnpm --filter web exec vitest run test/server/export-naming.test.ts`

- [ ] **Step 3: Implement `apps/web/src/server/page-export/bulk/naming.ts`**

```ts
// Mirrors the UNSAFE class in ../filename.ts (kept separate: entry names have no
// extension and need per-directory dedup).
const UNSAFE = new RegExp(
  `[/\\\\:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(31)}]+`,
  'g',
)

export function safeEntryName(rawTitle: string | null | undefined): string {
  const trimmed = (rawTitle ?? '').trim()
  if (!trimmed) return 'Без названия'
  const safe = trimmed.replaceAll(UNSAFE, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 80)
  return safe || 'page'
}

/** Per-directory case-insensitive name dedup: "Page", "page 2", "page 3"… */
export function createNameAllocator(): (dir: string, base: string) => string {
  const used = new Map<string, number>()
  return (dir, base) => {
    const key = `${dir}|${base.toLowerCase()}`
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    return n === 1 ? base : `${base} ${n}`
  }
}

/** Relative path from a directory ('' = archive root) to an archive entry path. */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir === '' ? [] : fromDir.split('/')
  const to = toPath.split('/')
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i += 1
  const ups = from.length - i
  return [...Array.from({ length: ups }, () => '..'), ...to.slice(i)].join('/')
}
```

- [ ] **Step 4: Run — expect PASS (5 tests).**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-export/bulk/naming.ts apps/web/test/server/export-naming.test.ts
git commit -m "feat(web): export archive naming + relative path helpers"
```

---

## Task 8: Import link-rewrite pass (pure)

**Files:**
- Create: `apps/web/src/server/page-import/rewrite-links.ts`
- Test: `apps/web/test/server/rewrite-links.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest'

import { markdownToTiptap } from '../../src/server/page-import/markdown-to-tiptap'
import {
  resolveSourcePath,
  rewriteRelativeLinks,
} from '../../src/server/page-import/rewrite-links'

describe('resolveSourcePath', () => {
  it('resolves ./ and ../ against the source dir', () => {
    expect(resolveSourcePath('a/b', 'c.md')).toBe('a/b/c.md')
    expect(resolveSourcePath('a/b', './c.md')).toBe('a/b/c.md')
    expect(resolveSourcePath('a/b', '../c.md')).toBe('a/c.md')
    expect(resolveSourcePath('', 'c.md')).toBe('c.md')
    expect(resolveSourcePath('a', '../../c.md')).toBeNull()
  })
})

describe('rewriteRelativeLinks', () => {
  const resolve = (abs: string) => (abs === 'Proj/target.md' ? '/pages/p-1' : null)

  it('rewrites relative md links to internal page links', () => {
    const doc = markdownToTiptap('[см](target.md) и [внешн](https://e.com) и [якорь](#x)')
    const { doc: out, changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(true)
    const s = JSON.stringify(out)
    expect(s).toContain('"href":"/pages/p-1"')
    expect(s).toContain('https://e.com')
    expect(s).toContain('"href":"#x"')
  })

  it('decodes URI-encoded hrefs before resolving', () => {
    const doc = markdownToTiptap('[a](target%2Emd)')
    const { changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(true)
  })

  it('reports changed=false when nothing matches', () => {
    const doc = markdownToTiptap('[a](missing.md)')
    const { changed } = rewriteRelativeLinks(doc, { sourceKey: 'Proj/a.md', resolve })
    expect(changed).toBe(false)
  })
})
```

- [ ] **Step 2: Run — FAIL.** `pnpm --filter web exec vitest run test/server/rewrite-links.test.ts`

- [ ] **Step 3: Implement `apps/web/src/server/page-import/rewrite-links.ts`**

```ts
import type { TiptapDoc, TiptapNode } from './markdown-to-tiptap'

/** Resolve a relative href against a source dir; null when it escapes the root. */
export function resolveSourcePath(fromDir: string, href: string): string | null {
  const segs = [...(fromDir ? fromDir.split('/') : []), ...href.split('/')]
  const out: string[] = []
  for (const s of segs) {
    if (s === '' || s === '.') continue
    if (s === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(s)
  }
  return out.length > 0 ? out.join('/') : null
}

function isExternal(href: string): boolean {
  return (
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#') ||
    href.startsWith('/')
  )
}

/**
 * Second import pass: rewrite link marks whose relative href resolves (via the
 * caller's mapping) to an imported page. `resolve` receives the absolute source
 * path (e.g. `Proj/target.md`) and returns the internal href or null.
 */
export function rewriteRelativeLinks(
  doc: TiptapDoc,
  args: { sourceKey: string; resolve: (absoluteSourcePath: string) => string | null },
): { doc: TiptapDoc; changed: boolean } {
  const fromDir = args.sourceKey.includes('/')
    ? args.sourceKey.slice(0, args.sourceKey.lastIndexOf('/'))
    : ''
  let changed = false

  const visit = (node: TiptapNode): TiptapNode => {
    let marks = node.marks
    if (marks) {
      marks = marks.map((m) => {
        if (m.type !== 'link') return m
        const href = typeof m.attrs?.href === 'string' ? m.attrs.href : null
        if (!href || isExternal(href)) return m
        const [path, fragment] = href.split('#', 2)
        let decoded = path ?? ''
        try {
          decoded = decodeURIComponent(decoded)
        } catch {
          // keep raw on malformed escapes
        }
        const abs = resolveSourcePath(fromDir, decoded)
        const target = abs ? args.resolve(abs) : null
        if (!target) return m
        changed = true
        return {
          ...m,
          attrs: { ...m.attrs, href: fragment ? `${target}#${fragment}` : target },
        }
      })
    }
    return {
      ...node,
      ...(marks ? { marks } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    }
  }

  const out: TiptapDoc = { type: 'doc', content: doc.content.map(visit) }
  return { doc: out, changed }
}
```

- [ ] **Step 4: Run — expect PASS (5 tests).**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-import/rewrite-links.ts apps/web/test/server/rewrite-links.test.ts
git commit -m "feat(web): import second-pass relative link rewriting"
```

---

## Task 9: Import job processor (claim → plan → create tree → links → result)

**Files:**
- Create: `apps/web/src/server/jobs/process-import-job.ts`
- Test: `apps/web/test/server/process-import-job.test.ts` (real DB + fake storage; needs `docker compose up -d`)

- [ ] **Step 1: Pre-check the domain type exports**

Run: `grep -rn "CreatePageExtra" packages/domain/src/index.ts packages/domain/src/pages/index.ts`
Expected: the type is re-exported from the root barrel (the dto module exports it and `domain.createPageInput` is already root-visible). If — and only if — tsc later reports it missing from `@repo/domain`, add alongside the existing pages dto re-exports in the same barrel file: `export type { CreatePageExtra } from './pages/dto/pages.dto.ts'` (match the file's existing export style exactly).

- [ ] **Step 2: Implement `apps/web/src/server/jobs/process-import-job.ts`** (implementation first here; the meaningful failing-test loop for processors is the integration test in Step 3, which you may write first if you prefer)

```ts
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'

import { FileStatus, JobStatus, PageType, type Prisma, type PrismaClient } from '@repo/db'
import type { CreatePageExtra, CreatePageInput } from '@repo/domain'
import type { StorageClient } from '@repo/storage'

import { computeS3Key } from '@/lib/file-validation'
import { buildImportContentYjs } from '@/server/page-import/content-yjs'
import { parseHtmlDocument } from '@/server/page-import/html-to-tiptap'
import {
  parseMarkdownDocument,
  type TiptapDoc,
} from '@/server/page-import/markdown-to-tiptap'
import {
  resolveSourcePath,
  rewriteRelativeLinks,
} from '@/server/page-import/rewrite-links'
import {
  buildImportPlan,
  ImportSourceError,
  type ImportNode,
  type ImportPlan,
} from '@/server/page-import/zip-plan'

export type PagesCreatePort = {
  create(actorUserId: string, input: CreatePageInput & CreatePageExtra): Promise<{ id: string }>
}

export type ImportJobContext = {
  prisma: PrismaClient
  storage: Pick<StorageClient, 'get' | 'put'>
  pages: PagesCreatePort
}

type ImportOptions = { location: 'team' | 'private'; parentId: string | null }

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export async function processImportJob(ctx: ImportJobContext, jobId: string): Promise<void> {
  const now = new Date()
  const claimed = await ctx.prisma.importJob.updateMany({
    where: { id: jobId, status: JobStatus.QUEUED },
    data: { status: JobStatus.PROCESSING, startedAt: now, heartbeatAt: now },
  })
  if (claimed.count === 0) return

  try {
    await run(ctx, jobId)
  } catch (err) {
    const message =
      err instanceof ImportSourceError ? err.message : 'Не удалось выполнить импорт'
    console.error('[import-job] failed', { jobId, err })
    await ctx.prisma.importJob
      .update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, error: message, finishedAt: new Date() },
      })
      .catch(() => {})
  }
}

async function run(ctx: ImportJobContext, jobId: string): Promise<void> {
  const job = await ctx.prisma.importJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { artifacts: { include: { file: true } } },
  })
  const source = job.artifacts.find((a) => a.kind === 'SOURCE')?.file
  if (!source) throw new ImportSourceError('Файл импорта не найден')

  const bytes = await streamToBuffer(await ctx.storage.get(source.path))
  const options = parseOptions(job.options)

  const plan: ImportPlan =
    job.format === 'ZIP'
      ? buildImportPlan(bytes)
      : singleFilePlan(job.format, source.name, bytes)

  // Idempotent resume: already-created entries are skipped via their mapping.
  const existing = await ctx.prisma.importMapping.findMany({
    where: { jobId },
    select: { sourceKey: true, pageId: true },
  })
  const mapped = new Map(existing.map((m) => [m.sourceKey, m.pageId]))

  await ctx.prisma.importJob.update({
    where: { id: jobId },
    data: { total: plan.totalPages, processed: mapped.size, heartbeatAt: new Date() },
  })

  const warnings = [...plan.warnings]
  const assetFileIds = await storeAssets(ctx, job, plan, warnings)

  const rootPageIds: string[] = []
  for (const node of plan.roots) {
    const id = await createNode(ctx, job, options, node, options.parentId, mapped, assetFileIds)
    rootPageIds.push(id)
  }

  await rewriteImportedLinks(ctx, job.workspaceId, jobId, plan, mapped)

  await ctx.prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: JobStatus.DONE,
      finishedAt: new Date(),
      processed: plan.totalPages,
      result: {
        pagesCreated: mapped.size,
        rootPageIds,
        warnings,
      } as Prisma.InputJsonValue,
    },
  })
}

async function createNode(
  ctx: ImportJobContext,
  job: { id: string; userId: string; workspaceId: string },
  options: ImportOptions,
  node: ImportNode,
  parentPageId: string | null,
  mapped: Map<string, string>,
  assetFileIds: Map<string, string>,
): Promise<string> {
  let pageId = mapped.get(node.sourceKey)
  if (!pageId) {
    const usedFileIds: string[] = []
    let title = node.name
    let doc: TiptapDoc = { type: 'doc', content: [] }
    if (node.doc) {
      const docDir = node.doc.sourceKey.includes('/')
        ? node.doc.sourceKey.slice(0, node.doc.sourceKey.lastIndexOf('/'))
        : ''
      const resolveImageSrc = (src: string): string | null => {
        let decoded = src.split('#', 2)[0] ?? ''
        try {
          decoded = decodeURIComponent(decoded)
        } catch {
          // keep raw on malformed escapes
        }
        const abs = resolveSourcePath(docDir, decoded)
        const fileId = abs ? assetFileIds.get(abs) : undefined
        if (!fileId) return null
        usedFileIds.push(fileId)
        return `/api/files/${fileId}`
      }
      const text = new TextDecoder('utf-8').decode(node.doc.bytes)
      const parsed =
        node.doc.format === 'html'
          ? parseHtmlDocument(text, node.name, { resolveImageSrc })
          : parseMarkdownDocument(text, node.name, { resolveImageSrc })
      title = parsed.title
      doc = parsed.doc
    }

    const created = await ctx.pages.create(job.userId, {
      workspaceId: job.workspaceId,
      parentId: parentPageId,
      title,
      type: PageType.TEXT,
      ...(parentPageId === null ? { location: options.location } : {}),
      content: doc as unknown as Prisma.InputJsonValue,
      contentYjs: buildImportContentYjs(doc),
    })
    pageId = created.id

    if (usedFileIds.length > 0) {
      await ctx.prisma.pageFile.createMany({
        data: [...new Set(usedFileIds)].map((fileId) => ({ pageId: pageId!, fileId })),
        skipDuplicates: true,
      })
    }
    await ctx.prisma.importMapping.create({
      data: { jobId: job.id, sourceKey: node.sourceKey, pageId },
    })
    mapped.set(node.sourceKey, pageId)
    await ctx.prisma.importJob.update({
      where: { id: job.id },
      data: { processed: { increment: 1 }, heartbeatAt: new Date() },
    })
  }

  for (const child of node.children) {
    await createNode(ctx, job, options, child, pageId, mapped, assetFileIds)
  }
  return pageId
}

// Upload referenced image assets (content-hash dedup like the upload route).
// Over-quota assets are skipped with a warning rather than failing the import.
async function storeAssets(
  ctx: ImportJobContext,
  job: { userId: string; workspaceId: string },
  plan: ImportPlan,
  warnings: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (plan.assets.size === 0) return out

  const totalBytes = [...plan.assets.values()].reduce((s, a) => s + a.bytes.byteLength, 0)
  const [usage, limits] = await Promise.all([
    ctx.prisma.file.aggregate({
      where: { workspaceId: job.workspaceId, status: FileStatus.ACTIVE },
      _sum: { fileSize: true },
    }),
    ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: job.workspaceId } }),
  ])
  const used = usage._sum.fileSize ?? 0n
  if (limits && used + BigInt(totalBytes) > limits.maxFileBytes) {
    warnings.push('Картинки из архива пропущены: превышен лимит хранилища пространства')
    return out
  }

  for (const [sourceKey, asset] of plan.assets) {
    const buf = Buffer.from(asset.bytes)
    const hash = createHash('sha256').update(buf).digest('hex')
    const s3Key = computeS3Key(hash, asset.ext)
    const existing = await ctx.prisma.file.findFirst({
      where: {
        userId: job.userId,
        hash,
        workspaceId: job.workspaceId,
        status: FileStatus.ACTIVE,
      },
      select: { id: true },
    })
    if (existing) {
      out.set(sourceKey, existing.id)
      continue
    }
    await ctx.storage.put(s3Key, buf, {
      contentType: MIME_BY_EXT[asset.ext] ?? 'application/octet-stream',
      size: buf.byteLength,
    })
    const created = await ctx.prisma.file.create({
      data: {
        userId: job.userId,
        workspaceId: job.workspaceId,
        name: `${asset.baseName}.${asset.ext}`,
        ext: asset.ext,
        fileSize: BigInt(buf.byteLength),
        mimeType: MIME_BY_EXT[asset.ext] ?? 'application/octet-stream',
        hash,
        path: s3Key,
        status: FileStatus.ACTIVE,
        isPublic: false,
      },
      select: { id: true },
    })
    out.set(sourceKey, created.id)
  }
  return out
}

// Second pass: relative inter-file links → /pages/<id>; re-saves content+contentYjs
// and re-enqueues indexing for changed pages only.
async function rewriteImportedLinks(
  ctx: ImportJobContext,
  workspaceId: string,
  jobId: string,
  plan: ImportPlan,
  mapped: Map<string, string>,
): Promise<void> {
  const resolve = (abs: string): string | null => {
    const id = mapped.get(abs) ?? mapped.get(`${abs}/`) ?? mapped.get(`${abs}.md`)
    return id ? `/pages/${id}` : null
  }
  const docNodes: ImportNode[] = []
  const collect = (nodes: ImportNode[]) => {
    for (const n of nodes) {
      if (n.doc) docNodes.push(n)
      collect(n.children)
    }
  }
  collect(plan.roots)

  for (const node of docNodes) {
    const pageId = mapped.get(node.sourceKey)
    if (!pageId) continue
    const page = await ctx.prisma.page.findUnique({
      where: { id: pageId },
      select: { content: true },
    })
    if (!page?.content) continue
    const { doc, changed } = rewriteRelativeLinks(page.content as unknown as TiptapDoc, {
      sourceKey: node.sourceKey,
      resolve,
    })
    if (!changed) continue
    await ctx.prisma.page.update({
      where: { id: pageId },
      data: {
        content: doc as unknown as Prisma.InputJsonValue,
        contentYjs: buildImportContentYjs(doc),
      },
    })
    await ctx.prisma.outboxEvent.create({
      data: {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: pageId,
        workspaceId,
      },
    })
  }
}

function singleFilePlan(
  format: 'MARKDOWN' | 'HTML',
  fileName: string,
  bytes: Uint8Array,
): ImportPlan {
  const baseName = fileName.replace(/\.[^.]+$/, '') || fileName
  return {
    roots: [
      {
        name: baseName,
        sourceKey: fileName,
        doc: {
          sourceKey: fileName,
          baseName,
          format: format === 'HTML' ? 'html' : 'md',
          bytes,
        },
        children: [],
      },
    ],
    assets: new Map(),
    warnings: [],
    totalPages: 1,
  }
}

function parseOptions(raw: unknown): ImportOptions {
  const o = (raw ?? {}) as Record<string, unknown>
  return {
    location: o.location === 'private' ? 'private' : 'team',
    parentId: typeof o.parentId === 'string' ? o.parentId : null,
  }
}

export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
```

- [ ] **Step 3: Write the integration test `apps/web/test/server/process-import-job.test.ts`**

```ts
import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { prisma } from '@repo/db'

import { domain } from '@/lib/domain'
import {
  processImportJob,
  streamToBuffer,
  type ImportJobContext,
} from '@/server/jobs/process-import-job'

const EMAIL_SUFFIX = '+import-job-test@anynote.dev'

function makeFakeStorage(initial: Record<string, Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial))
  return {
    store,
    async get(key: string): Promise<Readable> {
      const buf = store.get(key)
      if (!buf) throw new Error(`missing ${key}`)
      return Readable.from([buf])
    },
    async put(key: string, body: Readable | Buffer): Promise<void> {
      store.set(key, Buffer.isBuffer(body) ? body : await streamToBuffer(body))
    },
  }
}

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.importJob.deleteMany({ where })
  await prisma.pageFile.deleteMany({ where: { page: where } })
  await prisma.outboxEvent.deleteMany({
    where: { workspaceId: { in: (await prisma.workspace.findMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } }, select: { id: true } })).map((w) => w.id) } },
  })
  await prisma.page.deleteMany({ where })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspaceLimit.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

const ZIP_FIXTURE = () =>
  zipSync({
    'Проект.md': strToU8('# Проект\n\nСм. [план](Проект/План.md).\n\n![схема](Проект/img/схема.png)\n'),
    'Проект/План.md': strToU8('# План\n\n- [ ] пункт\n'),
    'Проект/img/схема.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  })

async function seed(zipBytes: Uint8Array) {
  const user = await prisma.user.create({
    data: {
      email: `owner${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: 'owner',
      firstName: 'O',
      lastName: 'T',
    },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ImportWS', createdById: user.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' },
  })
  await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  await prisma.workspaceLimit.create({
    data: { workspaceId: ws.id, maxMembers: 100, maxFileBytes: 10n ** 12n, syncedAt: new Date() },
  })
  const sourceFile = await prisma.file.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      name: 'sample.zip',
      ext: 'zip',
      fileSize: BigInt(zipBytes.byteLength),
      mimeType: 'application/zip',
      hash: 'test-source-hash',
      path: 'test/source.zip',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const job = await prisma.importJob.create({
    data: {
      workspaceId: ws.id,
      userId: user.id,
      format: 'ZIP',
      options: { location: 'team', parentId: null },
      artifacts: { create: { fileId: sourceFile.id, kind: 'SOURCE' } },
    },
  })
  const storage = makeFakeStorage({ 'test/source.zip': Buffer.from(zipBytes) })
  const ctx: ImportJobContext = { prisma, storage, pages: domain.pages }
  return { user, ws, job, storage, ctx }
}

describe('processImportJob', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('imports a zip into a nested page tree with mappings, assets and rewritten links', async () => {
    const { ws, job, ctx } = await seed(ZIP_FIXTURE())
    await processImportJob(ctx, job.id)

    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
    expect(done.total).toBe(2)
    expect(done.processed).toBe(2)

    const root = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, title: 'Проект' },
    })
    const child = await prisma.page.findFirstOrThrow({
      where: { workspaceId: ws.id, title: 'План' },
    })
    expect(root.parentId).toBeNull()
    expect(child.parentId).toBe(root.id)
    expect(root.contentYjs?.byteLength ?? 0).toBeGreaterThan(0)

    // Asset uploaded + linked + src rewritten.
    const asset = await prisma.file.findFirstOrThrow({
      where: { workspaceId: ws.id, ext: 'png' },
    })
    const link = await prisma.pageFile.findFirst({
      where: { pageId: root.id, fileId: asset.id },
    })
    expect(link).not.toBeNull()
    const rootContent = JSON.stringify(root.content)
    expect(rootContent).toContain(`/api/files/${asset.id}`)
    // Relative inter-file link rewritten to the created page.
    expect(rootContent).toContain(`/pages/${child.id}`)

    const mappings = await prisma.importMapping.findMany({ where: { jobId: job.id } })
    expect(mappings.length).toBe(2)
    expect((done.result as { rootPageIds: string[] }).rootPageIds).toEqual([root.id])
  })

  it('is idempotent on re-run (orphan reclaim path creates no duplicates)', async () => {
    const { ws, job, ctx } = await seed(ZIP_FIXTURE())
    await processImportJob(ctx, job.id)
    const countAfterFirst = await prisma.page.count({ where: { workspaceId: ws.id } })

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', heartbeatAt: null },
    })
    await processImportJob(ctx, job.id)

    const countAfterSecond = await prisma.page.count({ where: { workspaceId: ws.id } })
    expect(countAfterSecond).toBe(countAfterFirst)
    const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(done.status).toBe('DONE')
  })

  it('fails with a user-facing error on zip-slip archives', async () => {
    const evil = zipSync({ '../evil.md': strToU8('x') })
    const { job, ctx } = await seed(evil)
    await processImportJob(ctx, job.id)
    const failed = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toBe('Небезопасный путь в архиве')
  })
})
```

- [ ] **Step 4: Run**

Run: `pnpm --filter web exec vitest run test/server/process-import-job.test.ts`
Expected: PASS (3 tests). Common failure: the `Проект.md`+`Проект/` merge means the ZIP creates exactly 2 pages — if you see 3, the zip-plan merge from Task 6 is broken, fix THERE.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/jobs/process-import-job.ts apps/web/test/server/process-import-job.test.ts
git commit -m "feat(web): import job processor with idempotent resume and asset upload"
```

---

## Task 10: Export page-set collector (the security boundary)

**Files:**
- Create: `apps/web/src/server/page-export/bulk/collect-pages.ts`
- Test: `apps/web/test/server/collect-export-pages.test.ts` (real DB)

- [ ] **Step 1: Write the failing test** — this is the leak test every prior phase's reviewer would ask for:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { collectExportPages } from '@/server/page-export/bulk/collect-pages'

const EMAIL_SUFFIX = '+export-collect-test@anynote.dev'

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.page.deleteMany({ where })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed() {
  const owner = await prisma.user.create({
    data: { email: `owner${EMAIL_SUFFIX}`, emailVerified: true, name: 'o', firstName: 'O', lastName: 'T' },
  })
  const other = await prisma.user.create({
    data: { email: `other${EMAIL_SUFFIX}`, emailVerified: true, name: 'x', firstName: 'X', lastName: 'T' },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ExpWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: other.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  const otherPersonal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: other.id },
  })
  const mk = (data: Record<string, unknown>) =>
    prisma.page.create({
      data: { workspaceId: ws.id, type: 'TEXT', createdById: owner.id, ...data } as never,
    })
  const teamPage = await mk({ title: 'Team', collectionId: team.id })
  const foreignPersonal = await mk({
    title: 'Secret',
    collectionId: otherPersonal.id,
    createdById: other.id,
  })
  const archived = await mk({ title: 'Archived', collectionId: team.id, archivedAt: new Date() })
  const trashed = await mk({ title: 'Trashed', collectionId: team.id, deletedAt: new Date() })
  const dbPage = await prisma.page.create({
    data: { workspaceId: ws.id, type: 'DATABASE', title: 'DB', collectionId: team.id, createdById: owner.id },
  })
  const dbRow = await mk({ title: 'Row', parentId: dbPage.id, collectionId: team.id })
  // Subtree pruning: a child inside the other user's personal collection.
  const child = await mk({ title: 'Child', parentId: teamPage.id, collectionId: team.id })
  const hiddenChild = await mk({
    title: 'HiddenChild',
    parentId: teamPage.id,
    collectionId: otherPersonal.id,
    createdById: other.id,
  })
  const grandUnderHidden = await mk({
    title: 'GrandUnderHidden',
    parentId: hiddenChild.id,
    collectionId: team.id,
  })
  return { owner, ws, teamPage, foreignPersonal, archived, trashed, dbPage, dbRow, child, hiddenChild, grandUnderHidden }
}

describe('collectExportPages', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('workspace scope excludes foreign personal, archived, trashed and database-row pages', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'WORKSPACE',
      scopeId: null,
    })
    const titles = pages.map((p) => p.title)
    expect(titles).toContain('Team')
    expect(titles).toContain('DB') // the DATABASE page itself is exportable
    expect(titles).not.toContain('Secret')
    expect(titles).not.toContain('Archived')
    expect(titles).not.toContain('Trashed')
    expect(titles).not.toContain('Row') // db row pages never enter generic exports
  })

  it('subtree scope prunes the whole branch under an inaccessible page', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'SUBTREE',
      scopeId: f.teamPage.id,
    })
    const titles = pages.map((p) => p.title)
    expect(titles).toEqual(expect.arrayContaining(['Team', 'Child']))
    expect(titles).not.toContain('HiddenChild')
    // The grandchild is itself team-visible, but its parent branch is hidden — pruned.
    expect(titles).not.toContain('GrandUnderHidden')
  })

  it('collection scope returns only that collection', async () => {
    const f = await seed()
    const pages = await collectExportPages(prisma, {
      userId: f.owner.id,
      workspaceId: f.ws.id,
      scope: 'COLLECTION',
      scopeId: (await prisma.collection.findFirstOrThrow({ where: { workspaceId: f.ws.id, kind: 'TEAM' } })).id,
    })
    expect(pages.map((p) => p.title)).not.toContain('Secret')
  })
})
```

- [ ] **Step 2: Run — FAIL (module not found).** `pnpm --filter web exec vitest run test/server/collect-export-pages.test.ts`

- [ ] **Step 3: Implement `apps/web/src/server/page-export/bulk/collect-pages.ts`**

```ts
import type { PageType, Prisma, PrismaClient } from '@repo/db'
import { buildPageVisibilityWhere, excludeDatabaseRowPages } from '@repo/domain'

export type ExportScope = 'WORKSPACE' | 'COLLECTION' | 'SUBTREE'

export type ExportPageRecord = {
  id: string
  parentId: string | null
  title: string | null
  icon: string | null
  type: PageType
  content: unknown
}

const SELECT = {
  id: true,
  parentId: true,
  title: true,
  icon: true,
  type: true,
  content: true,
} as const

/**
 * The export security boundary: canonical visibility predicate + db-row
 * exclusion + no trash/no archive, bounded by scope. A subtree branch under an
 * inaccessible page is pruned entirely (BFS only descends through visible nodes).
 */
export async function collectExportPages(
  prisma: PrismaClient,
  args: { userId: string; workspaceId: string; scope: ExportScope; scopeId: string | null },
): Promise<ExportPageRecord[]> {
  const base: Prisma.PageWhereInput = {
    workspaceId: args.workspaceId,
    deletedAt: null,
    archivedAt: null,
    AND: [buildPageVisibilityWhere(args.userId), excludeDatabaseRowPages()],
  }

  if (args.scope === 'WORKSPACE') {
    return prisma.page.findMany({ where: base, select: SELECT })
  }
  if (args.scope === 'COLLECTION') {
    return prisma.page.findMany({
      where: { ...base, collectionId: args.scopeId },
      select: SELECT,
    })
  }

  const root = await prisma.page.findFirst({
    where: { ...base, id: args.scopeId ?? '' },
    select: SELECT,
  })
  if (!root) return []
  const out: ExportPageRecord[] = [root]
  let frontier = [root.id]
  while (frontier.length > 0) {
    const children = await prisma.page.findMany({
      where: { ...base, parentId: { in: frontier } },
      select: SELECT,
    })
    out.push(...children)
    frontier = children.map((c) => c.id)
  }
  return out
}
```

- [ ] **Step 4: Run — expect PASS (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/page-export/bulk/collect-pages.ts apps/web/test/server/collect-export-pages.test.ts
git commit -m "feat(web): export page-set collector with canonical visibility filtering"
```

---

## Task 11: Archive HTML rewriting + database table rendering (pure)

**Files:**
- Modify: `apps/web/src/server/page-export/embed-images.ts` (add `export` to `extractFileId` only — no behavior change)
- Create: `apps/web/src/server/page-export/bulk/rewrite-archive-html.ts`
- Create: `apps/web/src/server/page-export/bulk/database-table.ts`
- Test: `apps/web/test/server/rewrite-archive-html.test.ts`, `apps/web/test/server/database-table.test.ts`

- [ ] **Step 1: Failing tests**

`apps/web/test/server/rewrite-archive-html.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { rewriteHtmlForArchive } from '@/server/page-export/bulk/rewrite-archive-html'

const FID = '11111111-1111-1111-1111-111111111111'
const PID = '22222222-2222-2222-2222-222222222222'

const ctx = {
  fromDir: 'Proj',
  baseUrl: 'https://app.test',
  assetPathFor: (id: string) => (id === FID ? `assets/${FID}.png` : null),
  pagePathFor: (id: string) => (id === PID ? 'Proj/Target.md' : null),
}

describe('rewriteHtmlForArchive', () => {
  it('rewrites bundled image srcs to relative asset paths and records fileIds', () => {
    const { html, fileIds } = rewriteHtmlForArchive(`<img src="/api/files/${FID}">`, ctx)
    expect(html).toContain(`src="../assets/${FID}.png"`)
    expect(fileIds).toEqual([FID])
  })

  it('rewrites included page links to relative paths and others to absolute', () => {
    const { html } = rewriteHtmlForArchive(
      `<a href="/pages/${PID}">in</a><a href="/pages/33333333-3333-3333-3333-333333333333">out</a>`,
      ctx,
    )
    expect(html).toContain('href="Target.md"')
    expect(html).toContain('href="https://app.test/pages/33333333-3333-3333-3333-333333333333"')
  })

  it('makes file-attachment links absolute', () => {
    const { html } = rewriteHtmlForArchive(`<a href="/api/files/${FID}/x">f</a>`, ctx)
    expect(html).toContain('href="https://app.test/api/files/')
  })
})
```

`apps/web/test/server/database-table.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  buildDatabaseTableHtml,
  buildDatabaseTableMarkdown,
  stringifyCellValue,
} from '@/server/page-export/bulk/database-table'

describe('stringifyCellValue', () => {
  it('handles primitives, arrays and labelled objects', () => {
    expect(stringifyCellValue(null)).toBe('')
    expect(stringifyCellValue(42)).toBe('42')
    expect(stringifyCellValue(['a', 'b'])).toBe('a, b')
    expect(stringifyCellValue({ label: 'Готово' })).toBe('Готово')
    expect(stringifyCellValue({ name: 'Иван' })).toBe('Иван')
  })
})

describe('buildDatabaseTableMarkdown', () => {
  it('renders a header + rows and escapes pipes', () => {
    const md = buildDatabaseTableMarkdown(
      [{ id: 'p1', name: 'Статус' }],
      [{ title: 'A|B', cells: { p1: 'X' } }],
    )
    expect(md).toContain('| Название | Статус |')
    expect(md).toContain('| A\\|B | X |')
  })
})

describe('buildDatabaseTableHtml', () => {
  it('escapes html in values', () => {
    const html = buildDatabaseTableHtml(
      [{ id: 'p1', name: '<b>' }],
      [{ title: '<i>', cells: { p1: '<u>' } }],
    )
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})
```

- [ ] **Step 2: Run both — FAIL.**

- [ ] **Step 3: Export `extractFileId` from `embed-images.ts`** — change `function extractFileId(` to `export function extractFileId(` (line ~17). Nothing else.

- [ ] **Step 4: Implement `rewrite-archive-html.ts`**

```ts
import { parseHTML } from 'linkedom'

import { extractFileId } from '../embed-images'
import { relativePath } from './naming'

const FILE_PATH_PREFIX = '/api/files/'
const PAGE_ID_RE = /\/pages\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function extractPageIdFromHref(href: string): string | null {
  if (!href.startsWith('/pages/') && !href.startsWith('/workspaces/')) return null
  return PAGE_ID_RE.exec(href)?.[1] ?? null
}

/**
 * Bulk-export variant of embed-images: instead of base64-inlining, bundled
 * images point at relative archive asset paths; links to exported pages become
 * relative file paths; everything else becomes absolute.
 */
export function rewriteHtmlForArchive(
  html: string,
  ctx: {
    fromDir: string
    baseUrl: string
    assetPathFor: (fileId: string) => string | null
    pagePathFor: (pageId: string) => string | null
  },
): { html: string; fileIds: string[] } {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)
  const fileIds: string[] = []

  for (const el of Array.from(document.querySelectorAll('img'))) {
    const src = el.getAttribute('src') ?? ''
    const fileId = extractFileId(src)
    if (!fileId) continue
    const archivePath = ctx.assetPathFor(fileId)
    if (archivePath) {
      fileIds.push(fileId)
      el.setAttribute('src', relativePath(ctx.fromDir, archivePath))
    } else {
      el.setAttribute('src', `${ctx.baseUrl}${src}`)
    }
  }

  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? ''
    const pageId = extractPageIdFromHref(href)
    if (pageId) {
      const target = ctx.pagePathFor(pageId)
      a.setAttribute(
        'href',
        target ? relativePath(ctx.fromDir, target) : `${ctx.baseUrl}${href}`,
      )
      continue
    }
    if (href.startsWith(FILE_PATH_PREFIX)) {
      a.setAttribute('href', `${ctx.baseUrl}${href}`)
    }
  }

  for (const div of Array.from(document.querySelectorAll('[data-type="file-attachment"]'))) {
    const url = div.getAttribute('data-url') ?? ''
    if (url.startsWith(FILE_PATH_PREFIX)) {
      div.setAttribute('data-url', `${ctx.baseUrl}${url}`)
    }
  }

  return { html: document.body.innerHTML, fileIds }
}
```

- [ ] **Step 5: Implement `database-table.ts`**

```ts
export type DbTableProperty = { id: string; name: string }
export type DbTableRow = { title: string | null; cells: Record<string, unknown> }

export function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(stringifyCellValue).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.label === 'string') return o.label
    if (typeof o.name === 'string') return o.name
    if (typeof o.title === 'string') return o.title
    return JSON.stringify(value)
  }
  return String(value)
}

const escapeMd = (s: string) => s.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function buildDatabaseTableMarkdown(
  props: DbTableProperty[],
  rows: DbTableRow[],
): string {
  const header = `| Название |${props.map((p) => ` ${escapeMd(p.name)} |`).join('')}`
  const sep = `| --- |${props.map(() => ' --- |').join('')}`
  const lines = rows.map(
    (r) =>
      `| ${escapeMd(r.title ?? '')} |${props
        .map((p) => ` ${escapeMd(stringifyCellValue(r.cells[p.id]))} |`)
        .join('')}`,
  )
  return [header, sep, ...lines].join('\n') + '\n'
}

export function buildDatabaseTableHtml(props: DbTableProperty[], rows: DbTableRow[]): string {
  const head = `<tr><th>Название</th>${props
    .map((p) => `<th>${escapeHtml(p.name)}</th>`)
    .join('')}</tr>`
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.title ?? '')}</td>${props
          .map((p) => `<td>${escapeHtml(stringifyCellValue(r.cells[p.id]))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  return `<table>${head}${body}</table>`
}
```

- [ ] **Step 6: Run both test files — expect PASS (3 + 3 tests).**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/server/page-export/embed-images.ts apps/web/src/server/page-export/bulk/rewrite-archive-html.ts apps/web/src/server/page-export/bulk/database-table.ts apps/web/test/server/rewrite-archive-html.test.ts apps/web/test/server/database-table.test.ts
git commit -m "feat(web): archive html rewriting + database table rendering for bulk export"
```

---

## Task 12: Export job processor

**Files:**
- Create: `apps/web/src/server/jobs/process-export-job.ts`
- Test: `apps/web/test/server/process-export-job.test.ts` (real DB + fake storage)

- [ ] **Step 1: Implement `apps/web/src/server/jobs/process-export-job.ts`**

```ts
import { createHash } from 'node:crypto'

import { FileStatus, JobStatus, PageType, type PrismaClient } from '@repo/db'
import type { StorageClient } from '@repo/storage'
import { strToU8, zipSync } from 'fflate'

import { htmlToMarkdown } from '@/server/page-export/html-to-markdown'
import { tiptapJsonToHtml } from '@/server/page-export/tiptap-to-html'
import { wrapHtmlDocument } from '@/server/page-export/wrap-html-document'
import {
  collectExportPages,
  type ExportPageRecord,
  type ExportScope,
} from '@/server/page-export/bulk/collect-pages'
import {
  buildDatabaseTableHtml,
  buildDatabaseTableMarkdown,
} from '@/server/page-export/bulk/database-table'
import { createNameAllocator, safeEntryName } from '@/server/page-export/bulk/naming'
import { rewriteHtmlForArchive } from '@/server/page-export/bulk/rewrite-archive-html'
import { streamToBuffer } from './process-import-job'

export const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type ExportDatabasePort = {
  listProperties(
    actorUserId: string,
    pageId: string,
  ): Promise<Array<{ id: string; name: string }>>
  listRows(
    actorUserId: string,
    input: { pageId: string; limit: number; cursor?: string },
  ): Promise<{
    rows: Array<{ title: string | null; cells: Record<string, unknown> }>
    nextCursor: string | null
  }>
}

export type ExportJobContext = {
  prisma: PrismaClient
  storage: Pick<StorageClient, 'get' | 'put'>
  database: ExportDatabasePort
  baseUrl: string
}

class ExportSourceError extends Error {}

export async function processExportJob(ctx: ExportJobContext, jobId: string): Promise<void> {
  const now = new Date()
  const claimed = await ctx.prisma.exportJob.updateMany({
    where: { id: jobId, status: JobStatus.QUEUED },
    data: { status: JobStatus.PROCESSING, startedAt: now, heartbeatAt: now },
  })
  if (claimed.count === 0) return

  try {
    await run(ctx, jobId)
  } catch (err) {
    const message =
      err instanceof ExportSourceError ? err.message : 'Не удалось выполнить экспорт'
    console.error('[export-job] failed', { jobId, err })
    await ctx.prisma.exportJob
      .update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED, error: message, finishedAt: new Date() },
      })
      .catch(() => {})
  }
}

type Placed = { rec: ExportPageRecord; filePath: string; dir: string }

async function run(ctx: ExportJobContext, jobId: string): Promise<void> {
  const job = await ctx.prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } })
  const isMd = job.format === 'MARKDOWN_ZIP'
  const ext = isMd ? 'md' : 'html'

  const pages = await collectExportPages(ctx.prisma, {
    userId: job.userId,
    workspaceId: job.workspaceId,
    scope: job.scope as ExportScope,
    scopeId: job.scopeId,
  })
  if (pages.length === 0) {
    throw new ExportSourceError('Нет доступных страниц для экспорта')
  }
  await ctx.prisma.exportJob.update({
    where: { id: jobId },
    data: { total: pages.length, heartbeatAt: new Date() },
  })

  // ── Layout: Notion-style Title.ext + Title/ folder when there are children ──
  const inSet = new Set(pages.map((p) => p.id))
  const childrenOf = new Map<string, ExportPageRecord[]>()
  const roots: ExportPageRecord[] = []
  for (const p of pages) {
    if (p.parentId && inSet.has(p.parentId)) {
      const list = childrenOf.get(p.parentId) ?? []
      list.push(p)
      childrenOf.set(p.parentId, list)
    } else {
      roots.push(p)
    }
  }
  const alloc = createNameAllocator()
  const placed = new Map<string, Placed>()
  const walk = (rec: ExportPageRecord, dir: string) => {
    const base = alloc(dir, safeEntryName(rec.title))
    const filePath = dir ? `${dir}/${base}.${ext}` : `${base}.${ext}`
    placed.set(rec.id, { rec, filePath, dir })
    const kids = childrenOf.get(rec.id) ?? []
    if (kids.length > 0) {
      const childDir = dir ? `${dir}/${base}` : base
      for (const k of kids) walk(k, childDir)
    }
  }
  for (const r of roots) walk(r, '')

  // ── Pre-resolve bundled assets: every /api/files/<id> referenced by any page ──
  const rawHtmlById = new Map<string, string>()
  const referencedIds = new Set<string>()
  const FILE_ID_RE = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  for (const p of pages) {
    if (p.type !== PageType.TEXT) continue
    const raw = tiptapJsonToHtml(p.content)
    rawHtmlById.set(p.id, raw)
    for (const m of raw.matchAll(FILE_ID_RE)) referencedIds.add(m[1]!.toLowerCase())
  }
  const assetFiles = referencedIds.size
    ? await ctx.prisma.file.findMany({
        where: { id: { in: [...referencedIds] }, status: FileStatus.ACTIVE },
        select: { id: true, path: true, ext: true },
      })
    : []
  const assetPaths = new Map(
    assetFiles.map((f) => [f.id, `assets/${f.id}.${f.ext || 'bin'}`] as const),
  )

  // ── Render entries ──
  const entries: Record<string, Uint8Array> = {}
  for (const { rec, filePath, dir } of placed.values()) {
    const title = (rec.title ?? '').trim() || 'Без названия'
    let content: string
    if (rec.type === PageType.TEXT) {
      const { html: body } = rewriteHtmlForArchive(rawHtmlById.get(rec.id) ?? '', {
        fromDir: dir,
        baseUrl: ctx.baseUrl,
        assetPathFor: (id) => assetPaths.get(id) ?? null,
        pagePathFor: (id) => placed.get(id)?.filePath ?? null,
      })
      content = isMd
        ? `# ${title}\n\n${htmlToMarkdown(body)}`
        : wrapHtmlDocument({ bodyHtml: body, title, icon: rec.icon })
    } else if (rec.type === PageType.DATABASE) {
      content = await renderDatabasePage(ctx, job.userId, rec, title, isMd)
    } else {
      const note = `Тип страницы «${rec.type}» не входит в экспорт этой версии.`
      content = isMd
        ? `# ${title}\n\n> ${note}\n`
        : wrapHtmlDocument({ bodyHtml: `<p>${note}</p>`, title, icon: rec.icon })
    }
    entries[filePath] = strToU8(content)
    await ctx.prisma.exportJob.update({
      where: { id: jobId },
      data: { processed: { increment: 1 }, heartbeatAt: new Date() },
    })
  }

  // ── Bundle assets ──
  for (const f of assetFiles) {
    try {
      const buf = await streamToBuffer(await ctx.storage.get(f.path))
      entries[assetPaths.get(f.id)!] = new Uint8Array(buf)
    } catch (err) {
      console.warn('[export-job] asset fetch failed, skipping', { fileId: f.id, err })
    }
  }

  // ── Store the artifact ──
  const zipBytes = zipSync(entries)
  const key = `exports/${jobId}.zip`
  const buf = Buffer.from(zipBytes)
  await ctx.storage.put(key, buf, { contentType: 'application/zip', size: buf.byteLength })
  const hash = createHash('sha256').update(buf).digest('hex')
  const file = await ctx.prisma.file.create({
    data: {
      userId: job.userId,
      workspaceId: job.workspaceId,
      name: 'anynote-export',
      ext: 'zip',
      fileSize: BigInt(buf.byteLength),
      mimeType: 'application/zip',
      hash,
      path: key,
      status: FileStatus.ACTIVE,
      isPublic: false,
      expiresAt: new Date(Date.now() + ARTIFACT_TTL_MS),
    },
    select: { id: true },
  })
  await ctx.prisma.exportArtifact.create({ data: { jobId, fileId: file.id } })
  await ctx.prisma.exportJob.update({
    where: { id: jobId },
    data: { status: JobStatus.DONE, finishedAt: new Date(), processed: pages.length },
  })
}

// 6A: a database page exports as a simple table of the rows VISIBLE TO THE JOB
// OWNER (listRows applies the Phase-4C row-access resolver). Full CSV is 6C.
async function renderDatabasePage(
  ctx: ExportJobContext,
  actorUserId: string,
  rec: ExportPageRecord,
  title: string,
  isMd: boolean,
): Promise<string> {
  try {
    const props = await ctx.database.listProperties(actorUserId, rec.id)
    const rows: Array<{ title: string | null; cells: Record<string, unknown> }> = []
    let cursor: string | undefined
    do {
      const page = await ctx.database.listRows(actorUserId, {
        pageId: rec.id,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      })
      rows.push(...page.rows)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return isMd
      ? `# ${title}\n\n${buildDatabaseTableMarkdown(props, rows)}`
      : wrapHtmlDocument({
          bodyHtml: buildDatabaseTableHtml(props, rows),
          title,
          icon: rec.icon,
        })
  } catch (err) {
    console.warn('[export-job] database render failed, emitting stub', { pageId: rec.id, err })
    const note = 'Не удалось выгрузить таблицу базы данных.'
    return isMd
      ? `# ${title}\n\n> ${note}\n`
      : wrapHtmlDocument({ bodyHtml: `<p>${note}</p>`, title, icon: rec.icon })
  }
}
```

- [ ] **Step 2: Write the integration test `apps/web/test/server/process-export-job.test.ts`**

```ts
import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { prisma } from '@repo/db'

import {
  processExportJob,
  type ExportJobContext,
} from '@/server/jobs/process-export-job'
import { streamToBuffer } from '@/server/jobs/process-import-job'

const EMAIL_SUFFIX = '+export-job-test@anynote.dev'

function makeFakeStorage(initial: Record<string, Buffer> = {}) {
  const store = new Map<string, Buffer>(Object.entries(initial))
  return {
    store,
    async get(key: string): Promise<Readable> {
      const buf = store.get(key)
      if (!buf) throw new Error(`missing ${key}`)
      return Readable.from([buf])
    },
    async put(key: string, body: Readable | Buffer): Promise<void> {
      store.set(key, Buffer.isBuffer(body) ? body : await streamToBuffer(body))
    },
  }
}

const stubDatabase = {
  listProperties: async () => [{ id: 'p1', name: 'Статус' }],
  listRows: async () => ({
    rows: [{ title: 'Строка', cells: { p1: 'Готово' } }],
    nextCursor: null,
  }),
}

async function cleanFixtures() {
  const where = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where })
  await prisma.page.deleteMany({ where })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where })
  await prisma.workspaceMember.deleteMany({ where })
  await prisma.workspace.deleteMany({ where: { createdBy: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed() {
  const user = await prisma.user.create({
    data: { email: `owner${EMAIL_SUFFIX}`, emailVerified: true, name: 'o', firstName: 'O', lastName: 'T' },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ExpJobWS', createdById: user.id } })
  await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: user.id, role: 'OWNER' } })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })

  const img = await prisma.file.create({
    data: {
      userId: user.id,
      workspaceId: ws.id,
      name: 'pic',
      ext: 'png',
      fileSize: 4n,
      mimeType: 'image/png',
      hash: 'img-hash',
      path: 'test/pic.png',
      status: 'ACTIVE',
      isPublic: false,
    },
  })
  const child = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Ребёнок',
      collectionId: team.id,
      createdById: user.id,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'дочерний' }] }] },
    },
  })
  const root = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Родитель',
      collectionId: team.id,
      createdById: user.id,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'см. ребёнка',
                marks: [{ type: 'link', attrs: { href: `/pages/${child.id}` } }],
              },
            ],
          },
          { type: 'image', attrs: { src: `/api/files/${img.id}` } },
        ],
      },
    },
  })
  await prisma.page.update({ where: { id: child.id }, data: { parentId: root.id } })
  const job = await prisma.exportJob.create({
    data: {
      workspaceId: ws.id,
      userId: user.id,
      scope: 'SUBTREE',
      scopeId: root.id,
      format: 'MARKDOWN_ZIP',
    },
  })
  const storage = makeFakeStorage({ 'test/pic.png': Buffer.from([1, 2, 3, 4]) })
  const ctx: ExportJobContext = { prisma, storage, database: stubDatabase, baseUrl: 'https://t.test' }
  return { user, ws, team, root, child, img, job, storage, ctx }
}

describe('processExportJob', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('builds a notion-style zip with relative links and bundled assets', async () => {
    const { job, ctx, storage, child, img } = await seed()
    await processExportJob(ctx, job.id)

    const done = await prisma.exportJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { artifacts: { include: { file: true } } },
    })
    expect(done.status).toBe('DONE')
    expect(done.artifacts.length).toBe(1)
    expect(done.artifacts[0]!.file.expiresAt).not.toBeNull()

    const zip = unzipSync(new Uint8Array(storage.store.get(`exports/${job.id}.zip`)!))
    const names = Object.keys(zip)
    expect(names).toContain('Родитель.md')
    expect(names).toContain('Родитель/Ребёнок.md')
    expect(names).toContain(`assets/${img.id}.png`)

    const rootMd = strFromU8(zip['Родитель.md']!)
    expect(rootMd).toContain('# Родитель')
    expect(rootMd).toContain('Родитель/Ребёнок.md') // relative link to the included child
    expect(rootMd).toContain(`assets/${img.id}.png`) // relative asset path
    expect(rootMd).not.toContain(`/pages/${child.id}`)
  })

  it('renders DATABASE pages as a table via the database port', async () => {
    const { ws, team, user, ctx } = await seed()
    const dbPage = await prisma.page.create({
      data: { workspaceId: ws.id, type: 'DATABASE', title: 'База', collectionId: team.id, createdById: user.id },
    })
    const job = await prisma.exportJob.create({
      data: { workspaceId: ws.id, userId: user.id, scope: 'SUBTREE', scopeId: dbPage.id, format: 'MARKDOWN_ZIP' },
    })
    await processExportJob(ctx, job.id)
    const zip = unzipSync(
      new Uint8Array(
        (ctx.storage as unknown as { store: Map<string, Buffer> }).store.get(
          `exports/${job.id}.zip`,
        )!,
      ),
    )
    const md = strFromU8(zip['База.md']!)
    expect(md).toContain('| Название | Статус |')
    expect(md).toContain('| Строка | Готово |')
  })

  it('fails with a user error when the scope yields no pages', async () => {
    const { ws, user, ctx } = await seed()
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: user.id,
        scope: 'SUBTREE',
        scopeId: '00000000-0000-0000-0000-000000000000',
        format: 'MARKDOWN_ZIP',
      },
    })
    await processExportJob(ctx, job.id)
    const failed = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toBe('Нет доступных страниц для экспорта')
  })
})
```

- [ ] **Step 3: Run**

Run: `pnpm --filter web exec vitest run test/server/process-export-job.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/jobs/process-export-job.ts apps/web/test/server/process-export-job.test.ts
git commit -m "feat(web): export job processor — notion-style zip, assets, database tables"
```

---

## Task 13: tRPC context `jobs` port + apps/web kick wiring

**Files:**
- Modify: `packages/trpc/src/trpc.ts`
- Create: `apps/web/src/server/jobs/kick.ts`
- Modify: `apps/web/src/app/api/trpc/[trpc]/route.ts`
- Modify: `apps/web/src/trpc/server.ts`

- [ ] **Step 1: Extend the context in `packages/trpc/src/trpc.ts`** — same injection pattern as `yookassa`, but OPTIONAL with a no-op default so existing tests/RSC callers don't break:

Add after the `YookassaClientLike` type:

```ts
/** apps/web injects the real runner; tests/RSC default to a no-op. */
export type JobRunnerPort = { kick(jobId: string, kind: 'import' | 'export'): void }

const NOOP_JOBS: JobRunnerPort = { kick: () => {} }
```

Change `CreateContextOptions` and the two factories:

```ts
type CreateContextOptions = {
  req: Request
  resHeaders: Headers
  yookassa: YookassaClientLike
  returnUrlBase: string
  jobs?: JobRunnerPort
}

export const createContext = async ({
  req,
  resHeaders,
  yookassa,
  returnUrlBase,
  jobs,
}: CreateContextOptions) => {
  const user = await getUserFromRequest(req, resHeaders)
  return {
    prisma,
    user,
    headers: req.headers,
    resHeaders,
    yookassa,
    returnUrlBase,
    jobs: jobs ?? NOOP_JOBS,
  }
}

export const createServerContext = async (
  headers: Headers,
  yookassa: YookassaClientLike,
  returnUrlBase: string,
  jobs?: JobRunnerPort,
) => {
  return createContext({
    req: new Request('http://rsc.internal', { headers }),
    resHeaders: new Headers(),
    yookassa,
    returnUrlBase,
    jobs,
  })
}
```

Also re-export the type from `packages/trpc/src/index.ts` next to the existing type exports:

```ts
export type { JobRunnerPort } from './trpc'
```

- [ ] **Step 2: Create `apps/web/src/server/jobs/kick.ts`** — the real runner: fire-and-forget, never throws into the caller:

```ts
import { prisma } from '@repo/db'
import { storage } from '@repo/storage'

import { domain } from '@/lib/domain'

// Fire-and-forget background processing inside the web process. Crash recovery
// is the lazy reclaim in job.list (heartbeat > 10 min → re-queue + re-kick);
// import re-runs are idempotent via ImportMapping, export re-runs rebuild the zip.
export function kickJob(jobId: string, kind: 'import' | 'export'): void {
  void run(jobId, kind).catch((err) => {
    console.error('[jobs] runner crashed', { jobId, kind, err })
  })
}

async function run(jobId: string, kind: 'import' | 'export'): Promise<void> {
  if (kind === 'export') {
    const { processExportJob } = await import('./process-export-job')
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
    await processExportJob({ prisma, storage, database: domain.database, baseUrl }, jobId)
  } else {
    const { processImportJob } = await import('./process-import-job')
    await processImportJob({ prisma, storage, pages: domain.pages }, jobId)
  }
}
```

- [ ] **Step 3: Wire into both context factories in apps/web**

`apps/web/src/app/api/trpc/[trpc]/route.ts` — add the import and the field:

```ts
import { kickJob } from '@/server/jobs/kick'
```

```ts
    createContext: ({ req, resHeaders }) =>
      createContext({
        req,
        resHeaders,
        yookassa: getYookassaClient(),
        returnUrlBase: getReturnUrlBase(),
        jobs: { kick: kickJob },
      }),
```

`apps/web/src/trpc/server.ts`:

```ts
import { kickJob } from '@/server/jobs/kick'
```

```ts
  const ctx = await createServerContext(heads, getYookassaClient(), getReturnUrlBase(), {
    kick: kickJob,
  })
```

- [ ] **Step 4: Verify types**

Run: `pnpm --filter @repo/trpc test && pnpm --filter web check-types`
Expected: existing trpc tests still pass unchanged (the port is optional with a default).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/trpc.ts packages/trpc/src/index.ts apps/web/src/server/jobs/kick.ts "apps/web/src/app/api/trpc/[trpc]/route.ts" apps/web/src/trpc/server.ts
git commit -m "feat(trpc): jobs kick port in context, wired to the web job runner"
```

---

## Task 14: `job` tRPC router (create / list+reclaim / delete) + mount

**Files:**
- Create: `packages/trpc/src/routers/job.ts`
- Modify: `packages/trpc/src/index.ts` (mount `job: jobRouter`)
- Test: `packages/trpc/test/job-router.test.ts` (real DB)

- [ ] **Step 1: Implement `packages/trpc/src/routers/job.ts`**

```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { CollectionKind, JobStatus, type PrismaClient } from '@repo/db'
import { buildPageVisibilityWhere } from '@repo/domain'

import { router, protectedProcedure } from '../trpc'
import { assertPageEditAccess, assertWorkspaceMember } from '../helpers/page-access'
import { requireWritableWorkspace } from '../helpers/plan'

/** PROCESSING older than this (by heartbeat) is considered orphaned. */
export const RECLAIM_AFTER_MS = 10 * 60 * 1000
/** QUEUED that never started within this window lost its kick (deploy) — re-kick. */
export const REKICK_QUEUED_AFTER_MS = 60 * 1000

const exportCreateInput = z.object({
  workspaceId: z.string().uuid(),
  scope: z.enum(['WORKSPACE', 'COLLECTION', 'SUBTREE']),
  scopeId: z.string().uuid().nullish(),
  format: z.enum(['MARKDOWN_ZIP', 'HTML_ZIP']),
})

const importCreateInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: z.string().uuid(),
  format: z.enum(['MARKDOWN', 'HTML', 'ZIP']),
  location: z.enum(['team', 'private']).default('team'),
  parentId: z.string().uuid().nullish(),
})

const ACTIVE: JobStatus[] = [JobStatus.QUEUED, JobStatus.PROCESSING]

async function assertNoActiveJob(
  prisma: PrismaClient,
  kind: 'import' | 'export',
  workspaceId: string,
): Promise<void> {
  const count =
    kind === 'export'
      ? await prisma.exportJob.count({ where: { workspaceId, status: { in: ACTIVE } } })
      : await prisma.importJob.count({ where: { workspaceId, status: { in: ACTIVE } } })
  if (count > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message:
        kind === 'export'
          ? 'Экспорт уже выполняется — дождитесь завершения'
          : 'Импорт уже выполняется — дождитесь завершения',
    })
  }
}

export type JobListItem = {
  id: string
  kind: 'import' | 'export'
  status: JobStatus
  scope: string | null
  format: string
  processed: number
  total: number
  error: string | null
  createdAt: Date
  finishedAt: Date | null
  hasArtifact: boolean
  sourceName: string | null
}

export const jobRouter = router({
  export: router({
    create: protectedProcedure.input(exportCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)

      if (input.scope !== 'WORKSPACE' && !input.scopeId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не указан объект экспорта' })
      }
      if (input.scope === 'COLLECTION') {
        const col = await ctx.prisma.collection.findFirst({
          where: { id: input.scopeId!, workspaceId: input.workspaceId },
          select: { kind: true, ownerId: true },
        })
        if (!col || (col.kind === CollectionKind.PERSONAL && col.ownerId !== ctx.user.id)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Раздел не найден' })
        }
      }
      if (input.scope === 'SUBTREE') {
        // Root must exist, live in this workspace, and be VISIBLE to the caller.
        const root = await ctx.prisma.page.findFirst({
          where: {
            id: input.scopeId!,
            workspaceId: input.workspaceId,
            deletedAt: null,
            archivedAt: null,
            AND: [buildPageVisibilityWhere(ctx.user.id)],
          },
          select: { id: true },
        })
        if (!root) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
      }

      await assertNoActiveJob(ctx.prisma, 'export', input.workspaceId)
      const job = await ctx.prisma.exportJob.create({
        data: {
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          scope: input.scope,
          scopeId: input.scope === 'WORKSPACE' ? null : input.scopeId,
          format: input.format,
        },
      })
      ctx.jobs.kick(job.id, 'export')
      return { id: job.id }
    }),
  }),

  import: router({
    create: protectedProcedure.input(importCreateInput).mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, userId: ctx.user.id, status: 'ACTIVE' },
        select: { id: true, ext: true },
      })
      if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'Файл не найден' })
      const extOk =
        (input.format === 'ZIP' && file.ext === 'zip') ||
        (input.format === 'MARKDOWN' && ['md', 'markdown'].includes(file.ext)) ||
        (input.format === 'HTML' && ['html', 'htm'].includes(file.ext))
      if (!extOk) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Формат файла не совпадает' })
      }
      if (input.parentId) {
        const parent = await assertPageEditAccess(ctx, input.parentId)
        if (parent.workspaceId !== input.workspaceId || parent.deletedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Родительская страница не найдена' })
        }
      }

      await assertNoActiveJob(ctx.prisma, 'import', input.workspaceId)
      const job = await ctx.prisma.importJob.create({
        data: {
          workspaceId: input.workspaceId,
          userId: ctx.user.id,
          format: input.format,
          options: { location: input.location, parentId: input.parentId ?? null },
          artifacts: { create: { fileId: input.fileId, kind: 'SOURCE' } },
        },
      })
      ctx.jobs.kick(job.id, 'import')
      return { id: job.id }
    }),
  }),

  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<JobListItem[]> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const own = { workspaceId: input.workspaceId, userId: ctx.user.id }

      // ── Lazy reclaim (caller's jobs only) ──────────────────────────────────
      const staleBefore = new Date(Date.now() - RECLAIM_AFTER_MS)
      const queuedBefore = new Date(Date.now() - REKICK_QUEUED_AFTER_MS)
      for (const kind of ['export', 'import'] as const) {
        const model = kind === 'export' ? ctx.prisma.exportJob : ctx.prisma.importJob
        const stuck = await model.findMany({
          where: { ...own, status: JobStatus.PROCESSING, heartbeatAt: { lt: staleBefore } },
          select: { id: true },
        })
        for (const j of stuck) {
          // Atomic per-job transition guards against a concurrent poller.
          const res = await model.updateMany({
            where: { id: j.id, status: JobStatus.PROCESSING, heartbeatAt: { lt: staleBefore } },
            data: { status: JobStatus.QUEUED, heartbeatAt: null },
          })
          if (res.count === 1) ctx.jobs.kick(j.id, kind)
        }
        // QUEUED rows whose kick died with the process: re-kick (claim is atomic).
        const lost = await model.findMany({
          where: {
            ...own,
            status: JobStatus.QUEUED,
            heartbeatAt: null,
            createdAt: { lt: queuedBefore },
          },
          select: { id: true },
        })
        for (const j of lost) ctx.jobs.kick(j.id, kind)
      }

      // ── Unified list ───────────────────────────────────────────────────────
      const [exports, imports] = await Promise.all([
        ctx.prisma.exportJob.findMany({
          where: own,
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { artifacts: { select: { id: true } } },
        }),
        ctx.prisma.importJob.findMany({
          where: own,
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { artifacts: { include: { file: { select: { name: true, ext: true } } } } },
        }),
      ])
      const items: JobListItem[] = [
        ...exports.map(
          (j): JobListItem => ({
            id: j.id,
            kind: 'export',
            status: j.status,
            scope: j.scope,
            format: j.format,
            processed: j.processed,
            total: j.total,
            error: j.error,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt,
            hasArtifact: j.status === JobStatus.DONE && j.artifacts.length > 0,
            sourceName: null,
          }),
        ),
        ...imports.map((j): JobListItem => {
          const src = j.artifacts[0]?.file
          return {
            id: j.id,
            kind: 'import',
            status: j.status,
            scope: null,
            format: j.format,
            processed: j.processed,
            total: j.total,
            error: j.error,
            createdAt: j.createdAt,
            finishedAt: j.finishedAt,
            hasArtifact: false,
            sourceName: src ? `${src.name}${src.ext ? `.${src.ext}` : ''}` : null,
          }
        }),
      ]
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return items.slice(0, 50)
    }),

  delete: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        kind: z.enum(['import', 'export']),
        jobId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const own = { id: input.jobId, workspaceId: input.workspaceId, userId: ctx.user.id }
      if (input.kind === 'export') {
        const job = await ctx.prisma.exportJob.findFirst({
          where: own,
          include: { artifacts: { include: { file: true } } },
        })
        if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Задание не найдено' })
        // Artifact zips live under unique exports/<jobId>.zip keys — safe to remove
        // physically. (Import SOURCE files are normal content-addressed attachments
        // shared by hash and are NEVER physically deleted here.)
        const files = job.artifacts.map((a) => a.file)
        await ctx.prisma.exportJob.delete({ where: { id: job.id } })
        for (const f of files) {
          await ctx.prisma.file.delete({ where: { id: f.id } }).catch(() => {})
        }
        return { deletedFiles: files.map((f) => f.path) }
      }
      const job = await ctx.prisma.importJob.findFirst({ where: own, select: { id: true } })
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Задание не найдено' })
      await ctx.prisma.importJob.delete({ where: { id: job.id } })
      return { deletedFiles: [] }
    }),
})
```

Note: `delete` returns the S3 keys it removed from the DB. Physical S3 deletion happens in the web layer? No — keep it simple and synchronous here is impossible (no storage in ctx). **Decision:** physical S3 cleanup of artifact objects happens in the artifact-expiry path only (objects are content-addressed-unique per job and expire from the download route after 7 days; the spec already flags S3 garbage collection as follow-up). The `deletedFiles` return value is informational.

- [ ] **Step 2: Mount in `packages/trpc/src/index.ts`**

```ts
import { jobRouter } from './routers/job'
```

and inside `appRouter = router({ ... })`, after `aiProvider: aiProviderRouter,`:

```ts
  job: jobRouter,
```

- [ ] **Step 3: Write `packages/trpc/test/job-router.test.ts`** (mirror the `page-history.test.ts` harness style)

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@repo/db'

import { jobRouter } from '../src/routers/job'
import { createCallerFactory } from '../src/trpc'

const EMAIL_SUFFIX = '+job-router-test@anynote.dev'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where: byWs })
  await prisma.importJob.deleteMany({ where: byWs })
  await prisma.page.deleteMany({ where: byWs })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.collection.deleteMany({ where: byWs })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'Test',
    },
  })
}

function makeCaller(userId: string, kick = vi.fn()) {
  const caller = createCallerFactory(jobRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
    jobs: { kick },
  })
  return { caller, kick }
}

async function seed() {
  const owner = await makeUser('owner')
  const stranger = await makeUser('stranger')
  const ws = await prisma.workspace.create({ data: { name: 'JobWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: stranger.id, role: 'EDITOR' },
    ],
  })
  const team = await prisma.collection.create({ data: { workspaceId: ws.id, kind: 'TEAM' } })
  const page = await prisma.page.create({
    data: { workspaceId: ws.id, type: 'TEXT', title: 'P', collectionId: team.id, createdById: owner.id },
  })
  return { owner, stranger, ws, team, page }
}

describe('job router', () => {
  beforeEach(cleanFixtures)
  afterAll(cleanFixtures)

  it('export.create inserts a QUEUED job and kicks the runner', async () => {
    const { owner, ws } = await seed()
    const { caller, kick } = makeCaller(owner.id)
    const { id } = await caller.export.create({
      workspaceId: ws.id,
      scope: 'WORKSPACE',
      format: 'MARKDOWN_ZIP',
    })
    expect(kick).toHaveBeenCalledWith(id, 'export')
    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id } })
    expect(job.status).toBe('QUEUED')
  })

  it('enforces one active export per workspace (CONFLICT)', async () => {
    const { owner, ws } = await seed()
    const { caller } = makeCaller(owner.id)
    await caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'HTML_ZIP' })
    await expect(
      caller.export.create({ workspaceId: ws.id, scope: 'WORKSPACE', format: 'HTML_ZIP' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('export.create SUBTREE rejects a page the caller cannot see', async () => {
    const { owner, stranger, ws, page } = await seed()
    // Move the page into the OWNER's personal collection — invisible to stranger.
    const personal = await prisma.collection.create({
      data: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: owner.id },
    })
    await prisma.page.update({ where: { id: page.id }, data: { collectionId: personal.id } })
    const { caller } = makeCaller(stranger.id)
    await expect(
      caller.export.create({
        workspaceId: ws.id,
        scope: 'SUBTREE',
        scopeId: page.id,
        format: 'MARKDOWN_ZIP',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it("import.create rejects another user's file", async () => {
    const { owner, stranger, ws } = await seed()
    const file = await prisma.file.create({
      data: {
        userId: stranger.id,
        workspaceId: ws.id,
        name: 's.zip',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h1',
        path: 't/s.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    const { caller } = makeCaller(owner.id)
    await expect(
      caller.import.create({ workspaceId: ws.id, fileId: file.id, format: 'ZIP' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('list returns only the caller’s jobs', async () => {
    const { owner, stranger, ws } = await seed()
    await prisma.exportJob.create({
      data: { workspaceId: ws.id, userId: stranger.id, scope: 'WORKSPACE', format: 'HTML_ZIP' },
    })
    const { caller } = makeCaller(owner.id)
    const rows = await caller.list({ workspaceId: ws.id })
    expect(rows.length).toBe(0)
  })

  it('list reclaims a stale PROCESSING job back to QUEUED and re-kicks it', async () => {
    const { owner, ws } = await seed()
    const stale = new Date(Date.now() - 11 * 60 * 1000)
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'PROCESSING',
        startedAt: stale,
        heartbeatAt: stale,
      },
    })
    const { caller, kick } = makeCaller(owner.id)
    await caller.list({ workspaceId: ws.id })
    expect(kick).toHaveBeenCalledWith(job.id, 'export')
    const reclaimed = await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(reclaimed.status).toBe('QUEUED')
  })

  it('list does NOT reclaim a fresh PROCESSING job', async () => {
    const { owner, ws } = await seed()
    await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'PROCESSING',
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
    })
    const { caller, kick } = makeCaller(owner.id)
    await caller.list({ workspaceId: ws.id })
    expect(kick).not.toHaveBeenCalled()
  })

  it('delete removes an export job together with its artifact file row', async () => {
    const { owner, ws } = await seed()
    const file = await prisma.file.create({
      data: {
        userId: owner.id,
        workspaceId: ws.id,
        name: 'anynote-export',
        ext: 'zip',
        fileSize: 1n,
        mimeType: 'application/zip',
        hash: 'h2',
        path: 'exports/x.zip',
        status: 'ACTIVE',
        isPublic: false,
      },
    })
    const job = await prisma.exportJob.create({
      data: {
        workspaceId: ws.id,
        userId: owner.id,
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        status: 'DONE',
        artifacts: { create: { fileId: file.id } },
      },
    })
    const { caller } = makeCaller(owner.id)
    await caller.delete({ workspaceId: ws.id, kind: 'export', jobId: job.id })
    expect(await prisma.exportJob.findUnique({ where: { id: job.id } })).toBeNull()
    expect(await prisma.file.findUnique({ where: { id: file.id } })).toBeNull()
  })
})
```

- [ ] **Step 4: Run**

Run: `pnpm --filter @repo/trpc test -- job-router`
Expected: PASS (8 tests). If `requireWritableWorkspace` fails on a missing plan fixture, check how `plan.test.ts` seeds self-contained plan rows and mirror ONLY what the writable check needs (it may pass by default for workspaces without a subscription — read `packages/trpc/src/helpers/plan.ts:requireWritableWorkspace` first; if it requires a WorkspaceLimit or plan row, seed it in `seed()`).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/job.ts packages/trpc/src/index.ts packages/trpc/test/job-router.test.ts
git commit -m "feat(trpc): job router — create/list/delete with lazy orphan reclaim"
```

---

## Task 15: Artifact download route (owner-gated, expiring)

**Files:**
- Create: `apps/web/src/app/api/jobs/export/[jobId]/artifact/route.ts`
- Test: `apps/web/test/api/jobs-export-artifact-route.test.ts`

- [ ] **Step 1: Implement the route** — modeled on `/api/files/[id]` but gated on JOB ownership, uniform 404:

```ts
import { Readable } from 'node:stream'

import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

const NOT_FOUND = new Response('Not found', { status: 404 })

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params
  if (!z.string().uuid().safeParse(jobId).success) return NOT_FOUND

  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  // Owner-only: a workspace export may contain the creator's personal pages, so
  // even workspace admins must not fetch another user's artifact. All failure
  // modes are a uniform 404 (no existence leak).
  const job = await prisma.exportJob.findFirst({
    where: { id: jobId, userId: session.user.id, status: 'DONE' },
    include: { artifacts: { include: { file: true } } },
  })
  const file = job?.artifacts[0]?.file
  if (!file || file.status !== 'ACTIVE') return NOT_FOUND
  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) return NOT_FOUND

  let body: Readable
  try {
    body = (await storage.get(file.path)) as Readable
  } catch {
    return NOT_FOUND
  }
  const stream = Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>
  const filename = encodeURIComponent(`anynote-export-${jobId.slice(0, 8)}.zip`)

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': file.fileSize.toString(),
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
```

- [ ] **Step 2: Write the test** — mock `@/lib/get-session` and `@repo/storage`, real prisma (the existing `apps/web/test/api/*` route tests follow this import-the-handler pattern):

```ts
import { Readable } from 'node:stream'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@repo/db'

const sessionUserId = vi.hoisted(() => ({ current: null as string | null }))

vi.mock('@/lib/get-session', () => ({
  getSession: async () =>
    sessionUserId.current ? { user: { id: sessionUserId.current } } : null,
}))

vi.mock('@repo/storage', () => ({
  storage: {
    get: async (key: string) => {
      if (key !== 'exports/test-artifact.zip') throw new Error('missing')
      return Readable.from([Buffer.from('PK-test')])
    },
  },
}))

import { GET } from '@/app/api/jobs/export/[jobId]/artifact/route'

const EMAIL_SUFFIX = '+artifact-route-test@anynote.dev'

async function cleanFixtures() {
  const byWs = { workspace: { createdBy: { email: { contains: EMAIL_SUFFIX } } } }
  await prisma.exportJob.deleteMany({ where: byWs })
  await prisma.file.deleteMany({ where: { user: { email: { contains: EMAIL_SUFFIX } } } })
  await prisma.workspaceMember.deleteMany({ where: byWs })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function seed(opts: { expired?: boolean } = {}) {
  const owner = await prisma.user.create({
    data: { email: `owner${EMAIL_SUFFIX}`, emailVerified: true, name: 'o', firstName: 'O', lastName: 'T' },
  })
  const other = await prisma.user.create({
    data: { email: `other${EMAIL_SUFFIX}`, emailVerified: true, name: 'x', firstName: 'X', lastName: 'T' },
  })
  const ws = await prisma.workspace.create({ data: { name: 'ArtWS', createdById: owner.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: other.id, role: 'ADMIN' },
    ],
  })
  const file = await prisma.file.create({
    data: {
      userId: owner.id,
      workspaceId: ws.id,
      name: 'anynote-export',
      ext: 'zip',
      fileSize: 7n,
      mimeType: 'application/zip',
      hash: 'art-h',
      path: 'exports/test-artifact.zip',
      status: 'ACTIVE',
      isPublic: false,
      expiresAt: new Date(Date.now() + (opts.expired ? -1000 : 1000 * 60 * 60)),
    },
  })
  const job = await prisma.exportJob.create({
    data: {
      workspaceId: ws.id,
      userId: owner.id,
      scope: 'WORKSPACE',
      format: 'MARKDOWN_ZIP',
      status: 'DONE',
      artifacts: { create: { fileId: file.id } },
    },
  })
  return { owner, other, job }
}

function call(jobId: string) {
  return GET(new Request('http://t/api') as never, { params: Promise.resolve({ jobId }) })
}

describe('GET /api/jobs/export/[jobId]/artifact', () => {
  beforeEach(async () => {
    sessionUserId.current = null
    await cleanFixtures()
  })
  afterAll(cleanFixtures)

  it('streams the zip to the job owner', async () => {
    const { owner, job } = await seed()
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(await res.text()).toBe('PK-test')
  })

  it('returns 404 for a workspace ADMIN who does not own the job', async () => {
    const { other, job } = await seed()
    sessionUserId.current = other.id
    const res = await call(job.id)
    expect(res.status).toBe(404)
  })

  it('returns 404 after the artifact expired', async () => {
    const { owner, job } = await seed({ expired: true })
    sessionUserId.current = owner.id
    const res = await call(job.id)
    expect(res.status).toBe(404)
  })

  it('returns 401 without a session', async () => {
    const { job } = await seed()
    const res = await call(job.id)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 3: Run**

Run: `pnpm --filter web exec vitest run test/api/jobs-export-artifact-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/jobs/export/[jobId]/artifact/route.ts" apps/web/test/api/jobs-export-artifact-route.test.ts
git commit -m "feat(web): owner-gated expiring artifact download route"
```

---

## Task 16: Import/Export Center UI (settings section + dialogs)

**Files:**
- Create: `apps/web/src/components/import-export/job-presentation.ts` (pure)
- Create: `apps/web/src/components/import-export/import-format.ts` (pure)
- Create: `apps/web/src/components/import-export/import-wizard-dialog.tsx`
- Create: `apps/web/src/components/import-export/bulk-export-dialog.tsx`
- Create: `apps/web/src/components/workspace/settings/import-export-section.tsx`
- Modify: `apps/web/src/components/workspace/settings/workspace-settings-dialog.tsx` (register slug + item)
- Test: `apps/web/test/import-export-helpers.test.ts`

UI conventions (from `public-pages-section.tsx`): `'use client'`, MUI ONLY via `@repo/ui/components`, `trpc` from `@/trpc/client`, `trpc.useUtils()` + invalidate on mutation success, content in `SettingsCard`, Russian strings. If a needed MUI component/icon is not re-exported by `@repo/ui/components` (likely: `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions`, `Select`, `FormControl`, `InputLabel`, `Alert`, `LinearProgress`), add the explicit re-export to `packages/ui/src/components/index.ts` following the existing one-line pattern — that is the documented convention, never import `@mui/material` directly from app code.

- [ ] **Step 1: Pure helpers + failing test**

`apps/web/src/components/import-export/job-presentation.ts`:

```ts
export type JobRow = {
  id: string
  kind: 'import' | 'export'
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED'
  scope: string | null
  format: string
  processed: number
  total: number
  error: string | null
  createdAt: string | Date
  hasArtifact: boolean
  sourceName: string | null
}

export function statusChip(j: Pick<JobRow, 'status' | 'processed' | 'total'>): {
  label: string
  color: 'default' | 'info' | 'success' | 'error'
} {
  switch (j.status) {
    case 'QUEUED':
      return { label: 'В очереди', color: 'default' }
    case 'PROCESSING':
      return {
        label: j.total > 0 ? `Выполняется ${j.processed}/${j.total}` : 'Выполняется',
        color: 'info',
      }
    case 'DONE':
      return { label: 'Готово', color: 'success' }
    case 'FAILED':
      return { label: 'Ошибка', color: 'error' }
  }
}

const SCOPE_LABEL: Record<string, string> = {
  WORKSPACE: 'всё пространство',
  COLLECTION: 'раздел',
  SUBTREE: 'страница с подстраницами',
}

const FORMAT_LABEL: Record<string, string> = {
  MARKDOWN_ZIP: 'Markdown',
  HTML_ZIP: 'HTML',
  MARKDOWN: 'Markdown',
  HTML: 'HTML',
  ZIP: 'ZIP',
}

export function describeJob(j: JobRow): string {
  if (j.kind === 'export') {
    return `Экспорт: ${SCOPE_LABEL[j.scope ?? ''] ?? j.scope ?? ''} · ${FORMAT_LABEL[j.format] ?? j.format}`
  }
  return `Импорт: ${j.sourceName ?? FORMAT_LABEL[j.format] ?? j.format}`
}
```

`apps/web/src/components/import-export/import-format.ts`:

```ts
export type ImportFormat = 'MARKDOWN' | 'HTML' | 'ZIP'

export function detectImportFormat(fileName: string): ImportFormat | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'zip') return 'ZIP'
  if (ext === 'md' || ext === 'markdown') return 'MARKDOWN'
  if (ext === 'html' || ext === 'htm') return 'HTML'
  return null
}

// Browsers often report '' for .md and platform-specific types for .zip
// (e.g. application/x-zip-compressed), and text/html is deliberately NOT in the
// upload allowlist (stored HTML served inline = XSS). Force safe MIME values.
export function uploadMimeFor(format: ImportFormat): string {
  return format === 'ZIP' ? 'application/zip' : 'text/plain'
}
```

`apps/web/test/import-export-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  detectImportFormat,
  uploadMimeFor,
} from '../src/components/import-export/import-format'
import { describeJob, statusChip } from '../src/components/import-export/job-presentation'

describe('statusChip', () => {
  it('maps statuses to labels and colors', () => {
    expect(statusChip({ status: 'QUEUED', processed: 0, total: 0 }).color).toBe('default')
    expect(statusChip({ status: 'PROCESSING', processed: 2, total: 5 }).label).toBe(
      'Выполняется 2/5',
    )
    expect(statusChip({ status: 'DONE', processed: 5, total: 5 }).color).toBe('success')
    expect(statusChip({ status: 'FAILED', processed: 0, total: 0 }).color).toBe('error')
  })
})

describe('describeJob', () => {
  it('describes exports by scope+format and imports by source name', () => {
    expect(
      describeJob({
        id: '1',
        kind: 'export',
        status: 'DONE',
        scope: 'WORKSPACE',
        format: 'MARKDOWN_ZIP',
        processed: 1,
        total: 1,
        error: null,
        createdAt: new Date(),
        hasArtifact: true,
        sourceName: null,
      }),
    ).toBe('Экспорт: всё пространство · Markdown')
  })
})

describe('detectImportFormat / uploadMimeFor', () => {
  it('detects by extension and forces safe upload MIME', () => {
    expect(detectImportFormat('a.zip')).toBe('ZIP')
    expect(detectImportFormat('a.md')).toBe('MARKDOWN')
    expect(detectImportFormat('a.htm')).toBe('HTML')
    expect(detectImportFormat('a.pdf')).toBeNull()
    expect(uploadMimeFor('ZIP')).toBe('application/zip')
    expect(uploadMimeFor('HTML')).toBe('text/plain')
  })
})
```

Run: `pnpm --filter web exec vitest run test/import-export-helpers.test.ts` → FAIL first (modules missing), implement, then PASS (3 tests). Commit:

```bash
git add apps/web/src/components/import-export/job-presentation.ts apps/web/src/components/import-export/import-format.ts apps/web/test/import-export-helpers.test.ts
git commit -m "feat(web): import/export job presentation helpers"
```

- [ ] **Step 2: `apps/web/src/components/import-export/import-wizard-dialog.tsx`**

```tsx
'use client'

import { useMemo, useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  UploadFileIcon,
} from '@repo/ui/components'

import { PAGE_TREE_ROOT, PageTreePicker, type PageTreeSelection } from '@/components/workspace/page-tree-picker'
import { trpc } from '@/trpc/client'

import { detectImportFormat, uploadMimeFor } from './import-format'

type Props = { open: boolean; onClose: () => void; workspaceId: string }

export function ImportWizardDialog({ open, onClose, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [location, setLocation] = useState<'team' | 'private'>('team')
  const [parentId, setParentId] = useState<PageTreeSelection | null>(PAGE_TREE_ROOT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)

  const pagesQ = trpc.page.listByWorkspace.useQuery({ workspaceId }, { enabled: open })
  const createJob = trpc.job.import.create.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  const format = useMemo(() => (file ? detectImportFormat(file.name) : null), [file])

  async function submit() {
    if (!file || !format) return
    setBusy(true)
    setError(null)
    try {
      const forced = new File([file], file.name, { type: uploadMimeFor(format) })
      const fd = new FormData()
      fd.append('file', forced)
      const res = await fetch('/api/files/upload?kind=attachment', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (!res.ok) {
        setError(`Не удалось загрузить файл (${res.status})`)
        return
      }
      const json = (await res.json()) as { file: { id: string } }
      await createJob.mutateAsync({
        workspaceId,
        fileId: json.file.id,
        format,
        location,
        parentId: parentId === PAGE_TREE_ROOT || parentId === null ? null : parentId,
      })
      setStarted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setFile(null)
    setLocation('team')
    setParentId(PAGE_TREE_ROOT)
    setError(null)
    setStarted(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={reset} maxWidth="sm" fullWidth data-testid="import-wizard">
      <DialogTitle>Импорт страниц</DialogTitle>
      <DialogContent>
        {started ? (
          <Alert severity="success">
            Импорт запущен. Прогресс виден в списке заданий, страницы появятся в дереве по мере
            создания.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box>
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => inputRef.current?.click()}
                data-testid="import-pick-file"
              >
                {file ? file.name : 'Выбрать файл (.md, .html, .zip)'}
              </Button>
              <input
                ref={inputRef}
                type="file"
                hidden
                accept=".md,.markdown,.html,.htm,.zip"
                data-testid="import-file-input"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  e.target.value = ''
                }}
              />
              {file && !format ? (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                  Поддерживаются только .md, .html и .zip
                </Typography>
              ) : null}
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Куда импортировать
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant={location === 'team' ? 'contained' : 'outlined'}
                  onClick={() => setLocation('team')}
                >
                  Команда
                </Button>
                <Button
                  size="small"
                  variant={location === 'private' ? 'contained' : 'outlined'}
                  onClick={() => setLocation('private')}
                >
                  Личное
                </Button>
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Родительская страница (необязательно)
              </Typography>
              <Box sx={{ maxHeight: 200, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <PageTreePicker
                  pages={pagesQ.data ?? []}
                  onSelect={setParentId}
                  selectedId={parentId}
                  showRoot
                  rootLabel="Без родителя (корень)"
                />
              </Box>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={reset}>{started ? 'Закрыть' : 'Отмена'}</Button>
        {started ? null : (
          <Button
            variant="contained"
            disabled={!file || !format || busy}
            onClick={() => void submit()}
            data-testid="import-submit"
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
          >
            Импортировать
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
```

Type note: `PageTreePicker.pages` expects `PageItem[]`; `trpc.page.listByWorkspace` data is the same shape the sidebar feeds it (see `page-tree-section.tsx:262`). If tsc complains about an exact-type mismatch, map through `as PageItem[]` with the import `import { type PageItem } from '@/components/workspace/types'`.

- [ ] **Step 3: `apps/web/src/components/import-export/bulk-export-dialog.tsx`**

```tsx
'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'

import { PageTreePicker, type PageTreeSelection } from '@/components/workspace/page-tree-picker'
import { trpc } from '@/trpc/client'

type Scope = 'WORKSPACE' | 'COLLECTION' | 'SUBTREE'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  /** Pre-scoped mode (page actions menu): scope is fixed to this page's subtree. */
  preset?: { pageId: string; pageTitle: string } | null
}

export function BulkExportDialog({ open, onClose, workspaceId, preset }: Props) {
  const utils = trpc.useUtils()
  const [scope, setScope] = useState<Scope>(preset ? 'SUBTREE' : 'WORKSPACE')
  const [collectionId, setCollectionId] = useState<string>('')
  const [pageId, setPageId] = useState<PageTreeSelection | null>(preset?.pageId ?? null)
  const [format, setFormat] = useState<'MARKDOWN_ZIP' | 'HTML_ZIP'>('MARKDOWN_ZIP')
  const [started, setStarted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const collectionsQ = trpc.collection.list.useQuery(
    { workspaceId },
    { enabled: open && !preset && scope === 'COLLECTION' },
  )
  const pagesQ = trpc.page.listByWorkspace.useQuery(
    { workspaceId },
    { enabled: open && !preset && scope === 'SUBTREE' },
  )
  const create = trpc.job.export.create.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  async function submit() {
    setError(null)
    try {
      const scopeId =
        scope === 'WORKSPACE'
          ? null
          : scope === 'COLLECTION'
            ? collectionId || null
            : typeof pageId === 'string' && pageId !== '__root__'
              ? pageId
              : null
      if (scope !== 'WORKSPACE' && !scopeId) {
        setError('Выберите объект экспорта')
        return
      }
      await create.mutateAsync({ workspaceId, scope, scopeId, format })
      setStarted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function reset() {
    setStarted(false)
    setError(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={reset} maxWidth="sm" fullWidth data-testid="bulk-export-dialog">
      <DialogTitle>Экспорт в ZIP</DialogTitle>
      <DialogContent>
        {started ? (
          <Alert severity="success">
            Экспорт запущен. Скачать архив можно в «Настройки → Импорт и экспорт», когда задание
            завершится. Архив хранится 7 дней.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {preset ? (
              <Typography variant="body2">
                Страница «{preset.pageTitle || 'Без названия'}» со всеми подстраницами.
              </Typography>
            ) : (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Что экспортировать
                </Typography>
                <Stack direction="row" spacing={1}>
                  {(
                    [
                      ['WORKSPACE', 'Всё пространство'],
                      ['COLLECTION', 'Раздел'],
                      ['SUBTREE', 'Поддерево'],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      size="small"
                      variant={scope === value ? 'contained' : 'outlined'}
                      onClick={() => setScope(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </Stack>
              </Box>
            )}

            {!preset && scope === 'COLLECTION' ? (
              <Select
                size="small"
                value={collectionId}
                onChange={(e) => setCollectionId(String(e.target.value))}
                displayEmpty
                fullWidth
              >
                <MenuItem value="" disabled>
                  Выберите раздел
                </MenuItem>
                {(collectionsQ.data ?? []).map((c: { id: string; kind: string; title?: string | null }) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.title || (c.kind === 'TEAM' ? 'Команда' : 'Личное')}
                  </MenuItem>
                ))}
              </Select>
            ) : null}

            {!preset && scope === 'SUBTREE' ? (
              <Box sx={{ maxHeight: 200, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                <PageTreePicker
                  pages={pagesQ.data ?? []}
                  onSelect={setPageId}
                  selectedId={pageId}
                  showRoot={false}
                />
              </Box>
            ) : null}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Формат
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant={format === 'MARKDOWN_ZIP' ? 'contained' : 'outlined'}
                  onClick={() => setFormat('MARKDOWN_ZIP')}
                >
                  Markdown
                </Button>
                <Button
                  size="small"
                  variant={format === 'HTML_ZIP' ? 'contained' : 'outlined'}
                  onClick={() => setFormat('HTML_ZIP')}
                >
                  HTML
                </Button>
              </Stack>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={reset}>{started ? 'Закрыть' : 'Отмена'}</Button>
        {started ? null : (
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={create.isPending}
            data-testid="export-submit"
            startIcon={create.isPending ? <CircularProgress size={16} /> : undefined}
          >
            Экспортировать
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 4: `apps/web/src/components/workspace/settings/import-export-section.tsx`**

```tsx
'use client'

import { useState } from 'react'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DeleteIcon,
  DownloadIcon,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { BulkExportDialog } from '@/components/import-export/bulk-export-dialog'
import { ImportWizardDialog } from '@/components/import-export/import-wizard-dialog'
import { describeJob, statusChip } from '@/components/import-export/job-presentation'
import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = { workspaceId: string }

function formatDate(value: string | Date | null): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ImportExportSection({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  const jobsQ = trpc.job.list.useQuery(
    { workspaceId },
    {
      refetchInterval: (query) => {
        const rows = query.state.data
        return rows?.some((j) => j.status === 'QUEUED' || j.status === 'PROCESSING')
          ? 2500
          : false
      },
    },
  )
  const del = trpc.job.delete.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  const rows = jobsQ.data ?? []

  return (
    <SettingsCard
      title="Импорт и экспорт"
      description="Импортируйте Markdown/HTML-файлы и ZIP-архивы, экспортируйте страницы в ZIP. Задания выполняются в фоне; архив экспорта хранится 7 дней и доступен только вам."
    >
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant="contained" onClick={() => setImportOpen(true)} data-testid="open-import">
          Импортировать
        </Button>
        <Button variant="outlined" onClick={() => setExportOpen(true)} data-testid="open-export">
          Экспортировать
        </Button>
      </Stack>

      {jobsQ.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
          Пока нет заданий.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Задание</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Создано</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((j) => {
              const chip = statusChip(j)
              return (
                <TableRow key={`${j.kind}-${j.id}`} data-testid="job-row">
                  <TableCell>{describeJob(j)}</TableCell>
                  <TableCell>
                    {j.status === 'FAILED' && j.error ? (
                      <Tooltip title={j.error}>
                        <Chip size="small" label={chip.label} color={chip.color} />
                      </Tooltip>
                    ) : (
                      <Chip size="small" label={chip.label} color={chip.color} />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(j.createdAt)}</TableCell>
                  <TableCell align="right">
                    {j.kind === 'export' && j.hasArtifact ? (
                      <IconButton
                        size="small"
                        component="a"
                        href={`/api/jobs/export/${j.id}/artifact`}
                        data-testid="job-download"
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      size="small"
                      onClick={() =>
                        del.mutate({ workspaceId, kind: j.kind, jobId: j.id })
                      }
                      disabled={del.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <ImportWizardDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        workspaceId={workspaceId}
      />
      <BulkExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        workspaceId={workspaceId}
      />
    </SettingsCard>
  )
}
```

- [ ] **Step 5: Register the section in `workspace-settings-dialog.tsx`**

1. Extend the union: add `| 'import-export'` to `SettingsSectionSlug`.
2. Import: `import { ImportExportSection } from './import-export-section'` and `ImportExportIcon` via the existing `@repo/ui/components` icon import.
3. Add to the `items` array AFTER the `'files'` entry:

```tsx
    {
      slug: 'import-export',
      label: 'Импорт и экспорт',
      icon: <ImportExportIcon fontSize="small" />,
      show: true,
      render: () => <ImportExportSection workspaceId={workspaceId} />,
    },
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter web exec vitest run test/import-export-helpers.test.ts && pnpm --filter web check-types && pnpm --filter web lint
```

Then run `pnpm --filter web build` once here — this is the step that catches a client component accidentally pulling server-only modules.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/import-export apps/web/src/components/workspace/settings/import-export-section.tsx apps/web/src/components/workspace/settings/workspace-settings-dialog.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): Import/Export Center — settings section, import wizard, export dialog"
```

---

## Task 17: «Экспортировать с подстраницами…» in the page actions menu

**Files:**
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`

- [ ] **Step 1: Add the menu item + dialog.** In `page-actions-menu.tsx`:

1. Import: `import { BulkExportDialog } from '@/components/import-export/bulk-export-dialog'` and add `DownloadIcon` to the existing `@repo/ui/components` import.
2. State next to `exportOpen` (line ~72): `const [bulkExportOpen, setBulkExportOpen] = useState(false)`.
3. Menu item directly AFTER the existing «Экспортировать» MenuItem (line ~205) — NOT disabled by page type (subtree export handles all types):

```tsx
        <MenuItem
          onClick={() => {
            setBulkExportOpen(true)
            closeMenu()
          }}
          sx={menuItemSx}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Экспортировать с подстраницами…</ListItemText>
        </MenuItem>
```

4. Dialog render next to the existing `<PageExportDialog … />`:

```tsx
      <BulkExportDialog
        open={bulkExportOpen}
        onClose={() => setBulkExportOpen(false)}
        workspaceId={workspaceId}
        preset={{
          pageId,
          pageTitle: pages.find((p) => p.id === pageId)?.title ?? '',
        }}
      />
```

(`workspaceId`, `pageId`, `pages` are existing props of this component — see lines 55-69 and the `MovePageDialog` usage.)

- [ ] **Step 2: Verify** — `pnpm --filter web check-types && pnpm --filter web lint`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/page/page-actions-menu.tsx
git commit -m "feat(web): subtree zip export entry in the page actions menu"
```

---

## Task 18: E2E — import a fixture ZIP, export a subtree

**Files:**
- Create: `apps/e2e/fixtures/import-sample.zip` (generated binary, committed)
- Create: `apps/e2e/import-export.spec.ts`

- [ ] **Step 1: Generate and commit the fixture**

```bash
cd apps/web && node --input-type=module -e "
import { zipSync, strToU8 } from 'fflate'
import { writeFileSync, mkdirSync } from 'node:fs'
const files = {
  'Проект.md': strToU8('# Проект\n\nКорневая страница. См. [план](Проект/План.md).\n'),
  'Проект/План.md': strToU8('# План\n\n- [ ] Первый пункт\n- [x] Второй пункт\n'),
  'Проект/Заметки.md': strToU8('# Заметки\n\nПростой текст.\n'),
}
mkdirSync('../e2e/fixtures', { recursive: true })
writeFileSync('../e2e/fixtures/import-sample.zip', zipSync(files))
console.log('fixture written')
" && cd ..
```

- [ ] **Step 2: Find how existing specs open workspace settings**

Run: `grep -rn "Настройки" apps/e2e --include="*.spec.ts" -l | head -3` and read the first hit's open-settings sequence. The settings dialog opens via `useSettingsDialog().open()` triggers in the sidebar (space menu). Reuse the existing pattern verbatim in the helper below; if no spec opens settings yet, the sequence is: click the workspace/space menu button in the sidebar header, then click the «Настройки» menu item.

- [ ] **Step 3: Write `apps/e2e/import-export.spec.ts`**

```ts
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// Adapt this helper to the project's actual open-settings pattern found in Step 2.
async function openImportExportSettings(page: Page) {
  await page.getByTestId('space-menu-button').or(page.getByText('Настройки').first()).click()
  await page.getByText('Настройки', { exact: true }).first().click()
  await page.getByText('Импорт и экспорт', { exact: true }).click()
}

test.describe('import/export center', () => {
  test('imports a zip into a nested page tree', async ({ page }) => {
    await signUpAndAuthAs(page, 'import-zip')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'import-sample.zip'))
    await page.getByTestId('import-submit').click()

    // The wizard switches to the success state; the job table reaches "Готово".
    await expect(page.getByTestId('import-wizard').getByText('Импорт запущен')).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()
    await expect(
      page.getByTestId('job-row').filter({ hasText: 'Импорт' }).getByText('Готово'),
    ).toBeVisible({ timeout: 60_000 })

    // Close settings and verify the tree.
    await page.keyboard.press('Escape')
    await expect(page.getByText('Проект', { exact: true })).toBeVisible({ timeout: 15_000 })
  })

  test('exports the workspace as a markdown zip with a download link', async ({ page }) => {
    await signUpAndAuthAs(page, 'export-zip')
    await openImportExportSettings(page)

    await page.getByTestId('open-export').click()
    await page.getByTestId('export-submit').click()
    await expect(page.getByText('Экспорт запущен')).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть' }).click()

    await expect(
      page.getByTestId('job-row').filter({ hasText: 'Экспорт' }).getByText('Готово'),
    ).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('job-download')).toBeVisible()
    const href = await page.getByTestId('job-download').getAttribute('href')
    expect(href).toContain('/api/jobs/export/')
  })
})
```

- [ ] **Step 4: Run** (compose must be up; dev-server cold-compile flakes are known — use retries locally)

```bash
pnpm exec playwright test apps/e2e/import-export.spec.ts --retries=2
```

Expected: 2 passed. Locator adjustments to the settings-open sequence are expected — adapt the helper, not the assertions. (Export test note: a fresh user's workspace contains the seeded welcome/start page, so the workspace export has ≥1 page and completes DONE.)

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/fixtures/import-sample.zip apps/e2e/import-export.spec.ts
git commit -m "test(e2e): import zip → page tree, workspace export → artifact download"
```

---

## Task 19: Changelog + full gates

**Files:**
- Modify: `docs/changelog.md`

- [ ] **Step 1: Add to the top of the «Готовится» section** (before «История страниц и уведомления»):

```md
**Импорт и экспорт**

- Центр «Импорт и экспорт» в настройках пространства: запускайте задания, следите за прогрессом, скачивайте готовые архивы.
- Импорт Markdown/HTML-файлов и ZIP-архивов: структура папок становится деревом страниц, картинки загружаются в хранилище, ссылки между файлами превращаются во внутренние.
- Экспорт всего пространства, раздела или страницы с подстраницами в ZIP (Markdown или HTML) — с учётом прав доступа: чужие личные страницы и скрытые строки баз данных в архив не попадают.
- Пункт «Экспортировать с подстраницами…» в меню страницы.
- Архив экспорта хранится 7 дней и доступен только автору задания.
```

- [ ] **Step 2: Full gates from the worktree root**

```bash
pnpm gates
```

Expected: check-types, lint, check-architecture, build, test — ALL green. Likely trip-points and their owners: stale `.next/types` after new routes (`rm -rf apps/web/.next/types` and re-run), a missing `@repo/ui` re-export (add it), a mocked-tRPC unit test that now sees the new `job` router (update the mock).

- [ ] **Step 3: Commit**

```bash
git add docs/changelog.md
git commit -m "docs(changelog): import/export center"
```

---

## Completion

After all tasks: the controller requests an independent code review (superpowers:requesting-code-review) focused on (1) the export visibility boundary, (2) artifact owner-gating, (3) import idempotency under reclaim races, (4) the SVG/text-html upload-MIME security decisions — then merges via the established fast-forward checkpoint flow.

## Self-review (performed at plan-writing time)

- Spec coverage: jobs infra + reclaim (Tasks 1, 13, 14), import MD/HTML/ZIP + destination + idempotency (3-6, 9), export 3 scopes × 2 formats + access boundary (7, 10-12), artifact gate + expiry (15), Center UI + page-menu entry (16-17), E2E + docs (18-19). Spec §5's "images become real files" → Task 12 asset bundling; §6 contentYjs → Task 5.
- Known deltas from spec (flagged in header): `options.location` instead of `collectionId`; SVG excluded from assets; artifact S3 physical cleanup deferred (route 404s after expiry; spec already lists GC as follow-up).
- Type consistency: `ImportPlan/ImportNode` (Task 6) consumed by Task 9; `ExportPageRecord/ExportScope` (Task 10) by Task 12; `JobRunnerPort` (Task 13) by Task 14's `ctx.jobs.kick`; `streamToBuffer` exported from Task 9 and reused in Tasks 12/15 tests; `relativePath` (Task 7) used by Task 11.
