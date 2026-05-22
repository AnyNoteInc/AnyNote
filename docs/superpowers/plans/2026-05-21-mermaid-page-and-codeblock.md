# Mermaid Page Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collaborative `MERMAID` page type (Monaco source 30% / live diagram canvas 70%) backed by a new `@repo/mermaid` workspace package, persisted through the existing Hocuspocus/Yjs pipeline.

**Architecture:** A new `@repo/mermaid` workspace package modeled on `@repo/excalidraw`/`@repo/genogram` — same StrictMode-safe Yjs hook, double `next/dynamic ssr:false`, `moduleResolution: "Bundler"`. The Mermaid source lives in a single `Y.Text` root (`'mermaid'`) bound to Monaco via `y-monaco`; the preview observes it and renders with `mermaid`.

**Tech Stack:** Next.js 16 (Turbopack), React 19, Yjs + Hocuspocus, `monaco-editor` (bundled) + `@monaco-editor/react` + `y-monaco`, `mermaid@^11`, `react-zoom-pan-pinch`, MUI v7. Spec: [`docs/superpowers/specs/2026-05-21-mermaid-page-and-codeblock-design.md`](../specs/2026-05-21-mermaid-page-and-codeblock-design.md).

**Conventions:** Prettier — `semi: false`, single quotes, trailing commas, 100-char width. Run `pnpm format` if unsure. Commits — Conventional Commits with scope; do **not** use `--no-verify`. Commit frequently.

---

## File Structure

**New package `packages/mermaid/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `README.md`
- `src/index.ts` — public exports
- `src/types.ts` — `MermaidBoardProps`
- `src/mermaid-theme.ts` — MUI mode → mermaid/monaco theme names (pure, tested)
- `src/export.ts` — SVG serialize + data-url + PNG rasterize (pure parts tested)
- `src/mermaid-language.ts` — Monaco Monarch grammar for `mermaid` (definition tested)
- `src/render-mermaid.ts` — `mermaid.render` wrapper returning a tagged result (tested w/ mock)
- `src/monaco-env.ts` — one-time Monaco worker + loader configuration
- `src/use-mermaid-yjs.ts` — Y.Doc + HocuspocusProvider + `Y.Text` hook
- `src/mermaid-source-editor.tsx` — Monaco editor + `MonacoBinding`
- `src/mermaid-preview.tsx` — observe → debounce → render → zoom/pan + export toolbar
- `src/mermaid-board-inner.tsx` — split-pane shell (draggable divider, default 30/70)
- `src/mermaid-board.tsx` — `'use client'` dynamic `ssr:false` wrapper

**Modified:**
- `apps/web/next.config.js`, `apps/web/src/components/page/page-renderer.tsx`, `apps/web/src/components/workspace/page-tree-section.tsx`, `apps/web/src/components/page/page-actions-menu.tsx`, `apps/web/src/components/page/page-actions-toolbar.tsx`, `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`
- `apps/yjs/src/persistence.ts` (+ `persistence.spec.ts`)
- `packages/db/prisma/schema.prisma` (+ migration)
- `apps/e2e/mermaid-page.spec.ts` (new)
- `CLAUDE.md`

---

# `MERMAID` page type

## Task A1: Prisma enum + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:182-189`

- [ ] **Step 1: Add `MERMAID` to the enum**

In `packages/db/prisma/schema.prisma`, change the `PageType` enum:

```prisma
enum PageType {
  TEXT
  EXCALIDRAW
  GENOGRAM
  MERMAID
  DATABASE
  KANBAN
  FORM
}
```

- [ ] **Step 2: Create the migration**

Run (Postgres must be up — `docker compose up -d`):

```bash
pnpm --filter @repo/db exec prisma migrate dev --name add_mermaid_page_type
```

Expected: a new folder under `packages/db/prisma/migrations/<timestamp>_add_mermaid_page_type/migration.sql` containing `ALTER TYPE "PageType" ADD VALUE 'MERMAID';`, and "Your database is now in sync with your schema."

- [ ] **Step 3: Regenerate the client**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: "Generated Prisma Client".

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add MERMAID page type enum value"
```

---

## Task A2: Scaffold `@repo/mermaid` package + register transpile

**Files:**
- Create: `packages/mermaid/package.json`, `packages/mermaid/tsconfig.json`, `packages/mermaid/vitest.config.ts`, `packages/mermaid/eslint.config.js`, `packages/mermaid/README.md`, `packages/mermaid/src/index.ts`, `packages/mermaid/src/types.ts`
- Modify: `apps/web/next.config.js:19-31`

- [ ] **Step 1: `packages/mermaid/package.json`**

```json
{
  "name": "@repo/mermaid",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./*": {
      "types": "./src/*",
      "import": "./src/*",
      "default": "./src/*"
    }
  },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hocuspocus/provider": "^3.4.4",
    "@monaco-editor/react": "^4.7.0",
    "@mui/icons-material": "^7.3.10",
    "@mui/material": "^7.3.10",
    "mermaid": "^11.4.0",
    "monaco-editor": "^0.52.2",
    "react": "^19.2.0",
    "react-zoom-pan-pinch": "^3.7.0",
    "y-monaco": "^0.1.6",
    "yjs": "^13.6.30"
  },
  "peerDependencies": {
    "next": "^16.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.2",
    "eslint": "^9.39.1",
    "next": "^16.0.0",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: `packages/mermaid/tsconfig.json`** (identical to `packages/excalidraw/tsconfig.json`)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/react-library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["react", "react-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `packages/mermaid/vitest.config.ts`** (mirrors `packages/editor/vitest.config.ts`)

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

- [ ] **Step 4: `packages/mermaid/eslint.config.js`** (copy from `packages/excalidraw/eslint.config.js` — read it first and reproduce verbatim)

Run:

```bash
cat packages/excalidraw/eslint.config.js
```

Create `packages/mermaid/eslint.config.js` with identical contents.

- [ ] **Step 5: `packages/mermaid/src/types.ts`**

```ts
export type MermaidUser = {
  id: string
  name: string
  color: string
}

export type MermaidBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  user?: MermaidUser
  editable?: boolean
  className?: string
}
```

- [ ] **Step 6: `packages/mermaid/src/index.ts`** (placeholder export; the component is added in Task A11)

```ts
export type { MermaidBoardProps, MermaidUser } from './types'
```

- [ ] **Step 7: `packages/mermaid/src/README.md`**

```markdown
# @repo/mermaid

Collaborative Mermaid diagram page for AnyNote. Split-pane: a bundled Monaco
editor (left) bound to a Yjs `Y.Text` named `mermaid` via `y-monaco`, and a live
diagram preview (right) rendered with `mermaid`, with zoom/pan and SVG/PNG export.

Loaded only via `next/dynamic` with `ssr: false` — Monaco and mermaid touch
`window`/`document` at module-eval time.
```

- [ ] **Step 8: Register in `transpilePackages`**

In `apps/web/next.config.js`, add `'@repo/mermaid'` to the `transpilePackages` array (after `'@repo/genogram'`):

```js
  transpilePackages: [
    '@repo/ui',
    '@repo/trpc',
    '@repo/auth',
    '@repo/db',
    '@repo/mail',
    '@repo/notifications',
    '@repo/storage',
    '@repo/editor',
    '@repo/excalidraw',
    '@repo/genogram',
    '@repo/mermaid',
    '@repo/yookassa',
  ],
```

- [ ] **Step 9: Install deps**

```bash
pnpm install
```

Expected: lockfile updates; `@repo/mermaid` is linked into the workspace.

- [ ] **Step 10: Verify it type-checks (empty package)**

```bash
pnpm --filter @repo/mermaid check-types
```

Expected: exit 0 (no errors).

- [ ] **Step 11: Commit**

```bash
git add packages/mermaid apps/web/next.config.js pnpm-lock.yaml package.json
git commit -m "feat(mermaid): scaffold @repo/mermaid package and register transpile"
```

---

## Task A3: `mermaid-theme.ts` (TDD)

**Files:**
- Create: `packages/mermaid/src/mermaid-theme.ts`
- Test: `packages/mermaid/src/mermaid-theme.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mermaid/src/mermaid-theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mermaidThemeForMode, monacoThemeForMode } from './mermaid-theme'

describe('theme mapping', () => {
  it('maps dark mode to mermaid "dark" and monaco "vs-dark"', () => {
    expect(mermaidThemeForMode('dark')).toBe('dark')
    expect(monacoThemeForMode('dark')).toBe('vs-dark')
  })

  it('maps light mode to mermaid "default" and monaco "vs"', () => {
    expect(mermaidThemeForMode('light')).toBe('default')
    expect(monacoThemeForMode('light')).toBe('vs')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm --filter @repo/mermaid exec vitest run src/mermaid-theme.test.ts
```

Expected: FAIL — "Failed to resolve import './mermaid-theme'".

- [ ] **Step 3: Implement**

`packages/mermaid/src/mermaid-theme.ts`:

```ts
export type ColorMode = 'light' | 'dark'

/** Mermaid built-in theme name for the given site color mode. */
export function mermaidThemeForMode(mode: ColorMode): 'default' | 'dark' {
  return mode === 'dark' ? 'dark' : 'default'
}

/** Monaco built-in theme id for the given site color mode. */
export function monacoThemeForMode(mode: ColorMode): 'vs' | 'vs-dark' {
  return mode === 'dark' ? 'vs-dark' : 'vs'
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm --filter @repo/mermaid exec vitest run src/mermaid-theme.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mermaid/src/mermaid-theme.ts packages/mermaid/src/mermaid-theme.test.ts
git commit -m "feat(mermaid): theme mode mapping helpers"
```

---

## Task A4: `export.ts` (TDD pure parts)

**Files:**
- Create: `packages/mermaid/src/export.ts`
- Test: `packages/mermaid/src/export.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mermaid/src/export.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { svgStringToDataUrl, downloadFilename } from './export'

describe('export helpers', () => {
  it('encodes an SVG string as a base64 data URL', () => {
    const url = svgStringToDataUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('builds a timestamped filename with the given extension', () => {
    const name = downloadFilename('svg')
    expect(name).toMatch(/^mermaid-\d+\.svg$/)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm --filter @repo/mermaid exec vitest run src/export.test.ts
```

Expected: FAIL — cannot resolve `./export`.

- [ ] **Step 3: Implement**

`packages/mermaid/src/export.ts`:

```ts
/** Base64 data URL for an SVG markup string (UTF-8 safe). */
export function svgStringToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

/** `mermaid-<epoch-ms>.<ext>` */
export function downloadFilename(ext: 'svg' | 'png'): string {
  return `mermaid-${Date.now()}.${ext}`
}

/** Trigger a browser download of a Blob or data URL. */
export function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Rasterize an SVG markup string to a PNG Blob via an offscreen <canvas>.
 * `scale` upsamples for crispness. Browser-only.
 */
export function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('canvas toBlob returned null'))
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('failed to load SVG into image'))
    img.src = svgStringToDataUrl(svg)
  })
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm --filter @repo/mermaid exec vitest run src/export.test.ts
```

Expected: PASS (2 tests). (`svgToPngBlob`/`triggerDownload` use DOM APIs — validated in the E2E task, not unit-tested.)

- [ ] **Step 5: Commit**

```bash
git add packages/mermaid/src/export.ts packages/mermaid/src/export.test.ts
git commit -m "feat(mermaid): SVG/PNG export helpers"
```

---

## Task A5: `mermaid-language.ts` Monaco Monarch grammar (TDD definition)

**Files:**
- Create: `packages/mermaid/src/mermaid-language.ts`
- Test: `packages/mermaid/src/mermaid-language.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mermaid/src/mermaid-language.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MERMAID_LANGUAGE_ID, mermaidMonarchLanguage } from './mermaid-language'

describe('mermaid monarch language', () => {
  it('exposes a stable language id', () => {
    expect(MERMAID_LANGUAGE_ID).toBe('mermaid')
  })

  it('lists the common diagram keywords', () => {
    expect(mermaidMonarchLanguage.keywords).toEqual(
      expect.arrayContaining(['graph', 'sequenceDiagram', 'classDiagram', 'flowchart', 'stateDiagram']),
    )
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm --filter @repo/mermaid exec vitest run src/mermaid-language.test.ts
```

Expected: FAIL — cannot resolve `./mermaid-language`.

- [ ] **Step 3: Implement**

`packages/mermaid/src/mermaid-language.ts`:

```ts
import type * as monaco from 'monaco-editor'

export const MERMAID_LANGUAGE_ID = 'mermaid'

/**
 * Minimal Monarch tokenizer for Mermaid source. Highlights diagram-type
 * keywords, arrows/links, and comments. No language server — the base editor
 * worker is enough.
 */
export const mermaidMonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    'graph',
    'flowchart',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'stateDiagram-v2',
    'erDiagram',
    'journey',
    'gantt',
    'pie',
    'gitGraph',
    'mindmap',
    'timeline',
    'subgraph',
    'end',
    'participant',
    'actor',
    'class',
    'state',
    'note',
    'loop',
    'alt',
    'opt',
    'par',
    'TD',
    'TB',
    'BT',
    'RL',
    'LR',
  ],
  tokenizer: {
    root: [
      [/%%.*$/, 'comment'],
      [/(-->|---|==>|===|-\.->|--x|--o|::|:::)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/\|[^|]*\|/, 'string'],
      [/\[[^\]]*\]/, 'string'],
      [/\{[^}]*\}/, 'string'],
      [
        /[a-zA-Z_$][\w$-]*/,
        { cases: { '@keywords': 'keyword', '@default': 'identifier' } },
      ],
      [/[;,.]/, 'delimiter'],
    ],
  },
}

/** Register the mermaid language + tokenizer on a Monaco instance (idempotent). */
export function registerMermaidLanguage(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === MERMAID_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: MERMAID_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(MERMAID_LANGUAGE_ID, mermaidMonarchLanguage)
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm --filter @repo/mermaid exec vitest run src/mermaid-language.test.ts
```

Expected: PASS (2 tests). (`monaco-editor` is a type-only import here, so the test runs in node.)

- [ ] **Step 5: Commit**

```bash
git add packages/mermaid/src/mermaid-language.ts packages/mermaid/src/mermaid-language.test.ts
git commit -m "feat(mermaid): Monaco Monarch grammar for mermaid"
```

---

## Task A6: `render-mermaid.ts` wrapper (TDD with mock)

**Files:**
- Create: `packages/mermaid/src/render-mermaid.ts`
- Test: `packages/mermaid/src/render-mermaid.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mermaid/src/render-mermaid.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const initialize = vi.fn()
const parse = vi.fn()
const render = vi.fn()

vi.mock('mermaid', () => ({
  default: { initialize, parse, render },
}))

import { renderMermaid } from './render-mermaid'

beforeEach(() => {
  initialize.mockReset()
  parse.mockReset()
  render.mockReset()
})

describe('renderMermaid', () => {
  it('returns ok + svg when mermaid renders successfully', async () => {
    parse.mockResolvedValue(true)
    render.mockResolvedValue({ svg: '<svg></svg>' })

    const result = await renderMermaid('id1', 'graph TD; A-->B;', 'dark')

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }),
    )
    expect(result).toEqual({ ok: true, svg: '<svg></svg>' })
  })

  it('returns an error result when parse rejects', async () => {
    parse.mockRejectedValue(new Error('Parse error on line 2'))

    const result = await renderMermaid('id2', 'not a diagram', 'light')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Parse error')
    expect(render).not.toHaveBeenCalled()
  })

  it('treats blank source as empty (no render, no error)', async () => {
    const result = await renderMermaid('id3', '   ', 'light')
    expect(result).toEqual({ ok: true, svg: '' })
    expect(render).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm --filter @repo/mermaid exec vitest run src/render-mermaid.test.ts
```

Expected: FAIL — cannot resolve `./render-mermaid`.

- [ ] **Step 3: Implement**

`packages/mermaid/src/render-mermaid.ts`:

```ts
import mermaid from 'mermaid'

import type { ColorMode } from './mermaid-theme'
import { mermaidThemeForMode } from './mermaid-theme'

export type RenderResult = { ok: true; svg: string } | { ok: false; error: string }

let lastTheme: ColorMode | null = null

/**
 * Validate + render a Mermaid source string to SVG markup. Parse errors are
 * returned (never thrown) so the preview can keep showing the last good render.
 * `id` must be unique per call to avoid Mermaid's internal id collisions.
 */
export async function renderMermaid(id: string, source: string, mode: ColorMode): Promise<RenderResult> {
  if (!source.trim()) return { ok: true, svg: '' }

  if (lastTheme !== mode) {
    mermaid.initialize({ startOnLoad: false, theme: mermaidThemeForMode(mode), securityLevel: 'strict' })
    lastTheme = mode
  }

  try {
    await mermaid.parse(source)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const { svg } = await mermaid.render(id, source)
    return { ok: true, svg }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Force re-initialization on the next render (call when color mode flips). */
export function resetMermaidTheme(): void {
  lastTheme = null
}
```

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm --filter @repo/mermaid exec vitest run src/render-mermaid.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mermaid/src/render-mermaid.ts packages/mermaid/src/render-mermaid.test.ts
git commit -m "feat(mermaid): safe mermaid render wrapper with parse guard"
```

---

## Task A7: `use-mermaid-yjs.ts` hook

**Files:**
- Create: `packages/mermaid/src/use-mermaid-yjs.ts`

- [ ] **Step 1: Implement** (mirrors `packages/genogram/src/hooks/useGenogramYjs.ts` + Excalidraw's `initialContentYjs` seeding)

`packages/mermaid/src/use-mermaid-yjs.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type MermaidYjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  ytext: Y.Text
}

/**
 * Create the Y.Doc + HocuspocusProvider inside useEffect (not useState init) so
 * React StrictMode's mount→unmount→remount doesn't leave destroyed resources in
 * state. The mermaid source is a single Y.Text root named 'mermaid'.
 */
export function useMermaidYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
}): MermaidYjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = args
  const [resources, setResources] = useState<MermaidYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const ytext = ydoc.getText('mermaid')
    const provider = new HocuspocusProvider({ url: yjsUrl, name: pageId, document: ydoc, token: yjsToken })
    setResources({ ydoc, provider, ytext })
    return () => {
      setResources(null)
      // Defer destroy so an in-flight WebSocket handshake can complete.
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken, initialContentYjs])

  return resources
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/mermaid check-types
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/mermaid/src/use-mermaid-yjs.ts
git commit -m "feat(mermaid): yjs hook with Y.Text source root"
```

---

## Task A8: `monaco-env.ts` — bundled worker + loader config (SPIKE — validate early)

**Files:**
- Create: `packages/mermaid/src/monaco-env.ts`

- [ ] **Step 1: Implement**

`packages/mermaid/src/monaco-env.ts`:

```ts
'use client'

import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

let configured = false

/**
 * Configure Monaco to run fully self-hosted (no CDN): point @monaco-editor/react
 * at the bundled `monaco-editor`, and provide the base editor worker via the
 * cross-bundler `new URL(..., import.meta.url)` worker pattern (works in both
 * Turbopack dev and the webpack production build). Mermaid is a Monarch-only
 * language, so only the base editor.worker is needed. Idempotent + browser-only.
 */
export function configureMonaco(): typeof monaco | null {
  if (typeof window === 'undefined') return null
  if (configured) return monaco
  configured = true
  ;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker() {
      return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url), {
        type: 'module',
      })
    },
  }
  loader.config({ monaco })
  return monaco
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/mermaid check-types
```

Expected: exit 0.

- [ ] **Step 3: SPIKE — verify Monaco mounts under Turbopack and in the build**

This is the primary risk for Phase A. Defer full verification to Task A16 (E2E) and Task A17 (gates/build), but if you want an early signal, after Task A9 run `pnpm --filter web dev`, open a MERMAID page, and confirm the Monaco editor renders with no `Could not create web worker` console error. If the `new URL` worker fails under Turbopack, fall back to the `?worker` import form:

```ts
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
// ...
getWorker: () => new EditorWorker(),
```

- [ ] **Step 4: Commit**

```bash
git add packages/mermaid/src/monaco-env.ts
git commit -m "feat(mermaid): self-hosted Monaco worker + loader config"
```

---

## Task A9: `mermaid-source-editor.tsx` — Monaco + y-monaco binding

**Files:**
- Create: `packages/mermaid/src/mermaid-source-editor.tsx`

- [ ] **Step 1: Implement**

`packages/mermaid/src/mermaid-source-editor.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import { configureMonaco } from './monaco-env'
import { MERMAID_LANGUAGE_ID, registerMermaidLanguage } from './mermaid-language'
import { monacoThemeForMode, type ColorMode } from './mermaid-theme'

configureMonaco()

type Props = {
  ytext: Y.Text
  provider: HocuspocusProvider
  mode: ColorMode
  editable: boolean
}

export function MermaidSourceEditor({ ytext, provider, mode, editable }: Props) {
  const bindingRef = useRef<MonacoBinding | null>(null)

  const handleMount: OnMount = (editorInstance, monaco) => {
    registerMermaidLanguage(monaco)
    const model = editorInstance.getModel()
    if (model) monaco.editor.setModelLanguage(model, MERMAID_LANGUAGE_ID)
    bindingRef.current = new MonacoBinding(
      ytext,
      editorInstance.getModel() as editor.ITextModel,
      new Set([editorInstance]),
      provider.awareness ?? null,
    )
  }

  useEffect(() => {
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
    }
  }, [])

  return (
    <Editor
      height="100%"
      defaultLanguage={MERMAID_LANGUAGE_ID}
      theme={monacoThemeForMode(mode)}
      onMount={handleMount}
      options={{
        readOnly: !editable,
        minimap: { enabled: false },
        fontSize: 13,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        lineNumbersMinChars: 3,
        placeholder: 'graph TD;\n  A --> B;',
      }}
    />
  )
}
```

> Note: `MonacoBinding` sets the model's initial content from `ytext`. Do **not** also pass `defaultValue`/`value` to `<Editor>` — that would fight the binding. The `placeholder` option shows only while the model is empty.

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/mermaid check-types
```

Expected: exit 0. (If `y-monaco` ships no types, add `packages/mermaid/src/y-monaco.d.ts` with `declare module 'y-monaco'` exporting `MonacoBinding` — see Step 3.)

- [ ] **Step 3: (Only if Step 2 reports missing `y-monaco` types) add an ambient declaration**

`packages/mermaid/src/y-monaco.d.ts`:

```ts
declare module 'y-monaco' {
  import type { editor } from 'monaco-editor'
  import type * as Y from 'yjs'
  import type { Awareness } from 'y-protocols/awareness'
  export class MonacoBinding {
    constructor(
      ytext: Y.Text,
      model: editor.ITextModel,
      editors: Set<editor.IStandaloneCodeEditor>,
      awareness?: Awareness | null,
    )
    destroy(): void
  }
}
```

Re-run `pnpm --filter @repo/mermaid check-types` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/mermaid/src/mermaid-source-editor.tsx packages/mermaid/src/y-monaco.d.ts
git commit -m "feat(mermaid): Monaco source editor bound to Y.Text"
```

---

## Task A10: `mermaid-preview.tsx` — render + zoom/pan + export

**Files:**
- Create: `packages/mermaid/src/mermaid-preview.tsx`

- [ ] **Step 1: Implement**

`packages/mermaid/src/mermaid-preview.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import DownloadIcon from '@mui/icons-material/Download'
import ImageIcon from '@mui/icons-material/Image'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type * as Y from 'yjs'

import { renderMermaid } from './render-mermaid'
import { downloadFilename, svgStringToDataUrl, svgToPngBlob, triggerDownload } from './export'
import type { ColorMode } from './mermaid-theme'

type Props = {
  ytext: Y.Text
  mode: ColorMode
}

export function MermaidPreview({ ytext, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ReactZoomPanPinchRef>(null)
  const [error, setError] = useState<string | null>(null)
  const lastGoodSvg = useRef<string>('')

  const draw = useCallback(
    async (source: string) => {
      const id = `mermaid-svg-${Math.random().toString(36).slice(2)}`
      const result = await renderMermaid(id, source, mode)
      if (result.ok) {
        setError(null)
        lastGoodSvg.current = result.svg
        if (containerRef.current) containerRef.current.innerHTML = result.svg
      } else {
        setError(result.error)
      }
    },
    [mode],
  )

  useEffect(() => {
    let timer: number | null = null
    const schedule = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void draw(ytext.toString()), 300)
    }
    void draw(ytext.toString()) // initial
    ytext.observe(schedule)
    return () => {
      ytext.unobserve(schedule)
      if (timer) window.clearTimeout(timer)
    }
  }, [ytext, draw])

  const currentSvgEl = () => containerRef.current?.querySelector('svg') ?? null

  const exportSvg = () => {
    if (!lastGoodSvg.current) return
    triggerDownload(svgStringToDataUrl(lastGoodSvg.current), downloadFilename('svg'))
  }

  const exportPng = async () => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return
    const rect = svgEl.getBoundingClientRect()
    const blob = await svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
    triggerDownload(URL.createObjectURL(blob), downloadFilename('png'))
  }

  const copyPng = async () => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return
    const rect = svgEl.getBoundingClientRect()
    const blob = await svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  return (
    <Box sx={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2, bgcolor: 'background.paper', borderRadius: 1, boxShadow: 1, p: 0.5 }}
      >
        <Tooltip title="Уменьшить">
          <IconButton size="small" onClick={() => zoomRef.current?.zoomOut()}><RemoveIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Увеличить">
          <IconButton size="small" onClick={() => zoomRef.current?.zoomIn()}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="По размеру">
          <IconButton size="small" onClick={() => zoomRef.current?.resetTransform()}><FitScreenIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Скачать SVG">
          <IconButton size="small" onClick={exportSvg} data-testid="mermaid-export-svg"><DownloadIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Скачать PNG">
          <IconButton size="small" onClick={() => void exportPng()}><ImageIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Копировать PNG">
          <IconButton size="small" onClick={() => void copyPng()}><ContentCopyIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>

      <TransformWrapper ref={zoomRef} minScale={0.2} maxScale={5} centerOnInit limitToBounds={false}>
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
          <Box
            ref={containerRef}
            data-testid="mermaid-preview"
            sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, '& svg': { maxWidth: 'none' } }}
          />
        </TransformComponent>
      </TransformWrapper>

      {error && (
        <Box
          data-testid="mermaid-error"
          sx={{ position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1, p: 1 }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/mermaid check-types
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/mermaid/src/mermaid-preview.tsx
git commit -m "feat(mermaid): preview with zoom/pan, error panel, SVG/PNG export"
```

---

## Task A11: split-pane shell + dynamic wrapper + exports

**Files:**
- Create: `packages/mermaid/src/mermaid-board-inner.tsx`, `packages/mermaid/src/mermaid-board.tsx`
- Modify: `packages/mermaid/src/index.ts`

- [ ] **Step 1: `mermaid-board-inner.tsx`** (split pane with draggable divider, default 30/70)

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { useMermaidYjs } from './use-mermaid-yjs'
import { MermaidSourceEditor } from './mermaid-source-editor'
import { MermaidPreview } from './mermaid-preview'
import type { MermaidBoardProps } from './types'

export function MermaidBoardInner({
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  user,
  editable = true,
  className,
}: MermaidBoardProps) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const resources = useMermaidYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })

  // Publish this user's identity so collaborators see name/color on the Monaco
  // cursor (y-monaco renders remote selections from the awareness 'user' field).
  useEffect(() => {
    if (!resources || !user) return
    resources.provider.awareness?.setLocalStateField('user', { name: user.name, color: user.color })
  }, [resources, user])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(30)
  const dragging = useRef(false)

  const onDown = useCallback(() => {
    dragging.current = true
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(70, Math.max(15, pct)))
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!resources) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box ref={wrapRef} className={className} sx={{ display: 'flex', height: '100%', width: '100%', minHeight: 0 }}>
      <Box sx={{ width: `${leftPct}%`, minWidth: 0, borderRight: 1, borderColor: 'divider' }}>
        <MermaidSourceEditor ytext={resources.ytext} provider={resources.provider} mode={mode} editable={editable} />
      </Box>
      <Box
        onMouseDown={onDown}
        data-testid="mermaid-divider"
        sx={{ width: '6px', cursor: 'col-resize', flexShrink: 0, bgcolor: 'divider', '&:hover': { bgcolor: 'primary.main' } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <MermaidPreview ytext={resources.ytext} mode={mode} />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: `mermaid-board.tsx`** (dynamic wrapper, ssr:false — mirrors `packages/excalidraw/src/board.tsx`)

```tsx
'use client'

import dynamic from 'next/dynamic'

import type { MermaidBoardProps } from './types'

// Monaco + mermaid touch window/document at module-eval time, so the inner
// component is loaded via next/dynamic with ssr:false.
const MermaidBoardInnerDynamic = dynamic(
  () => import('./mermaid-board-inner').then((m) => m.MermaidBoardInner),
  { ssr: false },
)

export function MermaidBoard(props: MermaidBoardProps) {
  return <MermaidBoardInnerDynamic {...props} />
}
```

- [ ] **Step 3: Update `src/index.ts`**

```ts
export { MermaidBoard } from './mermaid-board'
export type { MermaidBoardProps, MermaidUser } from './types'
```

- [ ] **Step 4: Type-check + lint**

```bash
pnpm --filter @repo/mermaid check-types && pnpm --filter @repo/mermaid lint
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/mermaid/src/mermaid-board-inner.tsx packages/mermaid/src/mermaid-board.tsx packages/mermaid/src/index.ts
git commit -m "feat(mermaid): split-pane board shell + dynamic ssr:false wrapper"
```

---

## Task A12: yjs persistence snapshot for MERMAID (TDD)

**Files:**
- Modify: `apps/yjs/src/persistence.ts:39-43`
- Test: `apps/yjs/src/persistence.spec.ts`

- [ ] **Step 1: Write the failing test**

Add the `MERMAID` value to the mocked `PageType` and a new test case in `apps/yjs/src/persistence.spec.ts`. Change line 17:

```ts
  PageType: { TEXT: 'TEXT', EXCALIDRAW: 'EXCALIDRAW', GENOGRAM: 'GENOGRAM', MERMAID: 'MERMAID' },
```

Add this test after the GENOGRAM test (before the closing `})` of the describe at line 100):

```ts
  it('MERMAID: saves { source } JSON to content + NO outbox', async () => {
    const doc = new Y.Doc()
    doc.getText('mermaid').insert(0, 'graph TD; A-->B;')

    await storePageDocument({
      pageId: '00000000-0000-0000-0000-000000000001',
      workspaceId: '00000000-0000-0000-0000-000000000002',
      document: doc,
      pageType: 'MERMAID' as never,
    })

    const call = mockTxPageUpdate.mock.calls[0]![0] as {
      data: { content: { source: string }; contentYjs: unknown }
    }
    expect(call.data.content).toEqual({ source: 'graph TD; A-->B;' })
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it — expect FAIL**

```bash
pnpm --filter yjs test -- persistence
```

Expected: FAIL — `content` is `undefined` (no MERMAID branch yet), so `toEqual({ source: ... })` fails.

- [ ] **Step 3: Implement the branch**

In `apps/yjs/src/persistence.ts`, extend the type switch (after the EXCALIDRAW `else if` block ending at line 43):

```ts
  } else if (pageType === PageType.EXCALIDRAW) {
    const yElements = document.getArray('elements')
    const snapshot = { elements: yElements.toJSON() }
    data.content = snapshot as Prisma.InputJsonValue
  } else if (pageType === PageType.MERMAID) {
    data.content = { source: document.getText('mermaid').toString() } as Prisma.InputJsonValue
  }
```

- [ ] **Step 4: Run it — expect PASS**

```bash
pnpm --filter yjs test -- persistence
```

Expected: PASS (all 4 tests: TEXT, EXCALIDRAW, GENOGRAM, MERMAID).

- [ ] **Step 5: Commit**

```bash
git add apps/yjs/src/persistence.ts apps/yjs/src/persistence.spec.ts
git commit -m "feat(yjs): persist MERMAID source snapshot to Page.content"
```

---

## Task A13: page-renderer dispatch branch

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx:45-53` and `:341-362`

- [ ] **Step 1: Add the dynamic import**

After the `Genogram` dynamic import (line 45-48), add:

```tsx
const MermaidBoard = dynamic(() => import('@repo/mermaid').then((m) => m.MermaidBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
```

- [ ] **Step 2: Add the dispatch branch**

After the `GENOGRAM` branch (line 354-358), add:

```tsx
  if (page.type === 'MERMAID') {
    return (
      <MermaidBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={fetchYjsToken}
        user={user}
      />
    )
  }
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): render MERMAID pages via @repo/mermaid"
```

---

## Task A14: page-creation menu entry

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx:7-21`, `:28`, `:85-95`

- [ ] **Step 1: Import `SchemaIcon`**

In the `@repo/ui/components` import block (lines 6-21), add `SchemaIcon` alphabetically (after `MoreHorizIcon`). If `SchemaIcon` is not yet re-exported by `@repo/ui`, add it: open `packages/ui/src/components/index.ts` and add `export { default as SchemaIcon } from '@mui/icons-material/Schema'` alongside the other icon re-exports (match the existing pattern there).

- [ ] **Step 2: Extend `CreatablePageType`**

Change line 28:

```ts
type CreatablePageType = Extract<PageType, 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN'>
```

- [ ] **Step 3: Add the menu item**

In `CreatePageMenu`, after the KANBAN `<MenuItem>` (closes at line 95), add:

```tsx
      <MenuItem
        onClick={() => {
          onCreate('MERMAID')
          onClose()
        }}
      >
        <ListItemIcon>
          <SchemaIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Диаграмма" />
      </MenuItem>
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): add 'Диаграмма' (MERMAID) to create-page menu"
```

---

## Task A15: page-actions unions + full-bleed layout

**Files:**
- Modify: `apps/web/src/components/page/page-actions-menu.tsx:42`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx:26-27`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx:34-35`

- [ ] **Step 1: page-actions-menu union**

Change line 42:

```ts
  pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN'
```

- [ ] **Step 2: page-actions-toolbar coercion**

Change lines 26-27:

```ts
  const pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN' =
    rawType === 'EXCALIDRAW' || rawType === 'GENOGRAM' || rawType === 'MERMAID' || rawType === 'KANBAN'
      ? rawType
      : 'TEXT'
```

- [ ] **Step 3: full-bleed layout**

Change lines 34-35 of the page route:

```tsx
  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'KANBAN'
```

- [ ] **Step 4: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/components/page/page-actions-menu.tsx" "apps/web/src/components/page/page-actions-toolbar.tsx" "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx"
git commit -m "feat(web): treat MERMAID as full-bleed page type in actions + layout"
```

---

## Task A16: E2E spec for the MERMAID page

**Files:**
- Create: `apps/e2e/mermaid-page.spec.ts`

> The Playwright `webServer` starts only Next.js (no yjs server on :1234), so — like `genogram.spec.ts` — assert **in-session** behavior. `y-monaco` updates the local `Y.Text` offline, so the preview renders without a server.

- [ ] **Step 1: Write the spec**

`apps/e2e/mermaid-page.spec.ts`:

```ts
import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupMermaidPage(page: Page) {
  const email = `mermaid+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Mermaid WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  await page.keyboard.type(text)
}

test('renders a mermaid diagram from typed source', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A-->B;')

  const svg = page.locator('[data-testid="mermaid-preview"] svg')
  await expect(svg).toBeVisible({ timeout: 15_000 })
})

test('shows an error panel on invalid syntax', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A--')

  await expect(page.locator('[data-testid="mermaid-error"]')).toBeVisible({ timeout: 15_000 })
})

test('export SVG control is present once a diagram renders', async ({ page }) => {
  await setupMermaidPage(page)
  await typeIntoMonaco(page, 'graph TD; A-->B;')
  await expect(page.locator('[data-testid="mermaid-preview"] svg')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-testid="mermaid-export-svg"]')).toBeVisible()
})
```

- [ ] **Step 2: Run the spec** (requires `docker compose up -d`)

```bash
pnpm exec playwright test apps/e2e/mermaid-page.spec.ts
```

Expected: 3 passed. If Monaco fails to mount (worker error in trace), apply the Task A8 Step 3 fallback and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/mermaid-page.spec.ts
git commit -m "test(e2e): mermaid page renders, errors, and exports"
```

---

## Task A17: Phase A gates + build verification

- [ ] **Step 1: Run the full merge gate**

```bash
pnpm gates
```

Expected: `check-types`, `lint` (`--max-warnings 0`), `build`, and `test` all pass across the workspace, including the new `@repo/mermaid` package and the `web` production build (this is where a Turbopack/webpack Monaco-worker problem would surface).

- [ ] **Step 2: If the production build fails on the Monaco worker**, apply the Task A8 Step 3 `?worker` fallback, re-run `pnpm gates`.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(mermaid): green gates for phase A"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** Tasks A1–A17 cover the `MERMAID` page type. Every spec §7 checklist file maps to a task.
- **Type consistency:** `ColorMode = 'light' | 'dark'` is defined once in `packages/mermaid/src/mermaid-theme.ts` and imported across the package — `renderMermaid(id, source, mode)`, `MermaidBoardProps`, the preview, and the source editor use it consistently.
- **Known third-party verification points (do these as written, not as guesses):** A8 Step 3 (Monaco worker under Turbopack) — a concrete command with a documented fallback.
