# Phase 6B — Import Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Notion export-ZIP parser (page tree + CSV→real databases + link rewriting via hex-id aliases), Confluence HTML-ZIP importer, Yandex Wiki labeled path, honest-unavailable Asana/Monday, and a downloadable per-job import journal — per `docs/superpowers/specs/2026-06-10-import-sources-design.md`.

**Architecture:** `ImportJob.source` (GENERIC|NOTION|CONFLUENCE|YANDEX_WIKI) selects a plan builder in `processImportJob`; all builders return the 6A `ImportPlan` shape extended with `aliases` (in-memory alias→sourceKey map for link resolution; recomputed deterministically on resume) and `databases` (CSV blueprints materialized after the page pass through a `domain.database` port). The journal is accumulated through the run and written as the reserved `ImportArtifact(kind: REPORT)`.

**Tech Stack:** everything from 6A (fflate, marked, turndown, linkedom, Prisma 7, tRPC v11); **no new dependencies** (CSV parser hand-rolled).

---

## Worker ground rules (every task)

- Worktree: `/Users/victor/.config/superpowers/worktrees/anynote/notion-phase-6b-import-sources`, branch `feat/notion-phase-6b-import-sources`. Commands run from the worktree root.
- Prettier: semi false, single quotes, trailing commas, 100-char width. **Never `git add -A`** — explicit paths only (untracked `cl*.md` in the repo root must never be committed). Conventional Commits with scope.
- Real-DB tests need `docker compose up -d` (it's up). apps/web + packages/trpc test setups load the root `.env`.
- The 6A import pipeline is COMMITTED on this branch — read the actual files before modifying:
  `apps/web/src/server/jobs/process-import-job.ts` (claim → plan → createNode with P2002 race recovery → storeAssets → rewriteImportedLinks), `apps/web/src/server/page-import/zip-plan.ts` (ImportPlan/ImportNode/normalizeEntryPath/buildImportPlan), `rewrite-links.ts`, `markdown-to-tiptap.ts` (parseMarkdownDocument), `html-to-tiptap.ts` (parseHtmlDocument), `content-yjs.ts`, `packages/trpc/src/routers/job.ts`, `apps/web/src/app/api/jobs/export/[jobId]/artifact/route.ts`, `apps/web/src/components/import-export/*`.
- Domain database facts (verified): `PageService.create({type: DATABASE})` auto-runs `seedDefaults` → a TABLE view «Таблица» + a STATUS property «Статус» with options ids `status-not-started|status-in-progress|status-done`; the Title column is implicit (`Page.title`), never a property. `domain.database.createProperty(actor, {pageId, type, name, settings?})`; `deleteProperty(actor, {pageId, id})`; `createRow(actor, {pageId, title?}) → {rowId, pageId}`; `updateCellValue(actor, {pageId, rowId, propertyId, value, dateValue?})`. Cell value shapes: SELECT/STATUS = option-ID string (validated against `settings.options[].id` — options MUST exist before the cell write, values are ids NOT labels); MULTI_SELECT = string[] of ids; CHECKBOX = boolean; DATE = pass an ISO string via `value` (the service re-parses) ; NUMBER = number (finite); URL must be http/https; EMAIL/PHONE regex-validated; TEXT = string. `SelectOption = {id, label, color?}`. The job owner created the DATABASE page, so `requireStructureEdit` passes for them.
- The 6A GENERIC flow must stay byte-identical — its tests are the regression net.

### Sub-phases / task map

A) Schema (Task 1) → B) pure modules (Tasks 2–7, TDD) → C) processor integration (Tasks 8–9) → D) API (Task 10) → E) UI + E2E (Tasks 11–12) → F) changelog + gates (Task 13).

---

## Task 1: Schema — ImportSource enum + ImportJob.source

**Files:** Modify `packages/db/prisma/schema.prisma`; Create migration `packages/db/prisma/migrations/20260610170000_import_source/migration.sql`.

- [ ] **Step 1:** Add the enum next to `ImportJobFormat` and the column on `ImportJob` (after `format`):

```prisma
enum ImportSource {
  GENERIC
  NOTION
  CONFLUENCE
  YANDEX_WIKI
}
```
```prisma
  source      ImportSource    @default(GENERIC)
```

- [ ] **Step 2:** Generate via schema-to-schema diff (the established shared-DB-safe flow):
```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-before-6b.prisma
mkdir -p packages/db/prisma/migrations/20260610170000_import_source
pnpm --filter @repo/db exec prisma migrate diff --from-schema /tmp/schema-before-6b.prisma --to-schema prisma/schema.prisma --script > packages/db/prisma/migrations/20260610170000_import_source/migration.sql
```
(Prisma 7.7 flag names are `--from-schema`/`--to-schema`; strip any non-SQL log line from the output top.) Inspect: exactly one `CREATE TYPE "ImportSource"` + one `ALTER TABLE "import_jobs" ADD COLUMN "source" ... NOT NULL DEFAULT 'GENERIC'` — nothing else, or STOP.

- [ ] **Step 3:** Apply + record + regenerate (psql lives in the `anynote-postgres-1` container; parse user/db from DATABASE_URL in `.env`):
```bash
docker exec anynote-postgres-1 psql -U <user> -d <db> -f - < packages/db/prisma/migrations/20260610170000_import_source/migration.sql   # or -c per statement
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260610170000_import_source
pnpm --filter @repo/db prisma:generate
```
Verify the column: `docker exec anynote-postgres-1 psql -U <user> -d <db> -c "\d import_jobs" | grep source`.

- [ ] **Step 4:** Commit:
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260610170000_import_source
git commit -m "feat(db): ImportJob.source enum column (GENERIC/NOTION/CONFLUENCE/YANDEX_WIKI)"
```

---

## Task 2: Notion name/id helpers (pure, TDD)

**Files:** Create `apps/web/src/server/page-import/notion/notion-name.ts`; Test `apps/web/test/server/notion-name.test.ts`.

- [ ] **Step 1 — failing tests:**

```ts
import { describe, expect, it } from 'vitest'

import {
  cleanNotionPath,
  extractNotionIdFromHref,
  splitNotionName,
} from '../../src/server/page-import/notion/notion-name'

const ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

describe('splitNotionName', () => {
  it('strips a trailing 32-hex id from a name', () => {
    expect(splitNotionName(`Проект ${ID}`)).toEqual({ title: 'Проект', notionId: ID })
  })
  it('handles extensions kept by the caller (no ext logic here)', () => {
    expect(splitNotionName('Проект')).toEqual({ title: 'Проект', notionId: null })
  })
  it('does not strip non-hex or short suffixes', () => {
    expect(splitNotionName('Отчёт 2024')).toEqual({ title: 'Отчёт 2024', notionId: null })
    expect(splitNotionName(`X ${ID.slice(0, 31)}`)).toEqual({
      title: `X ${ID.slice(0, 31)}`,
      notionId: null,
    })
  })
  it('keeps a fallback title when the name is ONLY an id', () => {
    expect(splitNotionName(ID)).toEqual({ title: 'Без названия', notionId: ID })
  })
})

describe('cleanNotionPath', () => {
  it('cleans every segment and keeps the extension, returning ids in order', () => {
    expect(cleanNotionPath(`Раздел ${ID}/Стр ${ID}.md`)).toEqual({
      cleaned: 'Раздел/Стр.md',
      ids: [ID, ID],
    })
  })
})

describe('extractNotionIdFromHref', () => {
  it('finds the id in encoded relative hrefs', () => {
    expect(extractNotionIdFromHref(`%D0%A1%D1%82%D1%80%20${ID}.md`)).toBe(ID)
  })
  it('finds the id in notion.so URLs', () => {
    expect(extractNotionIdFromHref(`https://www.notion.so/ws/My-Page-${ID}`)).toBe(ID)
    expect(extractNotionIdFromHref(`https://www.notion.so/${ID}`)).toBe(ID)
  })
  it('returns null when no id present', () => {
    expect(extractNotionIdFromHref('plain.md')).toBeNull()
    expect(extractNotionIdFromHref('https://example.com/x')).toBeNull()
  })
})
```

Run: `pnpm --filter web exec vitest run test/server/notion-name.test.ts` → FAIL (module not found).

- [ ] **Step 2 — implement:**

```ts
const TRAILING_ID_RE = /\s([0-9a-f]{32})$/i
const ONLY_ID_RE = /^([0-9a-f]{32})$/i
const HREF_ID_RE = /(?:^|[\s/_-])([0-9a-f]{32})(?:\.(?:md|html|csv))?(?:[?#]|$)/i

export function splitNotionName(name: string): { title: string; notionId: string | null } {
  const only = ONLY_ID_RE.exec(name.trim())
  if (only) return { title: 'Без названия', notionId: only[1]!.toLowerCase() }
  const m = TRAILING_ID_RE.exec(name)
  if (!m) return { title: name, notionId: null }
  const title = name.slice(0, m.index).trim() || 'Без названия'
  return { title, notionId: m[1]!.toLowerCase() }
}

/** Clean every path segment of its Notion id suffix; the extension survives. */
export function cleanNotionPath(path: string): { cleaned: string; ids: string[] } {
  const ids: string[] = []
  const cleaned = path
    .split('/')
    .map((seg) => {
      const dot = seg.lastIndexOf('.')
      const ext = dot > 0 ? seg.slice(dot) : ''
      const stem = dot > 0 ? seg.slice(0, dot) : seg
      const { title, notionId } = splitNotionName(stem)
      if (notionId) ids.push(notionId)
      return `${title}${ext}`
    })
    .join('/')
  return { cleaned, ids }
}

/** Extract a Notion 32-hex page id from a (possibly URL-encoded) href or notion.so URL. */
export function extractNotionIdFromHref(href: string): string | null {
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    // keep raw on malformed escapes
  }
  const m = HREF_ID_RE.exec(decoded)
  return m ? m[1]!.toLowerCase() : null
}
```

- [ ] **Step 3:** run → PASS (8 tests). **Step 4 — commit:**
```bash
git add apps/web/src/server/page-import/notion/notion-name.ts apps/web/test/server/notion-name.test.ts
git commit -m "feat(web): notion name/id parsing helpers"
```

---

## Task 3: rewrite-links — external resolver hook (pure, TDD)

**Files:** Modify `apps/web/src/server/page-import/rewrite-links.ts`; extend test `apps/web/test/server/rewrite-links.test.ts`.

Notion docs link both via relative paths AND absolute `https://www.notion.so/...` URLs; the current pass skips ALL external hrefs. Add an optional hook consulted for external hrefs only.

- [ ] **Step 1 — failing test** (append to the existing describe):

```ts
  it('consults resolveExternal for absolute hrefs when provided', () => {
    const doc = markdownToTiptap(
      '[n](https://www.notion.so/ws/Page-a1b2c3d4e5f60718293a4b5c6d7e8f90) [e](https://example.com)',
    )
    const { doc: out, changed } = rewriteRelativeLinks(doc, {
      sourceKey: 'a.md',
      resolve: () => null,
      resolveExternal: (href) => (href.includes('notion.so') ? '/pages/p-9' : null),
    })
    expect(changed).toBe(true)
    const s = JSON.stringify(out)
    expect(s).toContain('"href":"/pages/p-9"')
    expect(s).toContain('https://example.com')
  })
```

- [ ] **Step 2 — implement:** extend the args type with `resolveExternal?: (href: string) => string | null`; in `visit`, where `isExternal(href)` currently short-circuits with `return m`, change to:

```ts
        if (!href) return m
        if (isExternal(href)) {
          const ext = args.resolveExternal?.(href) ?? null
          if (!ext) return m
          changed = true
          return { ...m, attrs: { ...m.attrs, href: ext } }
        }
```

- [ ] **Step 3:** run the FULL rewrite-links + markdown test files (no regressions) → PASS. **Step 4 — commit:**
```bash
git add apps/web/src/server/page-import/rewrite-links.ts apps/web/test/server/rewrite-links.test.ts
git commit -m "feat(web): external-href resolver hook in import link rewriting"
```

---

## Task 4: RFC-4180 CSV parser (pure, TDD, no deps)

**Files:** Create `apps/web/src/server/page-import/csv.ts`; Test `apps/web/test/server/csv.test.ts`.

- [ ] **Step 1 — failing tests:**

```ts
import { describe, expect, it } from 'vitest'

import { parseCsv } from '../../src/server/page-import/csv'

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })
  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('a,"b,c"\n"x ""y""","line1\nline2"')).toEqual([
      ['a', 'b,c'],
      ['x "y"', 'line1\nline2'],
    ])
  })
  it('tolerates BOM and CRLF and trailing newline', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('returns [] for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n')).toEqual([])
  })
})
```

- [ ] **Step 2 — implement** a single-pass state machine:

```ts
/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, embedded commas/newlines, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }
  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      pushField()
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      pushRow()
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field !== '' || row.length > 0) pushRow()
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}
```

- [ ] **Step 3:** run → PASS (4 tests). **Step 4 — commit:**
```bash
git add apps/web/src/server/page-import/csv.ts apps/web/test/server/csv.test.ts
git commit -m "feat(web): rfc-4180 csv parser for imports"
```

---

## Task 5: Column type inference + value mapping (pure, TDD)

**Files:** Create `apps/web/src/server/page-import/infer-columns.ts`; Test `apps/web/test/server/infer-columns.test.ts`.

Maps CSV columns to database property types + converts raw cells to DOMAIN cell values (option IDS, not labels). Reused by 6C.

- [ ] **Step 1 — failing tests:**

```ts
import { describe, expect, it } from 'vitest'

import { inferColumns } from '../../src/server/page-import/infer-columns'

const infer = (name: string, values: string[]) => inferColumns([name], values.map((v) => [v]))[0]!

describe('inferColumns', () => {
  it('infers NUMBER (incl. comma decimals) with numeric toValue', () => {
    const c = infer('Кол-во', ['1', '2,5', '-3'])
    expect(c.type).toBe('NUMBER')
    expect(c.toValue('2,5')).toBe(2.5)
  })
  it('infers CHECKBOX from yes/no variants', () => {
    const c = infer('Готово', ['Yes', 'No', 'Да', ''])
    expect(c.type).toBe('CHECKBOX')
    expect(c.toValue('Да')).toBe(true)
    expect(c.toValue('No')).toBe(false)
  })
  it('infers DATE and emits ISO strings', () => {
    const c = infer('Срок', ['May 1, 2024', '2024-06-02'])
    expect(c.type).toBe('DATE')
    expect(c.toValue('2024-06-02')).toMatch(/^2024-06-02T/)
  })
  it('infers URL/EMAIL/PHONE by pattern', () => {
    expect(infer('Сайт', ['https://a.com', 'http://b.io']).type).toBe('URL')
    expect(infer('Почта', ['a@b.co', 'x@y.io']).type).toBe('EMAIL')
    expect(infer('Тел', ['+7 999 123-45-67']).type).toBe('PHONE')
  })
  it('infers SELECT with options and maps labels to option ids', () => {
    const c = infer('Статус', ['Open', 'Done', 'Open', 'Done', 'Open'])
    expect(c.type).toBe('SELECT')
    expect(c.options!.map((o) => o.label).sort()).toEqual(['Done', 'Open'])
    const id = c.options!.find((o) => o.label === 'Open')!.id
    expect(c.toValue('Open')).toBe(id)
  })
  it('infers MULTI_SELECT when values contain comma-separated parts', () => {
    const c = infer('Теги', ['a, b', 'b', 'a, c', 'c', 'b'])
    expect(c.type).toBe('MULTI_SELECT')
    expect(c.options!.map((o) => o.label).sort()).toEqual(['a', 'b', 'c'])
    const ids = c.toValue('a, c') as string[]
    expect(ids).toHaveLength(2)
  })
  it('falls back to TEXT for free text or all-distinct values', () => {
    const c = infer('Описание', ['Первый длинный текст', 'второй', 'третий', 'четвёртый'])
    expect(c.type).toBe('TEXT')
    expect(c.toValue(' x ')).toBe('x')
  })
  it('empty toValue returns null', () => {
    expect(infer('X', ['1']).toValue('')).toBeNull()
  })
})
```

Run → FAIL.

- [ ] **Step 2 — implement** `apps/web/src/server/page-import/infer-columns.ts`:

```ts
export type InferredType =
  | 'TEXT'
  | 'NUMBER'
  | 'CHECKBOX'
  | 'DATE'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'URL'
  | 'EMAIL'
  | 'PHONE'

export type InferredOption = { id: string; label: string; color: string | null }

export type InferredColumn = {
  name: string
  type: InferredType
  options?: InferredOption[]
  /** Convert a raw CSV cell to the DOMAIN cell value (option ids, numbers, ISO dates…); null = empty. */
  toValue: (raw: string) => string | number | boolean | string[] | null
}

const NUM_RE = /^-?\d+(?:[.,]\d+)?$/
const TRUE_SET = new Set(['yes', 'true', 'да', '✓', 'x', '1', 'checked'])
const FALSE_SET = new Set(['no', 'false', 'нет', '', '0', 'unchecked'])
const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s().-]{7,}$/
// Date-ish guard so pure numbers/codes don't pass Date.parse coincidentally.
const DATEISH_RE = /^(\d{4}-\d{2}-\d{2}|[A-Za-zА-Яа-я]{3,}\s+\d{1,2},?\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{2,4})/

const OPTION_COLORS = ['#9CA3AF', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

const MAX_SELECT_OPTIONS = 24
const MAX_OPTION_LABEL = 60

export function inferColumns(header: string[], rows: string[][]): InferredColumn[] {
  return header.map((name, idx) => {
    const values = rows.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '')
    return buildColumn(name.trim() || `Колонка ${idx + 1}`, values)
  })
}

function buildColumn(name: string, values: string[]): InferredColumn {
  if (values.length === 0) return textColumn(name)
  const lower = values.map((v) => v.toLowerCase())

  if (values.every((v) => NUM_RE.test(v))) {
    return {
      name,
      type: 'NUMBER',
      toValue: (raw) => {
        const t = raw.trim()
        if (!t) return null
        const n = Number.parseFloat(t.replace(',', '.'))
        return Number.isFinite(n) ? n : null
      },
    }
  }
  if (lower.every((v) => TRUE_SET.has(v) || FALSE_SET.has(v))) {
    return {
      name,
      type: 'CHECKBOX',
      toValue: (raw) => {
        const t = raw.trim().toLowerCase()
        if (!t) return null
        return TRUE_SET.has(t)
      },
    }
  }
  if (values.every((v) => DATEISH_RE.test(v) && !Number.isNaN(Date.parse(v)))) {
    return {
      name,
      type: 'DATE',
      toValue: (raw) => {
        const t = raw.trim()
        if (!t) return null
        const d = new Date(t)
        return Number.isNaN(d.getTime()) ? null : d.toISOString()
      },
    }
  }
  if (values.every((v) => URL_RE.test(v))) return patternColumn(name, 'URL')
  if (values.every((v) => EMAIL_RE.test(v))) return patternColumn(name, 'EMAIL')
  if (values.every((v) => PHONE_RE.test(v))) return patternColumn(name, 'PHONE')

  // SELECT / MULTI_SELECT: bounded distinct short labels with repeats.
  const isMulti = values.some((v) => v.includes(', '))
  const parts = isMulti ? values.flatMap((v) => v.split(', ').map((p) => p.trim())) : values
  const distinct = [...new Set(parts.filter((p) => p !== ''))]
  const shortEnough = distinct.every((p) => p.length <= MAX_OPTION_LABEL)
  const hasRepeats = parts.length > distinct.length
  if (distinct.length > 0 && distinct.length <= MAX_SELECT_OPTIONS && shortEnough && hasRepeats) {
    const options: InferredOption[] = distinct.map((label, i) => ({
      id: `opt-${i + 1}`,
      label,
      color: OPTION_COLORS[i % OPTION_COLORS.length] ?? null,
    }))
    const idByLabel = new Map(options.map((o) => [o.label, o.id]))
    if (isMulti) {
      return {
        name,
        type: 'MULTI_SELECT',
        options,
        toValue: (raw) => {
          const ids = raw
            .split(', ')
            .map((p) => idByLabel.get(p.trim()))
            .filter((id): id is string => Boolean(id))
          return ids.length > 0 ? ids : null
        },
      }
    }
    return {
      name,
      type: 'SELECT',
      options,
      toValue: (raw) => idByLabel.get(raw.trim()) ?? null,
    }
  }
  return textColumn(name)
}

function textColumn(name: string): InferredColumn {
  return { name, type: 'TEXT', toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}

function patternColumn(name: string, type: 'URL' | 'EMAIL' | 'PHONE'): InferredColumn {
  return { name, type, toValue: (raw) => (raw.trim() ? raw.trim() : null) }
}
```

- [ ] **Step 3:** run → PASS (8 tests). **Step 4 — commit:**
```bash
git add apps/web/src/server/page-import/infer-columns.ts apps/web/test/server/infer-columns.test.ts
git commit -m "feat(web): csv column type inference with domain value mapping"
```

---

## Task 6: zip-plan core extraction + Notion plan builder (TDD)

**Files:** Modify `apps/web/src/server/page-import/zip-plan.ts` (extract a reusable core — behavior-identical); Create `apps/web/src/server/page-import/notion/notion-plan.ts`; Test `apps/web/test/server/notion-plan.test.ts`.

- [ ] **Step 1 — refactor zip-plan (no behavior change):** extract the classification+tree body of `buildImportPlan` into an exported `buildPlanFromFiles(files: Array<{ path: string; bytes: Uint8Array }>): ImportPlan` that takes ALREADY-normalized paths; `buildImportPlan` becomes: unzip (ImportSourceError on corrupt) → normalize each entry (skip dir markers/null) → `buildPlanFromFiles`. Run the FULL existing suite (`pnpm --filter web exec vitest run test/server/zip-plan.test.ts test/server/process-import-job.test.ts`) — green before proceeding (this is the 6A regression net).

- [ ] **Step 2 — failing tests** for the Notion builder (`apps/web/test/server/notion-plan.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { buildNotionImportPlan } from '../../src/server/page-import/notion/notion-plan'

const ID1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ID2 = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'
const ID3 = 'c3d4e5f60718293a4b5c6d7e8f90a1b2'

describe('buildNotionImportPlan', () => {
  it('cleans id suffixes from titles/paths and registers aliases (raw path + hex id)', () => {
    const plan = buildNotionImportPlan(
      zipSync({
        [`Проект ${ID1}.md`]: strToU8('# Проект'),
        [`Проект ${ID1}/Стр ${ID2}.md`]: strToU8('тело'),
      }),
    )
    expect(plan.roots).toHaveLength(1)
    expect(plan.roots[0]!.name).toBe('Проект')
    expect(plan.roots[0]!.children[0]!.name).toBe('Стр')
    // Aliases point at the CLEANED sourceKeys.
    const childKey = plan.roots[0]!.children[0]!.sourceKey
    expect(plan.aliases.get(ID2)).toBe(childKey)
    expect(plan.aliases.get(`Проект ${ID1}/Стр ${ID2}.md`)).toBe(childKey)
  })

  it('detects a database CSV with row docs: blueprint extracted, row docs leave the page tree', () => {
    const csv = 'Name,Status,Count\nЗадача А,Open,1\nЗадача Б,Done,2\nЗадача В,Open,3\n'
    const plan = buildNotionImportPlan(
      zipSync({
        [`База ${ID1}.csv`]: strToU8(csv),
        [`База ${ID1}/Задача А ${ID2}.md`]: strToU8('# Задача А\n\nтело А'),
        [`База ${ID1}/Задача Б ${ID3}.md`]: strToU8('# Задача Б'),
      }),
    )
    expect(plan.databases).toHaveLength(1)
    const bp = plan.databases[0]!
    expect(bp.title).toBe('База')
    expect(bp.header).toEqual(['Name', 'Status', 'Count'])
    expect(bp.rows).toHaveLength(3)
    expect(bp.rowDocs.get('Задача А')).toBeDefined()
    expect(bp.rowAliasIds.get('Задача А')).toBe(ID2)
    // Row docs are NOT regular tree nodes; the db page is materialized separately.
    expect(plan.roots).toHaveLength(0)
    expect(plan.totalPages).toBe(1 + 3) // db page + 3 rows
  })

  it('drops the _all.csv duplicate', () => {
    const csv = 'Name\nA\n'
    const plan = buildNotionImportPlan(
      zipSync({
        [`База ${ID1}.csv`]: strToU8(csv),
        [`База ${ID1}_all.csv`]: strToU8(csv),
      }),
    )
    expect(plan.databases).toHaveLength(1)
  })

  it('dedups cleaned-name collisions deterministically', () => {
    const plan = buildNotionImportPlan(
      zipSync({
        [`Стр ${ID1}.md`]: strToU8('a'),
        [`Стр ${ID2}.md`]: strToU8('b'),
      }),
    )
    const names = plan.roots.map((r) => r.name).sort()
    expect(new Set(plan.roots.map((r) => r.sourceKey)).size).toBe(2)
    expect(names[0]).toBe('Стр')
    expect(names[1]).toMatch(/^Стр 2$/)
  })

  it('warns on unsupported entries like everything else', () => {
    const plan = buildNotionImportPlan(zipSync({ 'x.pdf': strToU8('x') }))
    expect(plan.warnings.length).toBe(1)
  })
})
```

Run → FAIL.

- [ ] **Step 3 — implement** `apps/web/src/server/page-import/notion/notion-plan.ts`. Shape:

```ts
import { unzipSync } from 'fflate'

import { parseCsv } from '../csv'
import {
  buildPlanFromFiles,
  ImportSourceError,
  normalizeEntryPath,
  type ImportDoc,
  type ImportPlan,
} from '../zip-plan'
import { cleanNotionPath, splitNotionName } from './notion-name'

export type NotionDatabaseBlueprint = {
  /** Mapping key for the DATABASE page (the csv's cleaned path). */
  sourceKey: string
  /** Cleaned parent dir ('' = import root) — resolved to a parent page at materialization. */
  parentKey: string
  title: string
  notionId: string | null
  header: string[]
  rows: string[][]
  /** Row title → the row's source .md/.html doc (content merged into the item page). */
  rowDocs: Map<string, ImportDoc>
  /** Row title → the row doc's notion id (registered as a row alias). */
  rowAliasIds: Map<string, string>
}

export type NotionImportPlan = ImportPlan & {
  aliases: Map<string, string>
  databases: NotionDatabaseBlueprint[]
}

export function buildNotionImportPlan(zipBytes: Uint8Array): NotionImportPlan
```

Algorithm (follow precisely):
1. `unzipSync` with the same corrupt-zip ImportSourceError; iterate entries, skip `/`-suffixed markers, `normalizeEntryPath` (null → skip).
2. For each raw path compute `cleanNotionPath` → `{cleaned, ids}`. Collision dedup: keep a `Map<cleanedLower, count>`; on collision append ` ${n}` to the STEM of the final segment (before the extension) — deterministic by entry iteration order, test expects «Стр 2».
3. Classify: `.csv` with a non-`_all` stem → database candidate (record raw dir name = raw path minus `.csv`); `_all.csv` → skip when the non-_all twin exists, else treat as the candidate (strip `_all` from the stem first); docs/assets/others exactly like the generic builder.
4. For each database candidate: parse CSV (`parseCsv`); header = first row; rows = rest; title/notionId from `splitNotionName(stem)`. Its ROW DOCS are the doc entries living in the matching raw dir (`<csvRawStem>/...`) — match by raw path prefix. For each row doc: cleaned title from its filename (`splitNotionName`), store in `rowDocs` (first wins) + `rowAliasIds`. EXCLUDE those docs AND the dir from the page-tree file list. The csv file itself is also excluded from the tree.
5. Remaining files (docs with CLEANED paths + assets with cleaned paths) → `buildPlanFromFiles`. NOTE assets: image srcs inside Notion markdown reference the RAW (id-suffixed, URL-encoded) paths; the processor resolves image srcs through `resolveImageSrc` against asset keys — so register assets under their RAW path too: simplest correct approach is to key assets by BOTH cleaned and raw paths (two map entries pointing to the same bytes — dedup by content hash downstream makes this free). Implement by passing the asset twice in the file list ONLY if `buildPlanFromFiles` keys assets by path (it does — verify; otherwise add raw→cleaned asset aliasing to the `aliases` map and have the processor consult aliases in resolveImageSrc — choose the implementation that makes the Task 9 integration test pass without touching the generic flow).
6. `aliases`: for every doc node sourceKey: raw path → sourceKey, and each path-segment id (LAST segment's id) → sourceKey. For databases: notionId → bp.sourceKey, raw csv path → bp.sourceKey.
7. `totalPages` += per blueprint (1 + rows.length).
8. Warnings: one summary line «Комментарии, права доступа и история Notion не переносятся» pushed once when any entry was processed; unsupported entries per the generic rule.

- [ ] **Step 4:** run → PASS (5 tests) + the regression suites from Step 1 stay green. **Step 5 — commit:**
```bash
git add apps/web/src/server/page-import/zip-plan.ts apps/web/src/server/page-import/notion/notion-plan.ts apps/web/test/server/notion-plan.test.ts
git commit -m "feat(web): notion export zip plan builder with aliases and database blueprints"
```

---

## Task 7: Confluence plan builder + ImportJournal (TDD)

**Files:** Create `apps/web/src/server/page-import/confluence/confluence-plan.ts`, `apps/web/src/server/page-import/journal.ts`; Tests `apps/web/test/server/confluence-plan.test.ts`, `apps/web/test/server/import-journal.test.ts`.

- [ ] **Step 1 — failing tests.** `confluence-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'

import { buildConfluenceImportPlan } from '../../src/server/page-import/confluence/confluence-plan'

const PAGE = (title: string, body: string) =>
  `<html><head><title>${title} - Мой Confluence</title></head><body>
   <div id="breadcrumbs">Хлебные крошки</div>
   <div id="main-content"><h1>${title}</h1><p>${body}</p></div>
   <div id="footer">Generated by Confluence</div></body></html>`

describe('buildConfluenceImportPlan', () => {
  it('imports content html pages, strips chrome, skips index.html with a note', () => {
    const plan = buildConfluenceImportPlan(
      zipSync({
        'SPACE/index.html': strToU8('<html><body>toc</body></html>'),
        'SPACE/Page-One.html': strToU8(PAGE('Первая', 'тело')),
        'SPACE/attachments/123/pic.png': new Uint8Array([1]),
      }),
    )
    const all = JSON.stringify(plan.roots)
    expect(all).toContain('Первая')
    expect(all).not.toContain('Хлебные крошки')
    expect(all).not.toContain('Generated by Confluence')
    expect(plan.assets.size).toBe(1)
    expect(plan.warnings.some((w) => w.includes('index.html'))).toBe(true)
    expect(plan.warnings.some((w) => w.includes('Confluence'))).toBe(true) // limitations note
  })
})
```

`import-journal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { ImportJournal } from '../../src/server/page-import/journal'

describe('ImportJournal', () => {
  it('accumulates actions/warnings/skips and renders a readable log', () => {
    const j = new ImportJournal('NOTION', 'export.zip')
    j.action('Создана страница «Проект»')
    j.warn('Колонка «Формула» импортирована как текст')
    j.skip('Пропущен файл «x.pdf»')
    expect(j.warnings).toEqual([
      'Колонка «Формула» импортирована как текст',
      'Пропущен файл «x.pdf»',
    ])
    const text = j.render()
    expect(text).toContain('Источник: NOTION')
    expect(text).toContain('export.zip')
    expect(text).toContain('[ok] Создана страница «Проект»')
    expect(text).toContain('[!] Колонка')
    expect(text).toContain('[skip] Пропущен')
  })
})
```

- [ ] **Step 2 — implement `journal.ts`:**

```ts
/** Per-job human-readable import journal; rendered as the REPORT artifact. */
export class ImportJournal {
  private lines: string[] = []
  private warningLines: string[] = []

  constructor(
    private readonly source: string,
    private readonly fileName: string,
  ) {}

  action(msg: string): void {
    this.lines.push(`[ok] ${msg}`)
  }

  warn(msg: string): void {
    this.lines.push(`[!] ${msg}`)
    this.warningLines.push(msg)
  }

  skip(msg: string): void {
    this.lines.push(`[skip] ${msg}`)
    this.warningLines.push(msg)
  }

  get warnings(): string[] {
    return [...this.warningLines]
  }

  render(): string {
    return [
      `Журнал импорта AnyNote`,
      `Источник: ${this.source}`,
      `Файл: ${this.fileName}`,
      '',
      ...this.lines,
      '',
      `Предупреждений: ${this.warningLines.length}`,
    ].join('\n')
  }
}
```

- [ ] **Step 3 — implement `confluence-plan.ts`:** unzip + normalize like the others; entries named `index.html` (any depth) → journal-style warning string «Пропущен index.html — оглавление не импортируется» and excluded; other `.html`/`.htm` → docs with PRE-CLEANED bytes: parse with linkedom (`parseHTML`), drop elements matching `#breadcrumbs, #footer, .page-metadata, #navigation, .pageSection.group` when present, take `#main-content`'s innerHTML if that container exists (else body), and derive the doc's display name from `<title>` text with the ` - <space>` suffix stripped (fallback: filename) — re-encode as bytes and rename the file so its stem is the cleaned title (collision-suffix like Task 6). Images under any path with image extensions → assets keyed by their full path (Confluence hrefs reference `attachments/...` relatively — same-path resolution works through the generic flow). Other attachment types → warnings («вложение не импортировано»). Feed `buildPlanFromFiles`; append the standing limitations note «Confluence: права, история, комментарии и макросы не переносятся». Return `ImportPlan & { aliases: Map<string,string> }` with raw→cleaned path aliases (for inter-page links).

- [ ] **Step 4:** run both → PASS. **Step 5 — commit:**
```bash
git add apps/web/src/server/page-import/confluence/confluence-plan.ts apps/web/src/server/page-import/journal.ts apps/web/test/server/confluence-plan.test.ts apps/web/test/server/import-journal.test.ts
git commit -m "feat(web): confluence zip plan builder + import journal"
```

---

## Task 8: CSV→database materializer (integration, real DB)

**Files:** Create `apps/web/src/server/page-import/csv-to-database.ts`; Test `apps/web/test/server/csv-to-database.test.ts`.

- [ ] **Step 1 — define the module.** Ports use the REAL domain types so the singleton is structurally assignable:

```ts
import { DatabasePropertyType, PageType, type Prisma, type PrismaClient } from '@repo/db'
import type { Domain } from '@repo/domain'

import { buildImportContentYjs } from '@/server/page-import/content-yjs'
import { parseHtmlDocument } from '@/server/page-import/html-to-tiptap'
import { parseMarkdownDocument } from '@/server/page-import/markdown-to-tiptap'
import { inferColumns, type InferredColumn } from '@/server/page-import/infer-columns'
import type { ImportJournal } from '@/server/page-import/journal'
import type { ImportDoc } from '@/server/page-import/zip-plan'
import type { PagesCreatePort } from '@/server/jobs/process-import-job'

export type DatabasePort = Pick<
  Domain['database'],
  'listProperties' | 'createProperty' | 'deleteProperty' | 'createRow' | 'updateCellValue'
>

export type CsvDatabaseBlueprint = {
  sourceKey: string
  title: string
  header: string[]
  rows: string[][]
  rowDocs?: Map<string, ImportDoc>
}

export type MaterializeContext = {
  prisma: PrismaClient
  pages: PagesCreatePort
  database: DatabasePort
}

export type MaterializeArgs = {
  actorUserId: string
  workspaceId: string
  parentPageId: string | null
  location: 'team' | 'private'
  blueprint: CsvDatabaseBlueprint
  journal: ImportJournal
  /** Resume support: keys already imported (db page sourceKey + row keys) → pageId. */
  existingMappings: Map<string, string>
  /** Called after each NEW row's item page exists (record mapping + progress). */
  onRowCreated: (rowKey: string, itemPageId: string) => Promise<void>
  /** Called once when the db page is NEWLY created (record its mapping). */
  onDatabaseCreated: (sourceKey: string, dbPageId: string) => Promise<void>
}

export async function materializeCsvDatabase(
  ctx: MaterializeContext,
  args: MaterializeArgs,
): Promise<{ dbPageId: string; createdRows: number }>
```

Behavior (implement exactly; the type-string → enum mapping is an explicit record `INFERRED_TO_PROP: Record<InferredType, DatabasePropertyType>`):

1. **DB page:** `existingMappings.get(bp.sourceKey)` → reuse; else `ctx.pages.create(actor, { workspaceId, parentId, title: bp.title, type: PageType.DATABASE, ...(parentId === null ? { location } : {}), parentId })` (createPageInput requires `parentId` present) → `onDatabaseCreated`. The create auto-seeds the STATUS «Статус» property + TABLE view.
2. **Properties:** `listProperties(actor, dbPageId)`. If the ONLY property is the seeded STATUS «Статус» and the blueprint has ≥1 non-title column → `deleteProperty` it (journal.action «Замена свойства по умолчанию»). Run `inferColumns(bp.header.slice(1), bp.rows.map(r => r.slice(1)))`. For each inferred column: if a property with the same name already exists (resume) → reuse its id; else `createProperty(actor, { pageId: dbPageId, type: INFERRED_TO_PROP[col.type], name: col.name, ...(col.options ? { settings: { options: col.options } } : {}) })`. Journal one line per column: «Колонка «X» → число|дата|выбор…». Build `cols: Array<{ propertyId: string; col: InferredColumn }>`.
3. **Rows:** for `idx`, `row` of `bp.rows`: title = `row[0]?.trim() || 'Без названия'`; `rowKey` = `bp.rowDocs?.get(title)?.sourceKey ?? `${bp.sourceKey}#${idx}``; skip when `existingMappings.has(rowKey)`. `createRow(actor, { pageId: dbPageId, title })`; per column with `v = col.toValue(row[i+1] ?? '')` non-null → `updateCellValue(actor, { pageId: dbPageId, rowId, propertyId, value: v })` wrapped in try/catch → `journal.warn(«Значение «…» в колонке «X» пропущено»)` and continue (the domain rejects malformed values; one bad cell must not kill the import). If a rowDoc exists for the title: parse (`parseMarkdownDocument`/`parseHtmlDocument` by `doc.format`, fallback title = title) and write content via `ctx.prisma.page.update({ where: { id: itemPageId }, data: { content: doc, contentYjs: buildImportContentYjs(doc) } })` + a `page.upserted` outbox insert (same shape as `rewriteImportedLinks` uses). Then `onRowCreated(rowKey, itemPageId)`.
4. Return `{ dbPageId, createdRows }`.

- [ ] **Step 2 — integration test** (`apps/web/test/server/csv-to-database.test.ts`, real DB; mirror the seed/cleanFixtures conventions of `apps/web/test/server/process-import-job.test.ts` with EMAIL_SUFFIX `+csv-db-test@anynote.dev`; ALSO deleteMany `databaseCellValue`/`databaseRow`/`databaseProperty`/`databaseView`/`databaseSource` scoped by workspace in cleanFixtures BEFORE pages). Use `domain` from `@/lib/domain` as both ports. Blueprint:

```ts
const BLUEPRINT = {
  sourceKey: 'База.csv',
  title: 'База',
  header: ['Name', 'Status', 'Count'],
  rows: [
    ['Задача А', 'Open', '1'],
    ['Задача Б', 'Done', '2'],
    ['Задача В', 'Open', '3'],
  ],
  rowDocs: new Map([
    [
      'Задача А',
      { sourceKey: 'База/Задача А.md', baseName: 'Задача А', format: 'md' as const, bytes: new TextEncoder().encode('# Задача А\n\nтело А') },
    ],
  ]),
}
```

Tests (3):
1. **Materializes a real database:** run with empty mappings + recording callbacks; assert the DATABASE page exists titled «База» with `parentId: null`; `domain.database.listProperties` shows exactly 2 properties — SELECT «Status» (options labels Open/Done) and NUMBER «Count» (the seeded «Статус» is gone); `domain.database.listRows` returns 3 rows whose `cells[statusPropId]` is the OPTION ID for the right label and `cells[countPropId]` the number; the «Задача А» item page content contains «тело А»; callbacks fired: 1 onDatabaseCreated + 3 onRowCreated with the right keys (`База/Задача А.md`, `База.csv#1`, `База.csv#2`).
2. **Resume skips existing:** run once, collect mappings from the callbacks into a Map, run again with that map → `listRows` still 3, createdRows === 0.
3. **Bad cell value degrades to a warning:** blueprint with a URL column and one `javascript:alert(1)` value (the domain rejects non-http URLs) → row still created, journal.warnings non-empty, cell empty.

- [ ] **Step 3:** run → PASS (3). `pnpm --filter web lint && pnpm --filter web check-types`. **Step 4 — commit:**
```bash
git add apps/web/src/server/page-import/csv-to-database.ts apps/web/test/server/csv-to-database.test.ts
git commit -m "feat(web): csv→database materializer with resume + per-cell degradation"
```

---

## Task 9: Processor integration — source dispatch, aliases, databases, journal/REPORT

**Files:** Modify `apps/web/src/server/jobs/process-import-job.ts`; Test: new `apps/web/test/server/process-notion-import.test.ts` (+ keep ALL existing import tests green).

Read the committed processor first; changes:

- [ ] **Step 1 — context + dispatch.** `ImportJobContext` gains `database: DatabasePort` (from Task 8). Plan selection becomes:

```ts
const plan =
  job.source === 'NOTION'
    ? buildNotionImportPlan(bytes)
    : job.source === 'CONFLUENCE'
      ? buildConfluenceImportPlan(bytes)
      : job.format === 'ZIP'
        ? buildImportPlan(bytes)
        : singleFilePlan(job.format, source.name, bytes)
```
(NOTION/CONFLUENCE imply ZIP — the router enforces it; throw ImportSourceError «Для этого источника нужен ZIP-архив» defensively if format !== 'ZIP'.) Extract `const aliases: Map<string, string> = 'aliases' in plan ? plan.aliases : new Map()` and `const databases = 'databases' in plan ? plan.databases : []`.

- [ ] **Step 2 — journal.** Construct `const journal = new ImportJournal(job.source, source.name)` in `processImportJob` (it has the job after `findUniqueOrThrow` — restructure: fetch the job in `processImportJob` before calling `run`, pass both). Replace the bare `warnings` array threading: plan warnings feed `journal.skip(...)` per line; `storeAssets` takes the journal (its quota warning becomes `journal.warn`); `result.warnings` = `journal.warnings.slice(0, 100)`. Page/database creations call `journal.action(...)` (one line per page is fine at import scale). After `run` returns OR throws, write the REPORT (best-effort, never failing the job):

```ts
async function writeReport(ctx: ImportJobContext, jobId: string, journal: ImportJournal): Promise<void> {
  try {
    // Replace any prior report (idempotent resume re-renders it).
    const prior = await ctx.prisma.importArtifact.findMany({
      where: { jobId, kind: 'REPORT' },
      include: { file: true },
    })
    for (const a of prior) {
      await ctx.prisma.importArtifact.delete({ where: { id: a.id } }).catch(() => {})
      await ctx.prisma.file.delete({ where: { id: a.fileId } }).catch(() => {})
    }
    const buf = Buffer.from(journal.render(), 'utf-8')
    const key = `imports/${jobId}-report.txt`
    await ctx.storage.put(key, buf, { contentType: 'text/plain; charset=utf-8', size: buf.byteLength })
    const file = await ctx.prisma.file.create({
      data: {
        userId: (await ctx.prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, select: { userId: true } })).userId,
        // workspaceId NULL: owner-only, invisible to the Library and the generic
        // member route — the journal can name skipped private items.
        workspaceId: null,
        name: 'import-report',
        ext: 'txt',
        fileSize: BigInt(buf.byteLength),
        mimeType: 'text/plain',
        hash: createHash('sha256').update(buf).digest('hex'),
        path: key,
        status: FileStatus.ACTIVE,
        isPublic: false,
      },
      select: { id: true },
    })
    await ctx.prisma.importArtifact.create({ data: { jobId, fileId: file.id, kind: 'REPORT' } })
  } catch (err) {
    console.warn('[import-job] report write failed', { jobId, err })
  }
}
```
Call it in BOTH the success path (before the DONE update is fine) and the catch path (after FAILED is set).

- [ ] **Step 3 — alias-aware resolution.** In `createNode`'s `resolveImageSrc`: after the direct `assetFileIds.get(abs)` miss, try `const aliased = aliases.get(abs); const viaAlias = aliased ? assetFileIds.get(aliased) : undefined` (thread `aliases` down as a param). In `rewriteImportedLinks`: extend `resolve` with the alias hop (`aliases.get(abs)` → `mapped.get(...)` chain) and pass `resolveExternal` (only when `aliases.size > 0`):

```ts
const resolveExternal = (href: string): string | null => {
  const id = extractNotionIdFromHref(href)
  const key = id ? aliases.get(id) : null
  const pid = key ? mapped.get(key) : null
  return pid ? `/pages/${pid}` : null
}
```
ALSO register alias ImportMapping resolution for ROW pages: rows recorded via `onRowCreated` land in `mapped`, and Task 6 put the row-doc raw paths + ids in `aliases` pointing at the row keys — verify the chain works for a link to a row page.

- [ ] **Step 4 — database materialization** after the page pass, before `rewriteImportedLinks`:

```ts
for (const bp of databases) {
  const parentPageId =
    bp.parentKey === ''
      ? options.parentId
      : (mapped.get(`${bp.parentKey}/`) ?? mapped.get(bp.parentKey) ?? options.parentId)
  await materializeCsvDatabase(
    { prisma: ctx.prisma, pages: ctx.pages, database: ctx.database },
    {
      actorUserId: job.userId,
      workspaceId: job.workspaceId,
      parentPageId,
      location: options.location,
      blueprint: bp,
      journal,
      existingMappings: mapped,
      onDatabaseCreated: async (key, pageId) => {
        await recordMapping(ctx, job.id, key, pageId, mapped) // the P2002-tolerant create extracted from createNode
        rootPageIdsMaybePush(key, pageId) // push to rootPageIds when parentKey === ''
        await bumpProgress(ctx, job.id)
      },
      onRowCreated: async (key, pageId) => {
        await recordMapping(ctx, job.id, key, pageId, mapped)
        await bumpProgress(ctx, job.id)
      },
    },
  )
}
```
Extract `recordMapping` (the existing P2002 try/catch from `createNode`, minus the page-deletion — for db rows the loser path just adopts the winner id without deleting, since rows are service-created; keep the page-delete variant inside `createNode` as-is) and `bumpProgress` (the processed-increment + heartbeat update) as small helpers reused by both paths.

- [ ] **Step 5 — kick wiring.** `apps/web/src/server/jobs/kick.ts`: the import branch context becomes `{ prisma, storage, pages: domain.pages, database: domain.database }`.

- [ ] **Step 6 — integration tests** (`apps/web/test/server/process-notion-import.test.ts`; copy the seed/cleanFixtures/makeFakeStorage pattern, EMAIL_SUFFIX `+notion-import-test@anynote.dev`, ctx `{ prisma, storage, pages: domain.pages, database: domain.database }`, plus the database-model deleteMany in cleanFixtures as in Task 8). Fixture:

```ts
const ID_PAGE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ID_ROW = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'
const NOTION_ZIP = () =>
  zipSync({
    [`Проект ${ID_PAGE}.md`]: strToU8(
      `# Проект\n\nСм. [строку](%D0%91%D0%B0%D0%B7%D0%B0%20${ID_PAGE}/%D0%97%D0%B0%D0%B4%D0%B0%D1%87%D0%B0%20%D0%90%20${ID_ROW}.md) и [внешн](https://www.notion.so/ws/Other-${ID_ROW}).\n`,
    ),
    [`База ${ID_PAGE}.csv`]: strToU8('Name,Status\nЗадача А,Open\nЗадача Б,Done\nЗадача В,Open\n'),
    [`База ${ID_PAGE}/Задача А ${ID_ROW}.md`]: strToU8('# Задача А\n\nтело А'),
  })
```
Job rows are seeded with `source: 'NOTION'`, `format: 'ZIP'`. Tests (4):
1. **End-to-end Notion import:** page «Проект» (cleaned title, no hex); DATABASE page «База» with SELECT property + 3 rows; «Задача А» item content contains «тело А»; the «Проект» content's relative encoded link AND the notion.so link both rewritten to `/pages/<задача-А-pageId>`; result.warnings includes the Notion limitations note; REPORT artifact exists with `kind: 'REPORT'` and its File row has `workspaceId: null`; the report text in fake storage contains «Источник: NOTION».
2. **Idempotent resume:** reset to QUEUED, re-run → page count and `listRows` count unchanged; exactly ONE REPORT artifact remains.
3. **Confluence import:** the Task 7 fixture zip with `source: 'CONFLUENCE'` → page «Первая» exists, content has no «Хлебные крошки», journal mentions Confluence limitations.
4. **GENERIC untouched:** run the EXISTING `process-import-job.test.ts` suite — all green, no edits to its assertions (only the seed's ctx gains the `database` field — that one mechanical edit is allowed).

- [ ] **Step 7:** full `pnpm --filter web exec vitest run test/server/` + lint + check-types → green. **Step 8 — commit:**
```bash
git add apps/web/src/server/jobs/process-import-job.ts apps/web/src/server/jobs/kick.ts apps/web/test/server/process-notion-import.test.ts apps/web/test/server/process-import-job.test.ts
git commit -m "feat(web): import processor — source dispatch, alias links, csv databases, journal artifact"
```

---

## Task 10: API — router source/journal fields + report route

**Files:** Modify `packages/trpc/src/routers/job.ts`; Create `apps/web/src/app/api/jobs/import/[jobId]/report/route.ts`; Tests: extend `packages/trpc/test/job-router.test.ts`, create `apps/web/test/api/jobs-import-report-route.test.ts`.

- [ ] **Step 1 — router.** `importCreateInput` gains `source: z.enum(['GENERIC', 'NOTION', 'CONFLUENCE', 'YANDEX_WIKI']).default('GENERIC')`. In `import.create`: when `source` is NOTION or CONFLUENCE and `input.format !== 'ZIP'` → `BAD_REQUEST` «Для этого источника нужен ZIP-архив»; persist `source: input.source` in the create data. In `list`: the imports `include` adds `kind: true` on artifacts (`artifacts: { include: { file: { select: { name: true, ext: true } } } }` → also select `kind`); `sourceName` must use `j.artifacts.find((a) => a.kind === 'SOURCE')?.file`; add to `JobListItem`: `hasReport: boolean` (`artifacts.some((a) => a.kind === 'REPORT')` for imports, `false` for exports), `warnings: string[]` (imports: the result JSON's warnings filtered to strings, capped at 50 — the log dialog renders these; exports: `[]`), `warningsCount: number` (the UNCAPPED length, so the UI can say «и ещё N»), `source: string | null` (imports: `j.source`; exports: null).

- [ ] **Step 2 — report route** (`apps/web/src/app/api/jobs/import/[jobId]/report/route.ts`): mirror the export artifact route EXACTLY (read it), with: `prisma.importJob.findFirst({ where: { id: jobId, userId: session.user.id } })` — NO status filter (the journal matters most for FAILED jobs) — `include: { artifacts: { include: { file: true } } }`; `const file = job?.artifacts.find((a) => a.kind === 'REPORT')?.file`; stream `Content-Type: 'text/plain; charset=utf-8'`, filename `import-report-<jobId8>.txt`, nosniff, uniform 404, 401 without session.

- [ ] **Step 3 — tests.** Router (extend job-router.test.ts, +3): NOTION + format MARKDOWN → BAD_REQUEST; create with source NOTION stores it (read the row back); a seeded import job with a REPORT artifact + result warnings → `list` row has `hasReport: true`, `warningsCount` right, and `sourceName` still names the SOURCE file. Report route test (new file, mirror `jobs-export-artifact-route.test.ts` with suffix `+import-report-test@anynote.dev`, 4 cases): owner streams the txt; co-member (ADMIN) 404; FAILED job with a report → owner still 200; no session 401.

- [ ] **Step 4:** `pnpm --filter @repo/trpc exec vitest run test/job-router.test.ts` (15) + the new route test (4) + `pnpm --filter @repo/trpc test` full + check-types both packages. **Step 5 — commit:**
```bash
git add packages/trpc/src/routers/job.ts packages/trpc/test/job-router.test.ts "apps/web/src/app/api/jobs/import/[jobId]/report/route.ts" apps/web/test/api/jobs-import-report-route.test.ts
git commit -m "feat(trpc): import source validation + journal fields, owner-gated report route"
```

---

## Task 11: Wizard source step + ImportLogViewer (UI)

**Files:** Create `apps/web/src/components/import-export/import-sources.ts`, `apps/web/src/components/import-export/import-log-dialog.tsx`; Modify `apps/web/src/components/import-export/import-wizard-dialog.tsx`, `job-presentation.ts`, `apps/web/src/components/workspace/settings/import-export-section.tsx`; extend test `apps/web/test/import-export-helpers.test.ts`.

UI conventions as in 6A (read the committed files first). `Card`/`CardActionArea`/`CardContent`/`Chip` are already exported from `@repo/ui/components`; no new re-exports expected.

- [ ] **Step 1 — pure source config + failing tests.** `import-sources.ts`:

```ts
export type ImportSourceKey = 'GENERIC' | 'NOTION' | 'CONFLUENCE' | 'YANDEX_WIKI'

export type SourceCard = {
  key: ImportSourceKey | 'ASANA' | 'MONDAY'
  label: string
  badge: string | null
  description: string
  limitations: string
  accept: string
  enabled: boolean
}

export const SOURCE_CARDS: SourceCard[] = [
  {
    key: 'GENERIC',
    label: 'Файлы',
    badge: null,
    description: 'Markdown/HTML-файлы или ZIP-архив с папками',
    limitations: 'Папки становятся деревом страниц; картинки загружаются в хранилище.',
    accept: '.md,.markdown,.html,.htm,.zip',
    enabled: true,
  },
  {
    key: 'NOTION',
    label: 'Notion',
    badge: null,
    description: 'ZIP-экспорт Notion (Markdown & CSV или HTML)',
    limitations:
      'Комментарии, права и история не переносятся; формулы, связи и rollup станут текстом.',
    accept: '.zip',
    enabled: true,
  },
  {
    key: 'CONFLUENCE',
    label: 'Confluence',
    badge: null,
    description: 'HTML-экспорт пространства Confluence (ZIP)',
    limitations: 'Права, история, комментарии и макросы не переносятся.',
    accept: '.zip',
    enabled: true,
  },
  {
    key: 'YANDEX_WIKI',
    label: 'Яндекс Wiki',
    badge: 'расширение AnyNote',
    description: 'ZIP/Markdown-выгрузка Яндекс Wiki',
    limitations:
      'Импортируется как дерево Markdown-страниц; специфичные блоки Wiki не переносятся.',
    accept: '.md,.markdown,.zip',
    enabled: true,
  },
  {
    key: 'ASANA',
    label: 'Asana',
    badge: 'недоступно в MVP',
    description: 'Импорт по API появится позже',
    limitations: 'Совет: выгрузите проект в CSV и импортируйте его как базу данных (скоро).',
    accept: '',
    enabled: false,
  },
  {
    key: 'MONDAY',
    label: 'Monday',
    badge: 'недоступно в MVP',
    description: 'Импорт по API появится позже',
    limitations: 'Совет: выгрузите доску в CSV/Excel и импортируйте как базу данных (скоро).',
    accept: '',
    enabled: false,
  },
]
```

Extend `job-presentation.ts`: `JobRow` gains `hasReport: boolean`, `warningsCount: number`, `warnings?: string[]`, `source?: string | null`; add `SOURCE_LABEL: Record<string, string>` (GENERIC «Файлы», NOTION «Notion», CONFLUENCE «Confluence», YANDEX_WIKI «Яндекс Wiki») and make `describeJob` for imports render `Импорт (<source-label>): <sourceName|format>` when source is non-GENERIC, unchanged otherwise. Extend `apps/web/test/import-export-helpers.test.ts` (TDD): SOURCE_CARDS has exactly 2 disabled cards (ASANA/MONDAY) and NOTION accepts only .zip; describeJob renders «Импорт (Notion): export.zip» for a NOTION row and the old «Импорт: f.zip» for GENERIC. (Update the existing import describeJob expectations only if they conflict — the GENERIC form must stay identical.)

- [ ] **Step 2 — wizard source step.** In `import-wizard-dialog.tsx` (read the committed file): add `const [source, setSource] = useState<SourceCard | null>(null)`. When `source === null` render the source grid INSTEAD of the form: a 2-column grid of `Card` + `CardActionArea` (disabled cards render `CardContent` without an action area, `opacity: 0.6`), each card showing label + badge `Chip` (size small) + description + limitations caption; `data-testid={'import-source-' + key.toLowerCase()}` on the action area. Selecting sets `source` and shows the existing form (file/location/parent) with: the hidden input's `accept={source.accept}`, a header line `«Источник: <label>» + limitations caption` and a «Назад» text Button (resets `source` AND the picked file). `detectImportFormat` stays the format authority; additionally when the source requires zip (NOTION/CONFLUENCE) and the picked file isn't .zip, show the existing error caption. `handleSubmit` passes `source: (source.key === 'ASANA' || source.key === 'MONDAY' ? 'GENERIC' : source.key)` — disabled cards can't reach submit anyway; type the param as the router's enum. `handleClose` resets `source`. The dialog `data-testid="import-wizard"` stays on the Dialog root.

- [ ] **Step 3 — ImportLogViewer.** `import-log-dialog.tsx`: props `{ open, onClose, job: JobRow }`; a small Dialog «Журнал импорта» listing `job.warnings ?? []` as a dense list (each line `Typography variant body2`; empty → «Предупреждений нет.»); DialogActions: when `job.hasReport` a Button `component="a" href={'/api/jobs/import/' + job.id + '/report'}` «Скачать журнал» (data-testid="download-report") + «Закрыть». In `import-export-section.tsx`: state `const [logJob, setLogJob] = useState<JobRow | null>(null)`; in the actions cell, for `j.kind === 'import' && (j.warningsCount > 0 || j.hasReport)` render a small text Button «Журнал» (data-testid="open-journal") opening the dialog; mount `<ImportLogDialog open={logJob !== null} job={logJob ?? EMPTY_ROW} onClose={() => setLogJob(null)} />` (or gate render on logJob non-null — pick the cleaner pattern used elsewhere).

- [ ] **Step 4 — verify:** helpers test green; `pnpm --filter web lint && pnpm --filter web check-types && pnpm --filter web build` (the build catches client-bundle violations; stale `.next/types` → `rm -rf apps/web/.next/types`). **Step 5 — commit:**
```bash
git add apps/web/src/components/import-export apps/web/src/components/workspace/settings/import-export-section.tsx apps/web/test/import-export-helpers.test.ts
git commit -m "feat(web): import source picker step + import journal viewer"
```

---

## Task 12: E2E — source step + Notion fixture import

**Files:** Modify `apps/e2e/import-export.spec.ts`; Create `apps/e2e/fixtures/notion-sample.zip`.

- [ ] **Step 1 — fixture** (id-suffixed Notion shape; run from apps/web where fflate resolves):
```bash
cd apps/web && node --input-type=module -e "
import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'node:fs'
const ID1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const ID2 = 'b2c3d4e5f60718293a4b5c6d7e8f90a1'
const files = {
  ['Проект ' + ID1 + '.md']: strToU8('# Проект\n\nКорневая страница Notion.\n'),
  ['База ' + ID1 + '.csv']: strToU8('Name,Status\nЗадача А,Open\nЗадача Б,Done\nЗадача В,Open\n'),
  ['База ' + ID1 + '/Задача А ' + ID2 + '.md']: strToU8('# Задача А\n\nтело А\n'),
}
writeFileSync('../e2e/fixtures/notion-sample.zip', zipSync(files))
console.log('written')
" && cd ..
```

- [ ] **Step 2 — update the existing import test** for the new first step: after `open-import`, click `getByTestId('import-source-generic')`, THEN the existing file-input/submit flow (read the committed spec — selectors listed there stay valid after the source click).

- [ ] **Step 3 — new Notion test** in the same describe:

```ts
  test('imports a notion export zip with a database and a journal', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'notion-zip')
    await openImportExportSettings(page)

    await page.getByTestId('open-import').click()
    await page.getByTestId('import-source-notion').click()
    await page
      .getByTestId('import-file-input')
      .setInputFiles(path.join(__dirname, 'fixtures', 'notion-sample.zip'))
    await page.getByTestId('import-submit').click()
    await expect(page.getByTestId('import-wizard').getByText(/Импорт запущен/)).toBeVisible({
      timeout: 20_000,
    })
    await page
      .getByTestId('import-wizard')
      .getByRole('button', { name: 'Закрыть' })
      .click()

    const row = page.getByTestId('job-row').filter({ hasText: 'Notion' })
    await expect(row.getByText('Готово')).toBeVisible({ timeout: 60_000 })

    // Journal opens with the limitations warning + download link.
    await row.getByRole('button', { name: 'Журнал' }).click()
    await expect(page.getByText(/Notion не переносятся|не переносятся/)).toBeVisible()
    await expect(page.getByTestId('download-report')).toBeVisible()
    await page.keyboard.press('Escape')

    // Cleaned title + the database page land in the tree.
    await page.reload()
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await expect(page.locator('aside').getByText('Проект', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.locator('aside').getByText('База', { exact: true })).toBeVisible()
  })
```
Adapt locators to reality (run, iterate); never weaken the assertions' semantics (cleaned titles, database in tree, journal + report link).

- [ ] **Step 4 — run** `pnpm exec playwright test apps/e2e/import-export.spec.ts --retries=2` (root .env sourced into the shell first — known worktree gotcha) → 3 passed. **Step 5 — commit:**
```bash
git add apps/e2e/import-export.spec.ts apps/e2e/fixtures/notion-sample.zip
git commit -m "test(e2e): notion zip import with database + journal, source-step flow"
```

---

## Task 13: Changelog + full gates

- [ ] **Step 1:** `docs/changelog.md` — extend the «Импорт и экспорт» block in «Готовится» (after its last bullet):

```md
- Импорт из Notion: ZIP-экспорт (Markdown & CSV или HTML) превращается в дерево страниц, а CSV-базы — в настоящие базы данных с типизированными свойствами.
- Импорт из Confluence (HTML-экспорт пространства) и путь для Яндекс Wiki (расширение AnyNote); Asana и Monday — честный статус «недоступно в MVP».
- Журнал импорта: предупреждения, пропущенные элементы и скачиваемый отчёт по каждому заданию.
```

- [ ] **Step 2:** `set -a; source .env; set +a && pnpm gates` → all green (fix minimally; known trip-points as in 6A). **Step 3:**
```bash
git add docs/changelog.md
git commit -m "docs(changelog): import sources — notion, confluence, yandex wiki, journal"
```

---

## Completion

After all tasks: the controller requests the final whole-branch review focused on (1) Notion/Confluence parser sandboxing (zip-slip/depth guards still apply — both builders normalize through `normalizeEntryPath`), (2) the REPORT artifact privacy chain (workspaceId null + owner-gated route + Library invisibility — the exact 6A lesson), (3) database materialization actor/ACL correctness, (4) GENERIC-flow regression — then merges via the established checkpoint.

## Self-review (performed at plan-writing time)

- Spec coverage: §2 schema→Task 1; §3 dispatch+journal→Task 9; §4 Notion→Tasks 2/6/9; §5 mapper→Tasks 4/5/8; §6 Confluence→Task 7; §7 wizard+viewer→Task 11 (+API Task 10); §8 security→Tasks 9/10 (report privacy), parsers reuse normalizeEntryPath; §10 tests→every task + Task 12 E2E.
- Type consistency: `ImportDoc`/`ImportPlan` from zip-plan reused by notion/confluence builders; `NotionDatabaseBlueprint.rowDocs` matches `CsvDatabaseBlueprint.rowDocs`; `DatabasePort` = Pick of `Domain['database']` so the singleton is assignable; `JobRow` fields (Task 11) mirror `JobListItem` additions (Task 10, incl. `warnings`).
- Known deviation candidates flagged inline (asset raw-path aliasing in Task 6 step 5 offers two implementations; the worker picks the one that makes Task 9's test pass without touching the generic flow).
