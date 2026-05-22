# PlantUML page type + shared diagram-board core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PlantUML diagram page type, a PlantUML preview in the editor's «Код» code block, and a «Диаграмма» submenu (MermaidJS / PlantUML) — rendering PlantUML server-side through a private `plantuml-server:jetty` container proxied by a Next.js route, while extracting a shared `@repo/diagram-board` package that both Mermaid and PlantUML consume.

**Architecture:** Extract the Monaco + Yjs + split-pane + zoom/pan + export board from `@repo/mermaid` into a new `@repo/diagram-board` that exposes one configurable `DiagramBoard` (driven by `{ docName, languageId, registerLanguage, render, idPrefix }`). `@repo/mermaid` keeps its public API unchanged and supplies a client renderer; a new `@repo/plantuml` supplies a server-proxied renderer. The browser never talks to the PlantUML server directly — `renderPlantuml` POSTs source to `/api/plantuml/render`, which encodes it and fetches `GET http://plantuml:8080/svg/<encoded>` (Gotenberg pattern; no Traefik route).

**Tech Stack:** TypeScript, Next.js 16 (App Router, Turbopack), React 19, MUI v7, Tiptap, Monaco + y-monaco, Yjs/Hocuspocus, Prisma 7 (Postgres enum), `plantuml-encoder` (npm), Docker Compose, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-05-22-plantuml-page-and-diagram-board-design.md](../specs/2026-05-22-plantuml-page-and-diagram-board-design.md)

**Preconditions for the whole plan:**
- Work on the existing `feat/mermaid` branch.
- `docker compose up -d` is running (Postgres needed for the migration + e2e; the new `plantuml` service is added in Phase 3).
- Conventional Commits with scope; Husky runs lint-staged + gates on commit (do **not** `--no-verify`).

---

## File Structure

**New package `packages/diagram-board/`** (the shared board core):
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts` — toolchain (mirrors `@repo/mermaid`)
- `src/render-types.ts` — Monaco-free `ColorMode`, `RenderResult`, `DiagramRenderer`
- `src/types.ts` — `DiagramUser`, `DiagramBoardProps`, `DiagramConfig`
- `src/theme.ts` (+ `theme.test.ts`) — generic `monacoThemeForMode`
- `src/monaco-env.ts` — moved verbatim from mermaid (`configureMonaco`)
- `src/export.ts` (+ `export.test.ts`) — moved verbatim from mermaid (SVG/PNG export)
- `src/use-diagram-yjs.ts` — generalized Yjs hook (takes `docName`)
- `src/source-editor.tsx` — generalized Monaco editor (takes `languageId` + `registerLanguage`)
- `src/diagram-preview.tsx` — generalized preview (takes `render` + `idPrefix`)
- `src/board-inner.tsx` — config-driven split-pane board
- `src/board.tsx` — `DiagramBoard` (ssr:false dynamic wrapper)
- `src/index.ts` — public exports

**New package `packages/plantuml/`** (the PlantUML leaf):
- toolchain files (mirror mermaid) + `src/{plantuml-language,plantuml-language.test,render-plantuml,render-plantuml.test,plantuml-board,types,index}.ts(x)`

**New web proxy** `apps/web/src/server/plantuml/{errors,render}.ts`, `apps/web/src/app/api/plantuml/render/route.ts`, `apps/web/src/types/plantuml-encoder.d.ts`, `apps/web/test/plantuml-render.test.ts`

**Modified — `@repo/mermaid`:** `package.json`, `src/render-mermaid.ts`, `src/mermaid-theme.ts` (+ `mermaid-theme.test.ts`), `src/mermaid-board.tsx`, `src/types.ts`; **deleted:** `src/{monaco-env,export,export.test,use-mermaid-yjs,mermaid-source-editor,mermaid-preview,mermaid-board-inner}.ts(x)`

**Modified — web/db/editor:** `packages/db/prisma/schema.prisma` (+ migration), `apps/web/next.config.js`, `apps/web/src/components/workspace/page-tree-section.tsx`, `apps/web/src/components/page/{page-renderer,page-actions-toolbar,page-actions-menu}.tsx`, `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`, `apps/web/package.json`, `packages/editor/src/extensions/code-block.tsx`, `packages/editor/package.json`

**Modified — infra/e2e:** `compose.yml`, `deploy/compose.yml`, `.env.example`, `turbo.json`, `deploy/.env.template`, `playwright.config.ts`, `apps/e2e/mermaid-page.spec.ts`, `apps/e2e/code-block.spec.ts`; **new:** `apps/e2e/plantuml-page.spec.ts`

---

# Phase 1 — Shared `@repo/diagram-board` extraction

> Behaviour-preserving refactor. The regression guard is the existing `@repo/mermaid` unit tests + Mermaid e2e staying green. Phase 1 lands as **two commits**: Task 1 (empty package builds green) and Task 4 (whole extraction green). Tasks 2–3 leave the tree non-compiling intermediately — that is expected; verification is at Task 4.

## Task 1: Scaffold the `@repo/diagram-board` package

**Files:**
- Create: `packages/diagram-board/package.json`
- Create: `packages/diagram-board/tsconfig.json`
- Create: `packages/diagram-board/eslint.config.mjs`
- Create: `packages/diagram-board/vitest.config.ts`
- Create: `packages/diagram-board/src/index.ts` (temporary empty)
- Modify: `apps/web/next.config.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@repo/diagram-board",
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

- [ ] **Step 2: Create `tsconfig.json`** (identical to `packages/mermaid/tsconfig.json`)

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

- [ ] **Step 3: Create `eslint.config.mjs`**

```js
import { config } from "@repo/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default config
```

- [ ] **Step 4: Create `vitest.config.ts`**

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

- [ ] **Step 5: Create a temporary `src/index.ts`** (replaced in Task 3)

```ts
export {}
```

- [ ] **Step 6: Register the package in `apps/web/next.config.js` `transpilePackages`** (only `@repo/diagram-board` here — `@repo/plantuml` is added in Task 5, once it exists, so `web check-types` in Task 4 has no dangling reference)

Replace:
```js
    '@repo/mermaid',
    '@repo/yookassa',
```
with:
```js
    '@repo/diagram-board',
    '@repo/mermaid',
    '@repo/yookassa',
```

- [ ] **Step 7: Install + verify the empty package builds**

Run: `pnpm install && pnpm --filter @repo/diagram-board build`
Expected: install succeeds; `tsc` exits 0 (empty package compiles).

- [ ] **Step 8: Commit**

```bash
git add packages/diagram-board apps/web/next.config.js pnpm-lock.yaml
git commit -m "feat(diagram-board): scaffold shared diagram-board package"
```

---

## Task 2: Move Monaco-free primitives into `@repo/diagram-board`

**Files:**
- Create: `packages/diagram-board/src/render-types.ts`
- Create: `packages/diagram-board/src/theme.ts`
- Create: `packages/diagram-board/src/theme.test.ts`
- Move: `packages/mermaid/src/monaco-env.ts` → `packages/diagram-board/src/monaco-env.ts`
- Move: `packages/mermaid/src/export.ts` → `packages/diagram-board/src/export.ts`
- Move: `packages/mermaid/src/export.test.ts` → `packages/diagram-board/src/export.test.ts`

- [ ] **Step 1: Create `src/render-types.ts`** (Monaco-free — the editor + leaf renderers import only this)

```ts
import type { PaletteMode } from '@mui/material'

export type ColorMode = PaletteMode

export type RenderResult = { ok: true; svg: string } | { ok: false; error: string }

export type DiagramRenderer = (
  id: string,
  source: string,
  mode: ColorMode,
) => Promise<RenderResult>
```

- [ ] **Step 2: Create `src/theme.ts`** (generic Monaco editor theme — `mermaidThemeForMode` stays in `@repo/mermaid`)

```ts
import type { ColorMode } from './render-types'

/** Monaco built-in theme id for the given site color mode. */
export function monacoThemeForMode(mode: ColorMode): 'vs' | 'vs-dark' {
  return mode === 'dark' ? 'vs-dark' : 'vs'
}
```

- [ ] **Step 3: Create `src/theme.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { monacoThemeForMode } from './theme'

describe('monacoThemeForMode', () => {
  it('maps dark → vs-dark and light → vs', () => {
    expect(monacoThemeForMode('dark')).toBe('vs-dark')
    expect(monacoThemeForMode('light')).toBe('vs')
  })
})
```

- [ ] **Step 4: Move `monaco-env.ts`, `export.ts`, `export.test.ts` verbatim** (no content change — they have no mermaid-specific imports)

```bash
git mv packages/mermaid/src/monaco-env.ts packages/diagram-board/src/monaco-env.ts
git mv packages/mermaid/src/export.ts packages/diagram-board/src/export.ts
git mv packages/mermaid/src/export.test.ts packages/diagram-board/src/export.test.ts
```

- [ ] **Step 5: Verify the moved unit tests pass in their new home**

Run: `pnpm --filter @repo/diagram-board test`
Expected: PASS (`theme.test.ts` + `export.test.ts`). (No commit yet — mermaid is intentionally broken until Task 4.)

---

## Task 3: Add the generalized board modules to `@repo/diagram-board`

**Files:**
- Create: `packages/diagram-board/src/use-diagram-yjs.ts`
- Create: `packages/diagram-board/src/source-editor.tsx`
- Create: `packages/diagram-board/src/diagram-preview.tsx`
- Create: `packages/diagram-board/src/board-inner.tsx`
- Create: `packages/diagram-board/src/board.tsx`
- Create: `packages/diagram-board/src/types.ts`
- Modify: `packages/diagram-board/src/index.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
import type * as monaco from 'monaco-editor'
import type { DiagramRenderer } from './render-types'

export type DiagramUser = {
  id: string
  name: string
  color: string
}

export type DiagramBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  user?: DiagramUser
  editable?: boolean
  className?: string
}

export type DiagramConfig = {
  /** Y.Text root name (the collaborative source document). */
  docName: string
  /** Monaco language id set on the editor model. */
  languageId: string
  /** Registers the Monarch language on a Monaco instance (idempotent). */
  registerLanguage: (m: typeof monaco) => void
  /** Produces SVG from source — client-side (mermaid) or server-proxied (plantuml). */
  render: DiagramRenderer
  /** Prefix for render ids and data-testids (e.g. 'mermaid' | 'plantuml'). */
  idPrefix: string
  /** Optional Monaco placeholder shown when the source is empty. */
  placeholder?: string
}
```

- [ ] **Step 2: Create `src/use-diagram-yjs.ts`** (generalized from mermaid's hook — `docName` is now a parameter)

```ts
'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type DiagramYjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  ytext: Y.Text
}

/**
 * Create the Y.Doc + HocuspocusProvider inside useEffect (not useState init) so
 * React StrictMode's mount→unmount→remount doesn't leave destroyed resources in
 * state. The diagram source is a single Y.Text root named `docName`.
 */
export function useDiagramYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  docName: string
}): DiagramYjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs, docName } = args
  const [resources, setResources] = useState<DiagramYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const ytext = ydoc.getText(docName)
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
  }, [pageId, yjsUrl, yjsToken, initialContentYjs, docName])

  return resources
}
```

- [ ] **Step 3: Create `src/source-editor.tsx`** (generalized — `languageId` + `registerLanguage` + `placeholder` are now props)

```tsx
'use client'

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { MonacoBinding } from 'y-monaco'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'
import type * as monaco from 'monaco-editor'

import { configureMonaco } from './monaco-env'
import { monacoThemeForMode } from './theme'
import type { ColorMode } from './render-types'

configureMonaco()

type Props = {
  ytext: Y.Text
  provider: HocuspocusProvider
  mode: ColorMode
  editable: boolean
  languageId: string
  registerLanguage: (m: typeof monaco) => void
  placeholder?: string
}

export function DiagramSourceEditor({
  ytext,
  provider,
  mode,
  editable,
  languageId,
  registerLanguage,
  placeholder,
}: Props) {
  const bindingRef = useRef<MonacoBinding | null>(null)

  const handleMount: OnMount = (editorInstance, monaco) => {
    registerLanguage(monaco)
    const model = editorInstance.getModel()
    if (!model) return
    monaco.editor.setModelLanguage(model, languageId)
    bindingRef.current = new MonacoBinding(
      ytext,
      model,
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
      defaultLanguage={languageId}
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
        placeholder,
      }}
    />
  )
}
```

- [ ] **Step 4: Create `src/diagram-preview.tsx`** (generalized — `render` + `idPrefix` are now props; test-ids are prefixed)

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

import { downloadFilename, svgStringToDataUrl, svgToPngBlob, triggerDownload } from './export'
import type { ColorMode, DiagramRenderer } from './render-types'

type Props = {
  ytext: Y.Text
  mode: ColorMode
  render: DiagramRenderer
  idPrefix: string
}

export function DiagramPreview({ ytext, mode, render, idPrefix }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ReactZoomPanPinchRef>(null)
  const [error, setError] = useState<string | null>(null)
  const lastGoodSvg = useRef<string>('')
  const lastSource = useRef<string | null>(null)
  const genRef = useRef(0)

  const draw = useCallback(
    async (source: string) => {
      if (source === lastSource.current) return // skip no-op updates (remote sync, undo-to-same)
      lastSource.current = source
      const gen = ++genRef.current
      const id = `${idPrefix}-svg-${Math.random().toString(36).slice(2)}`
      const result = await render(id, source, mode)
      if (genRef.current !== gen) return // superseded by a newer render
      if (result.ok) {
        setError(null)
        lastGoodSvg.current = result.svg
        if (containerRef.current) containerRef.current.innerHTML = result.svg
      } else {
        setError(result.error)
      }
    },
    [mode, render, idPrefix],
  )

  useEffect(() => {
    lastSource.current = null // force a render on (re)subscribe and on mode change
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

  const renderPngBlob = async (): Promise<Blob | null> => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return null
    const rect = svgEl.getBoundingClientRect()
    return svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
  }

  const exportSvg = () => {
    if (!lastGoodSvg.current) return
    triggerDownload(svgStringToDataUrl(lastGoodSvg.current), downloadFilename('svg'))
  }

  const exportPng = async () => {
    const blob = await renderPngBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    triggerDownload(url, downloadFilename('png'))
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const copyPng = async () => {
    const blob = await renderPngBlob()
    if (!blob) return
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
          <IconButton size="small" onClick={exportSvg} data-testid={`${idPrefix}-export-svg`}><DownloadIcon fontSize="small" /></IconButton>
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
            data-testid={`${idPrefix}-preview`}
            sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, '& svg': { maxWidth: 'none' } }}
          />
        </TransformComponent>
      </TransformWrapper>

      {error && (
        <Box
          data-testid={`${idPrefix}-error`}
          sx={{ position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1, p: 1 }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 5: Create `src/board-inner.tsx`** (config-driven; divider test-id is prefixed)

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { useDiagramYjs } from './use-diagram-yjs'
import { DiagramSourceEditor } from './source-editor'
import { DiagramPreview } from './diagram-preview'
import type { DiagramBoardProps, DiagramConfig } from './types'

export function DiagramBoardInner({
  config,
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  user,
  editable = true,
  className,
}: DiagramBoardProps & { config: DiagramConfig }) {
  const theme = useTheme()
  const mode = theme.palette.mode
  const resources = useDiagramYjs({ pageId, yjsUrl, yjsToken, initialContentYjs, docName: config.docName })

  // Publish this user's identity so collaborators see name/color on the Monaco
  // cursor. Depend on primitive fields, not the `user` object (built inline upstream).
  const userName = user?.name
  const userColor = user?.color
  useEffect(() => {
    if (!resources || !userName || !userColor) return
    resources.provider.awareness?.setLocalStateField('user', { name: userName, color: userColor })
  }, [resources, userName, userColor])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(30)
  // Divider drag: window listeners only for the gesture (AbortController signal),
  // with Escape/blur fallbacks + rAF throttle, torn down on unmount.
  const stopDragRef = useRef<(() => void) | null>(null)
  const rafRef = useRef<number | null>(null)

  const startDrag = useCallback(() => {
    if (stopDragRef.current) return
    const ctrl = new AbortController()
    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ctrl.abort()
      stopDragRef.current = null
    }
    stopDragRef.current = stop
    const { signal } = ctrl
    window.addEventListener(
      'mousemove',
      (e) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          if (!wrapRef.current) return
          const rect = wrapRef.current.getBoundingClientRect()
          const pct = ((e.clientX - rect.left) / rect.width) * 100
          setLeftPct(Math.min(70, Math.max(15, pct)))
        })
      },
      { signal },
    )
    window.addEventListener('mouseup', stop, { signal })
    window.addEventListener('blur', stop, { signal })
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') stop()
      },
      { signal },
    )
  }, [])

  useEffect(() => () => stopDragRef.current?.(), [])

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
        <DiagramSourceEditor
          ytext={resources.ytext}
          provider={resources.provider}
          mode={mode}
          editable={editable}
          languageId={config.languageId}
          registerLanguage={config.registerLanguage}
          placeholder={config.placeholder}
        />
      </Box>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панелей"
        onMouseDown={startDrag}
        data-testid={`${config.idPrefix}-divider`}
        sx={{ width: '6px', cursor: 'col-resize', flexShrink: 0, bgcolor: 'divider', '&:hover': { bgcolor: 'primary.main' } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <DiagramPreview ytext={resources.ytext} mode={mode} render={config.render} idPrefix={config.idPrefix} />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 6: Create `src/board.tsx`** (the ssr:false dynamic wrapper — Monaco touches `window` at module-eval)

```tsx
'use client'

import dynamic from 'next/dynamic'

import type { DiagramBoardProps, DiagramConfig } from './types'

const DiagramBoardInnerDynamic = dynamic(
  () => import('./board-inner').then((m) => m.DiagramBoardInner),
  { ssr: false },
)

export function DiagramBoard(props: DiagramBoardProps & { config: DiagramConfig }) {
  return <DiagramBoardInnerDynamic {...props} />
}
```

- [ ] **Step 7: Replace `src/index.ts`**

```ts
export { DiagramBoard } from './board'
export { configureMonaco } from './monaco-env'
export { monacoThemeForMode } from './theme'
export * from './export'
export type { DiagramBoardProps, DiagramUser, DiagramConfig } from './types'
export type { ColorMode, RenderResult, DiagramRenderer } from './render-types'
```

- [ ] **Step 8: Type-check the package**

Run: `pnpm --filter @repo/diagram-board check-types`
Expected: exits 0. (Mermaid still broken until Task 4 — do not run mermaid checks yet.)

---

## Task 4: Rewire `@repo/mermaid` onto the shared core (regression guard)

**Files:**
- Modify: `packages/mermaid/package.json`
- Modify: `packages/mermaid/src/render-mermaid.ts`
- Modify: `packages/mermaid/src/mermaid-theme.ts`
- Modify: `packages/mermaid/src/mermaid-theme.test.ts`
- Modify: `packages/mermaid/src/mermaid-board.tsx`
- Modify: `packages/mermaid/src/types.ts`
- Delete: `packages/mermaid/src/{use-mermaid-yjs.ts,mermaid-source-editor.tsx,mermaid-preview.tsx,mermaid-board-inner.tsx}`

- [ ] **Step 1: Add the workspace dep to `packages/mermaid/package.json`**

In `"dependencies"`, add as the first entry:
```json
    "@repo/diagram-board": "workspace:*",
```
(Leave the existing deps in place — harmless; pruning is a non-goal.)

- [ ] **Step 2: Rewrite `src/render-mermaid.ts`** (import `RenderResult`/`ColorMode` from the shared core; re-export `RenderResult` so `@repo/mermaid/render-mermaid` keeps exporting it for the editor)

```ts
import mermaid from 'mermaid'

import type { ColorMode, RenderResult } from '@repo/diagram-board/render-types'
import { mermaidThemeForMode } from './mermaid-theme'

export type { RenderResult }

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
```

- [ ] **Step 3: Trim `src/mermaid-theme.ts`** (drop `ColorMode` def + `monacoThemeForMode`; import `ColorMode` from shared)

```ts
import type { ColorMode } from '@repo/diagram-board/render-types'

/** Mermaid built-in theme name for the given site color mode. */
export function mermaidThemeForMode(mode: ColorMode): 'default' | 'dark' {
  return mode === 'dark' ? 'dark' : 'default'
}
```

- [ ] **Step 4: Replace `src/mermaid-theme.test.ts`** (only the mermaid theme remains here; the Monaco-theme test lives in `@repo/diagram-board`)

```ts
import { describe, expect, it } from 'vitest'
import { mermaidThemeForMode } from './mermaid-theme'

describe('mermaidThemeForMode', () => {
  it('maps dark → dark and light → default', () => {
    expect(mermaidThemeForMode('dark')).toBe('dark')
    expect(mermaidThemeForMode('light')).toBe('default')
  })
})
```

- [ ] **Step 5: Rewrite `src/mermaid-board.tsx`** (thin wrapper over `DiagramBoard`)

```tsx
'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { renderMermaid } from './render-mermaid'
import { MERMAID_LANGUAGE_ID, registerMermaidLanguage } from './mermaid-language'
import type { MermaidBoardProps } from './types'

const mermaidConfig: DiagramConfig = {
  docName: 'mermaid',
  languageId: MERMAID_LANGUAGE_ID,
  registerLanguage: registerMermaidLanguage,
  render: renderMermaid,
  idPrefix: 'mermaid',
  placeholder: 'graph TD;\n  A --> B;',
}

export function MermaidBoard(props: MermaidBoardProps) {
  return <DiagramBoard config={mermaidConfig} {...props} />
}
```

- [ ] **Step 6: Rewrite `src/types.ts`** (re-export the shared types under the existing names — keeps `index.ts` public API unchanged)

```ts
export type { DiagramBoardProps as MermaidBoardProps, DiagramUser as MermaidUser } from '@repo/diagram-board'
```

- [ ] **Step 7: Delete the moved/superseded files**

```bash
git rm packages/mermaid/src/use-mermaid-yjs.ts \
       packages/mermaid/src/mermaid-source-editor.tsx \
       packages/mermaid/src/mermaid-preview.tsx \
       packages/mermaid/src/mermaid-board-inner.tsx
```

- [ ] **Step 8: Install (link the new workspace dep) and run the regression gates**

Run:
```bash
pnpm install
pnpm --filter @repo/diagram-board test
pnpm --filter @repo/mermaid test
pnpm --filter @repo/diagram-board check-types
pnpm --filter @repo/mermaid check-types
pnpm --filter web check-types
```
Expected: all PASS / exit 0. `@repo/mermaid` still exports `MermaidBoard` + `renderMermaid` (verified by `web` type-check, which imports both).

- [ ] **Step 9: Commit the whole extraction**

```bash
git add -A
git commit -m "refactor(diagram-board): extract shared board core; mermaid consumes it"
```

---

# Phase 2 — New `@repo/plantuml` package

## Task 5: Scaffold the `@repo/plantuml` package

**Files:**
- Create: `packages/plantuml/package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`
- Create: `packages/plantuml/src/index.ts` (temporary empty)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@repo/plantuml",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./render-plantuml": {
      "types": "./src/render-plantuml.ts",
      "import": "./src/render-plantuml.ts",
      "default": "./src/render-plantuml.ts"
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
    "@repo/diagram-board": "workspace:*",
    "monaco-editor": "^0.52.2",
    "react": "^19.2.0"
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

- [ ] **Step 2: Create `tsconfig.json`** (identical to the diagram-board one in Task 1 Step 2)

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

- [ ] **Step 3: Create `eslint.config.mjs`**

```js
import { config } from "@repo/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default config
```

- [ ] **Step 4: Create `vitest.config.ts`**

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

- [ ] **Step 5: Create temporary `src/index.ts`**

```ts
export {}
```

- [ ] **Step 6: Register `@repo/plantuml` in `apps/web/next.config.js` `transpilePackages`**

Replace:
```js
    '@repo/diagram-board',
    '@repo/mermaid',
    '@repo/yookassa',
```
with:
```js
    '@repo/diagram-board',
    '@repo/mermaid',
    '@repo/plantuml',
    '@repo/yookassa',
```

- [ ] **Step 7: Install + verify**

Run: `pnpm install && pnpm --filter @repo/plantuml build`
Expected: install succeeds; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/plantuml apps/web/next.config.js pnpm-lock.yaml
git commit -m "feat(plantuml): scaffold @repo/plantuml package"
```

---

## Task 6: PlantUML Monaco language (TDD)

**Files:**
- Create: `packages/plantuml/src/plantuml-language.ts`
- Test: `packages/plantuml/src/plantuml-language.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { PLANTUML_LANGUAGE_ID, registerPlantumlLanguage } from './plantuml-language'

function mockMonaco() {
  const registered: string[] = []
  return {
    languages: {
      getLanguages: () => registered.map((id) => ({ id })),
      register: ({ id }: { id: string }) => {
        registered.push(id)
      },
      setMonarchTokensProvider: vi.fn(),
    },
  } as unknown as typeof import('monaco-editor')
}

describe('registerPlantumlLanguage', () => {
  it('uses the "plantuml" language id', () => {
    expect(PLANTUML_LANGUAGE_ID).toBe('plantuml')
  })

  it('registers the language once (idempotent)', () => {
    const m = mockMonaco()
    registerPlantumlLanguage(m)
    registerPlantumlLanguage(m)
    expect(m.languages.getLanguages().filter((l) => l.id === PLANTUML_LANGUAGE_ID)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @repo/plantuml test`
Expected: FAIL — cannot resolve `./plantuml-language`.

- [ ] **Step 3: Create `src/plantuml-language.ts`**

```ts
import type * as monaco from 'monaco-editor'

export const PLANTUML_LANGUAGE_ID = 'plantuml'

/**
 * Minimal Monarch tokenizer for PlantUML source. Highlights @start/@end
 * directives, common diagram keywords, arrows, strings, and comments. No
 * language server — the base editor worker is enough.
 */
export const plantumlMonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    '@startuml', '@enduml', '@startmindmap', '@endmindmap', '@startgantt', '@endgantt',
    'participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue',
    'class', 'interface', 'abstract', 'enum', 'package', 'namespace', 'component', 'node', 'folder',
    'note', 'left', 'right', 'over', 'of', 'end', 'activate', 'deactivate', 'destroy', 'create',
    'alt', 'else', 'opt', 'loop', 'par', 'break', 'critical', 'group', 'box',
    'if', 'then', 'elseif', 'endif', 'repeat', 'while', 'endwhile', 'fork', 'again',
    'start', 'stop', 'title', 'legend', 'skinparam', 'autonumber', 'hide', 'show', 'as',
  ],
  tokenizer: {
    root: [
      [/\/'/, 'comment', '@comment'],
      [/'.*$/, 'comment'],
      [/(<\|--|--\|>|<--|-->|<-|->|\.\.>|<\.\.|\*--|o--|--|\.\.)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/@\w+/, { cases: { '@keywords': 'keyword', '@default': 'annotation' } }],
      [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[{}():,;]/, 'delimiter'],
    ],
    comment: [
      [/'\//, 'comment', '@pop'],
      [/[^']+/, 'comment'],
      [/'/, 'comment'],
    ],
  },
}

/** Register the plantuml language + tokenizer on a Monaco instance (idempotent). */
export function registerPlantumlLanguage(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === PLANTUML_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: PLANTUML_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(PLANTUML_LANGUAGE_ID, plantumlMonarchLanguage)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @repo/plantuml test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/plantuml/src/plantuml-language.ts packages/plantuml/src/plantuml-language.test.ts
git commit -m "feat(plantuml): Monaco Monarch language for plantuml source"
```

---

## Task 7: PlantUML renderer + board (TDD for the renderer)

**Files:**
- Create: `packages/plantuml/src/render-plantuml.ts`
- Test: `packages/plantuml/src/render-plantuml.test.ts`
- Create: `packages/plantuml/src/plantuml-board.tsx`
- Create: `packages/plantuml/src/types.ts`
- Modify: `packages/plantuml/src/index.ts`

- [ ] **Step 1: Write the failing test for `renderPlantuml`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderPlantuml } from './render-plantuml'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderPlantuml', () => {
  it('short-circuits empty source without a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await renderPlantuml('id', '   ', 'light')
    expect(result).toEqual({ ok: true, svg: '' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns the proxy RenderResult on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, svg: '<svg/>' }), { status: 200 }),
    )
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'dark')
    expect(result).toEqual({ ok: true, svg: '<svg/>' })
  })

  it('maps a thrown fetch error to a RenderResult error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const result = await renderPlantuml('id', '@startuml\nA->B\n@enduml', 'light')
    expect(result).toEqual({ ok: false, error: 'network down' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @repo/plantuml test render-plantuml`
Expected: FAIL — cannot resolve `./render-plantuml`.

- [ ] **Step 3: Create `src/render-plantuml.ts`**

```ts
import type { ColorMode, RenderResult } from '@repo/diagram-board/render-types'

/**
 * Render PlantUML source to SVG by POSTing to the same-origin proxy route
 * (apps/web /api/plantuml/render), which forwards to the private plantuml-server.
 * `id`/`mode` satisfy the DiagramRenderer contract but are unused — the server
 * renders the source as-is. Empty source short-circuits with no request.
 */
export async function renderPlantuml(_id: string, source: string, _mode: ColorMode): Promise<RenderResult> {
  if (!source.trim()) return { ok: true, svg: '' }
  try {
    const res = await fetch('/api/plantuml/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    return (await res.json()) as RenderResult
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @repo/plantuml test render-plantuml`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/types.ts`**

```ts
export type { DiagramBoardProps as PlantumlBoardProps, DiagramUser as PlantumlUser } from '@repo/diagram-board'
```

- [ ] **Step 6: Create `src/plantuml-board.tsx`**

```tsx
'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { renderPlantuml } from './render-plantuml'
import { PLANTUML_LANGUAGE_ID, registerPlantumlLanguage } from './plantuml-language'
import type { PlantumlBoardProps } from './types'

const plantumlConfig: DiagramConfig = {
  docName: 'plantuml',
  languageId: PLANTUML_LANGUAGE_ID,
  registerLanguage: registerPlantumlLanguage,
  render: renderPlantuml,
  idPrefix: 'plantuml',
  placeholder: '@startuml\n\n@enduml',
}

export function PlantumlBoard(props: PlantumlBoardProps) {
  return <DiagramBoard config={plantumlConfig} {...props} />
}
```

- [ ] **Step 7: Replace `src/index.ts`**

```ts
export { PlantumlBoard } from './plantuml-board'
export type { PlantumlBoardProps, PlantumlUser } from './types'
```

- [ ] **Step 8: Type-check + full package test**

Run: `pnpm --filter @repo/plantuml check-types && pnpm --filter @repo/plantuml test`
Expected: exit 0; all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/plantuml/src
git commit -m "feat(plantuml): server-proxied renderer + PlantumlBoard"
```

---

# Phase 3 — PlantUML server infra + render proxy

## Task 8: Local Docker service + env wiring

**Files:**
- Modify: `compose.yml`
- Modify: `.env.example`
- Modify: `turbo.json`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Add the `plantuml` service to `compose.yml`**

Insert this block immediately before the top-level `volumes:` key (after the `gotenberg` service):
```yaml
  plantuml:
    image: plantuml/plantuml-server:jetty
    container_name: anynote-plantuml
    environment:
      # Strictest profile: blocks local-file/URL includes (SSRF/XXE surface).
      PLANTUML_SECURITY_PROFILE: SANDBOX
    ports:
      - "3002:8080"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped

```

- [ ] **Step 2: Add env docs to `.env.example`**

After the Gotenberg block (the `GOTENBERG_TIMEOUT_MS=30000` line), insert:
```
# --- PlantUML diagram rendering ---
# plantuml-server (jetty) HTTP API. Must be a private endpoint — it has no
# built-in auth; the web app proxies it via /api/plantuml/render.
PLANTUML_URL=http://localhost:3002
# Per-request timeout (ms).
PLANTUML_TIMEOUT_MS=15000
```

- [ ] **Step 3: Add the env keys to `turbo.json` `globalEnv`**

After the `"GOTENBERG_URL",` line, insert:
```json
    "PLANTUML_TIMEOUT_MS",
    "PLANTUML_URL",
```

- [ ] **Step 4: Expose `PLANTUML_URL` to the Playwright dev server**

In `playwright.config.ts`, inside `webServer.env`, after the `YOOKASSA_RETURN_URL_BASE: 'http://localhost:3100',` line, add:
```ts
      PLANTUML_URL: process.env.PLANTUML_URL ?? 'http://localhost:3002',
```

- [ ] **Step 5: Start the container and verify it renders**

Run:
```bash
docker compose up -d plantuml
sleep 5
curl -sS -o /dev/null -w "%{http_code}\n" "http://localhost:3002/svg/SyfFKj2rKt3CoKnELR1Io4ZDoSa70000"
```
Expected: `200` (the encoded string is PlantUML's canonical "Bob -> Alice : hello" sample). If the image lacks `wget` for the healthcheck, swap the healthcheck test to `["CMD-SHELL", "curl -fsS http://localhost:8080/ >/dev/null || exit 1"]`.

- [ ] **Step 6: Commit**

```bash
git add compose.yml .env.example turbo.json playwright.config.ts
git commit -m "feat(infra): add private plantuml-server container + env wiring"
```

---

## Task 9: Production deploy wiring

**Files:**
- Modify: `deploy/compose.yml`
- Modify: `deploy/.env.template`

- [ ] **Step 1: Add the `plantuml` service to `deploy/compose.yml`**

Insert after the `gotenberg` service block (before the `web` service):
```yaml
  plantuml:
    image: plantuml/plantuml-server:jetty
    restart: unless-stopped
    # No port mapping: plantuml-server has no built-in auth, so we keep it on the
    # internal compose network. Reached by `web` at http://plantuml:8080 via the
    # /api/plantuml/render proxy.
    environment:
      PLANTUML_SECURITY_PROFILE: SANDBOX
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5

```

- [ ] **Step 2: Add `plantuml` to the `web` service `depends_on`**

In the `web` service's `depends_on:` map (where `gotenberg: condition: service_started` already appears), add:
```yaml
      plantuml:
        condition: service_started
```

- [ ] **Step 3: Add env placeholders to `deploy/.env.template`**

After the `GOTENBERG_TIMEOUT_MS=${GOTENBERG_TIMEOUT_MS}` line, insert:
```
# PlantUML server runs as a sidecar in compose; reached on the internal network.
PLANTUML_URL=${PLANTUML_URL}
PLANTUML_TIMEOUT_MS=${PLANTUML_TIMEOUT_MS}
```

- [ ] **Step 4: Note the deploy workflow values** (follow-up, not a code change here)

The GitHub deploy workflow that runs `envsubst` on `deploy/.env.template` must provide `PLANTUML_URL=http://plantuml:8080` and `PLANTUML_TIMEOUT_MS=15000` (mirrors how `GOTENBERG_URL` is provided). Add these to the workflow env/secrets when deploying.

- [ ] **Step 5: Commit**

```bash
git add deploy/compose.yml deploy/.env.template
git commit -m "feat(deploy): plantuml-server sidecar (internal, no traefik route)"
```

---

## Task 10: Server-side render helper (TDD)

**Files:**
- Modify: `apps/web/package.json` (add `plantuml-encoder`)
- Create: `apps/web/src/types/plantuml-encoder.d.ts`
- Create: `apps/web/src/server/plantuml/errors.ts`
- Create: `apps/web/src/server/plantuml/render.ts`
- Test: `apps/web/test/plantuml-render.test.ts`

- [ ] **Step 1: Add the encoder dependency**

Run: `pnpm --filter web add plantuml-encoder`
Expected: `plantuml-encoder` added to `apps/web/package.json` dependencies; lockfile updated.

- [ ] **Step 2: Create the type declaration `apps/web/src/types/plantuml-encoder.d.ts`** (the package ships no types)

```ts
declare module 'plantuml-encoder' {
  export function encode(text: string): string
  export function decode(encoded: string): string
  const _default: { encode: (text: string) => string; decode: (encoded: string) => string }
  export default _default
}
```

- [ ] **Step 3: Create `apps/web/src/server/plantuml/errors.ts`**

```ts
export class PlantumlTimeoutError extends Error {
  constructor() {
    super('PlantUML request timed out')
    this.name = 'PlantumlTimeoutError'
  }
}

export class PlantumlUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`PlantUML server returned ${status}`)
    this.name = 'PlantumlUpstreamError'
  }
}

export class PlantumlUnreachableError extends Error {
  constructor(reason: string) {
    super(`PlantUML server unreachable: ${reason}`)
    this.name = 'PlantumlUnreachableError'
  }
}
```

- [ ] **Step 4: Write the failing test `apps/web/test/plantuml-render.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderPlantumlSvg } from '../src/server/plantuml/render'
import { PlantumlTimeoutError, PlantumlUpstreamError } from '../src/server/plantuml/errors'

beforeEach(() => {
  process.env.PLANTUML_URL = 'http://plantuml.test'
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderPlantumlSvg', () => {
  it('returns the SVG body on a 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<svg>ok</svg>', { status: 200 }))
    await expect(renderPlantumlSvg('@startuml\nA->B\n@enduml')).resolves.toContain('<svg>ok</svg>')
  })

  it('returns the PlantUML error SVG on a 400 with an svg body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<svg>err</svg>', { status: 400 }))
    await expect(renderPlantumlSvg('bad')).resolves.toContain('<svg>err</svg>')
  })

  it('throws PlantumlUpstreamError on a 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    await expect(renderPlantumlSvg('x')).rejects.toBeInstanceOf(PlantumlUpstreamError)
  })

  it('throws PlantumlTimeoutError when fetch aborts', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    await expect(renderPlantumlSvg('x')).rejects.toBeInstanceOf(PlantumlTimeoutError)
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter web test plantuml-render`
Expected: FAIL — cannot resolve `../src/server/plantuml/render`.

- [ ] **Step 6: Create `apps/web/src/server/plantuml/render.ts`**

```ts
import plantumlEncoder from 'plantuml-encoder'

import { PlantumlTimeoutError, PlantumlUnreachableError, PlantumlUpstreamError } from './errors'

const DEFAULT_TIMEOUT_MS = 15_000

function getEnv(key: string, fallback?: string): string {
  const v = process.env[key]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required env: ${key}`)
}

/**
 * Render PlantUML source to an SVG string via the private plantuml-server. The
 * source is encoded into the URL path (deflate + PlantUML base64). PlantUML
 * returns its own error *diagram* (an SVG, usually HTTP 400) for invalid input —
 * we return that SVG so the user sees the rendered error. Only network failures,
 * 5xx, and non-SVG 4xx responses surface as errors.
 */
export async function renderPlantumlSvg(source: string): Promise<string> {
  const base = getEnv('PLANTUML_URL')
  const timeoutMs = Number(getEnv('PLANTUML_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS)))
  const encoded = plantumlEncoder.encode(source)
  const url = `${base}/svg/${encoded}`

  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') throw new PlantumlTimeoutError()
    throw new PlantumlUnreachableError((err as Error).message)
  }

  const body = await res.text()
  const looksLikeSvg = body.includes('<svg')
  if (res.ok || (res.status >= 400 && res.status < 500 && looksLikeSvg)) {
    if (!looksLikeSvg) throw new PlantumlUpstreamError(res.status, body.slice(0, 500))
    return body
  }
  throw new PlantumlUpstreamError(res.status, body.slice(0, 500))
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm --filter web test plantuml-render`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/src/types/plantuml-encoder.d.ts apps/web/src/server/plantuml pnpm-lock.yaml
git commit -m "feat(web): plantuml render helper (encode + proxy fetch)"
```

---

## Task 11: The `/api/plantuml/render` route

**Files:**
- Create: `apps/web/src/app/api/plantuml/render/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getSession } from '@/lib/get-session'
import { renderPlantumlSvg } from '@/server/plantuml/render'
import {
  PlantumlTimeoutError,
  PlantumlUnreachableError,
  PlantumlUpstreamError,
} from '@/server/plantuml/errors'

export const runtime = 'nodejs'

const bodySchema = z.object({ source: z.string().min(1).max(20_000) })

export async function POST(req: Request) {
  // Auth-gate so the proxy can't be used as an open SSRF relay.
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let source: string
  try {
    source = bodySchema.parse(await req.json()).source
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const svg = await renderPlantumlSvg(source)
    return NextResponse.json({ ok: true, svg }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    if (err instanceof PlantumlTimeoutError) {
      return NextResponse.json({ ok: false, error: 'PlantUML render timed out' }, { status: 504 })
    }
    if (err instanceof PlantumlUpstreamError || err instanceof PlantumlUnreachableError) {
      return NextResponse.json({ ok: false, error: 'PlantUML server error' }, { status: 502 })
    }
    return NextResponse.json({ ok: false, error: 'Render failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check, then smoke-test the route end to end**

Run: `pnpm --filter web check-types`
Expected: exit 0.

Then verify the proxy works against the running container (requires `docker compose up -d plantuml` and a dev server). With the dev server running on 3000:
```bash
curl -sS -X POST http://localhost:3000/api/plantuml/render \
  -H 'content-type: application/json' \
  -d '{"source":"@startuml\nAlice -> Bob: hi\n@enduml"}' -o /dev/null -w "%{http_code}\n"
```
Expected: `401` without a session cookie (confirms the auth gate). The authenticated path is covered by the Phase 6 e2e.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/plantuml/render/route.ts
git commit -m "feat(web): auth-gated /api/plantuml/render proxy route"
```

---

# Phase 4 — PLANTUML page type

> Preconditions: `docker compose up -d` (Postgres). The migration + `prisma generate` must run **before** the type-dependent edits (Tasks 13–15) compile, because they reference the new `PLANTUML` enum value via `@repo/db`.

## Task 12: Prisma enum + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_plantuml_page_type/migration.sql` (generated)

- [ ] **Step 1: Add `PLANTUML` to the `PageType` enum**

In `packages/db/prisma/schema.prisma`, change:
```prisma
  MERMAID
  DATABASE
```
to:
```prisma
  MERMAID
  PLANTUML
  DATABASE
```

- [ ] **Step 2: Create + apply the migration and regenerate the client**

Run: `pnpm --filter @repo/db exec prisma migrate dev --name add_plantuml_page_type`
Expected: a new migration containing `ALTER TYPE "PageType" ADD VALUE 'PLANTUML';` is created and applied; Prisma client regenerates. (`@repo/db`'s `PageType` now includes `PLANTUML`.)

- [ ] **Step 3: Verify the generated migration SQL**

Run: `git status --porcelain packages/db/prisma/migrations`
Expected: one new migration directory `*_add_plantuml_page_type/migration.sql`. Open it and confirm it is exactly `ALTER TYPE "PageType" ADD VALUE 'PLANTUML';`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add PLANTUML to PageType enum + migration"
```

---

## Task 13: Render the PlantUML page

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Add the dynamic import** (after the `MermaidBoard` dynamic import, ~line 53)

After:
```tsx
const MermaidBoard = dynamic(() => import('@repo/mermaid').then((m) => m.MermaidBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
```
insert:
```tsx
const PlantumlBoard = dynamic(() => import('@repo/plantuml').then((m) => m.PlantumlBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
```

- [ ] **Step 2: Add the `PLANTUML` render branch** (after the `MERMAID` branch, ~line 375)

After the closing `}` of the `if (page.type === 'MERMAID') { … }` block, insert:
```tsx
  if (page.type === 'PLANTUML') {
    return (
      <PlantumlBoard
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

Run: `pnpm --filter web check-types`
Expected: exit 0 (`PlantumlBoard` props match `PlantumlBoardProps`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): render PLANTUML pages with PlantumlBoard"
```

---

## Task 14: «Диаграмма» submenu in the create-page menu

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`

- [ ] **Step 1: Add `PLANTUML` to `CreatablePageType`**

Change:
```ts
type CreatablePageType = Extract<PageType, 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN'>
```
to:
```ts
type CreatablePageType = Extract<
  PageType,
  'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'KANBAN'
>
```

- [ ] **Step 2: Replace the single «Диаграмма» `MenuItem` with a click-opened submenu**

Replace this block (the MERMAID menu item):
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
with:
```tsx
      <DiagramSubmenu onCreate={onCreate} onClose={onClose} />
```

- [ ] **Step 3: Add the `DiagramSubmenu` component** (place it directly above `CreatePageMenu` in the same file; `useState`, `Menu`, `MenuItem`, `ListItemIcon`, `ListItemText`, `SchemaIcon`, `ChevronRightIcon` are all already imported)

```tsx
function DiagramSubmenu({
  onCreate,
  onClose,
}: {
  onCreate: (type: CreatablePageType) => void
  onClose: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const choose = (type: CreatablePageType) => {
    onCreate(type)
    setAnchor(null)
    onClose()
  }
  return (
    <>
      <MenuItem onClick={(e) => setAnchor(e.currentTarget)}>
        <ListItemIcon>
          <SchemaIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Диаграмма" />
        <ChevronRightIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
      </MenuItem>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={() => choose('MERMAID')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="MermaidJS" />
        </MenuItem>
        <MenuItem onClick={() => choose('PLANTUML')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="PlantUML" />
        </MenuItem>
      </Menu>
    </>
  )
}
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: exit 0 / no warnings.

- [ ] **Step 5: Manual smoke (optional but recommended)**

With a dev server up, open the create-page menu in the sidebar → click «Диаграмма» → confirm a submenu shows «MermaidJS» and «PlantUML»; clicking «MermaidJS» creates a Mermaid page (existing behavior), «PlantUML» creates a PlantUML page.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx
git commit -m "feat(web): «Диаграмма» submenu with MermaidJS / PlantUML"
```

---

## Task 15: Type unions for the page chrome

**Files:**
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx`
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`

- [ ] **Step 1: `page-actions-toolbar.tsx` — widen the narrowing**

Replace:
```tsx
  const pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN' =
    rawType === 'EXCALIDRAW' || rawType === 'GENOGRAM' || rawType === 'MERMAID' || rawType === 'KANBAN'
      ? rawType
      : 'TEXT'
```
with:
```tsx
  const pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'KANBAN' =
    rawType === 'EXCALIDRAW' ||
    rawType === 'GENOGRAM' ||
    rawType === 'MERMAID' ||
    rawType === 'PLANTUML' ||
    rawType === 'KANBAN'
      ? rawType
      : 'TEXT'
```

- [ ] **Step 2: `page-actions-menu.tsx` — widen the prop type**

Replace:
```tsx
  pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'KANBAN'
```
with:
```tsx
  pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'KANBAN'
```

- [ ] **Step 3: `[pageId]/page.tsx` — add PLANTUML to the full-bleed check**

Replace:
```tsx
  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'KANBAN'
```
with:
```tsx
  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'PLANTUML' ||
    page.type === 'KANBAN'
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter web check-types`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/page-actions-toolbar.tsx \
        apps/web/src/components/page/page-actions-menu.tsx \
        "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx"
git commit -m "feat(web): include PLANTUML in page chrome type unions + full-bleed"
```

---

# Phase 5 — Editor «Код» block PlantUML preview

## Task 16: Extend the code-block node view for PlantUML

**Files:**
- Modify: `packages/editor/package.json`
- Modify: `packages/editor/src/extensions/code-block.tsx`

- [ ] **Step 1: Add the workspace dep to `packages/editor/package.json`**

In `"dependencies"`, add (alongside the existing `"@repo/mermaid": "workspace:*"`):
```json
    "@repo/plantuml": "workspace:*",
```
Then run `pnpm install`.

- [ ] **Step 2: Import the PlantUML renderer in `code-block.tsx`**

After:
```tsx
import { renderMermaid, type RenderResult } from '@repo/mermaid/render-mermaid'
```
add:
```tsx
import { renderPlantuml } from '@repo/plantuml/render-plantuml'
```

- [ ] **Step 3: Add `plantuml` to the language picker**

In `CODE_LANGUAGES`, after `{ value: 'mermaid', label: 'Mermaid' },` add:
```tsx
  { value: 'plantuml', label: 'PlantUML' },
```

- [ ] **Step 4: Make the node view diagram-aware**

Replace:
```tsx
function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  const mode = useTheme().palette.mode
  const source = node.textContent
  // Default an existing (non-empty) block to the rendered preview; a freshly
  // inserted empty block opens in Код so the author can type the source first.
  const [view, setView] = useState<'code' | 'preview'>(() => (source.trim() ? 'preview' : 'code'))
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const showPreview = isMermaid && view === 'preview'

  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    // Fresh id per render: reusing one id makes mermaid.render throw an
    // "element already exists" error across repeated renders (cf. mermaid-preview.tsx).
    const renderId = `cb-mermaid-${Math.random().toString(36).slice(2)}`
    void renderMermaid(renderId, source, mode).then((result: RenderResult) => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [showPreview, source, mode])
```
with:
```tsx
function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  const isPlantuml = node.attrs.language === 'plantuml'
  const isDiagram = isMermaid || isPlantuml
  const mode = useTheme().palette.mode
  const source = node.textContent
  // Default an existing (non-empty) block to the rendered preview; a freshly
  // inserted empty block opens in Код so the author can type the source first.
  const [view, setView] = useState<'code' | 'preview'>(() => (source.trim() ? 'preview' : 'code'))
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const showPreview = isDiagram && view === 'preview'

  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    // mermaid renders client-side; plantuml renders server-side via the proxy
    // (renderPlantuml POSTs to /api/plantuml/render). Fresh id per render avoids
    // mermaid's "element already exists" error across repeated renders.
    const render = isPlantuml ? renderPlantuml : renderMermaid
    const renderId = `cb-diagram-${Math.random().toString(36).slice(2)}`
    void render(renderId, source, mode).then((result: RenderResult) => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [showPreview, isPlantuml, source, mode])
```

- [ ] **Step 5: Show the Код↔Просмотр toggle for any diagram block**

Replace:
```tsx
        {isMermaid && (
          <ToggleButtonGroup
```
with:
```tsx
        {isDiagram && (
          <ToggleButtonGroup
```

- [ ] **Step 6: Type-check + lint + editor unit tests**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter @repo/editor test`
Expected: exit 0 / no warnings / tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/editor/package.json packages/editor/src/extensions/code-block.tsx pnpm-lock.yaml
git commit -m "feat(editor): PlantUML Код↔Просмотр preview in code block"
```

---

# Phase 6 — E2E + final verification

> All PlantUML e2e tests require the `plantuml` container running and reachable at `PLANTUML_URL` (set in `compose.yml` + `playwright.config.ts`). Run `docker compose up -d` first. CI must `docker compose up` the new service.

## Task 17: Update + add Playwright specs

**Files:**
- Modify: `apps/e2e/mermaid-page.spec.ts`
- Create: `apps/e2e/plantuml-page.spec.ts`
- Modify: `apps/e2e/code-block.spec.ts`

- [ ] **Step 1: Update the Mermaid create-flow for the submenu**

In `apps/e2e/mermaid-page.spec.ts`, replace:
```ts
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
```
with:
```ts
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'MermaidJS' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
```

- [ ] **Step 2: Verify the Mermaid specs still pass** (regression check for the submenu change)

Run: `pnpm exec playwright test apps/e2e/mermaid-page.spec.ts`
Expected: 3 PASS.

- [ ] **Step 3: Create `apps/e2e/plantuml-page.spec.ts`**

```ts
import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupPlantumlPage(page: Page) {
  const email = `plantuml+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('PlantUML WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'PlantUML' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  await page.keyboard.type(text)
}

test('renders a plantuml diagram from typed source', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice -> Bob: hi\n@enduml')

  const svg = page.locator('[data-testid="plantuml-preview"] svg')
  await expect(svg).toBeVisible({ timeout: 20_000 })
})

test('export SVG control is present once a plantuml diagram renders', async ({ page }) => {
  await setupPlantumlPage(page)
  await typeIntoMonaco(page, '@startuml\nAlice -> Bob: hi\n@enduml')
  await expect(page.locator('[data-testid="plantuml-preview"] svg')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="plantuml-export-svg"]')).toBeVisible()
})
```

- [ ] **Step 4: Add a PlantUML code-block preview test to `apps/e2e/code-block.spec.ts`**

Append:
```ts
test('plantuml code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('plantuml')
  await page.getByRole('button', { name: 'PlantUML' }).click()
  await page.keyboard.type('@startuml\nAlice->Bob: hi\n@enduml')

  await page.getByRole('button', { name: 'Просмотр' }).click()
  await expect(page.locator('.anynote-code-block__preview svg').first()).toBeVisible({
    timeout: 20_000,
  })
})
```

- [ ] **Step 5: Run the new PlantUML specs**

Run: `docker compose up -d plantuml && pnpm exec playwright test apps/e2e/plantuml-page.spec.ts apps/e2e/code-block.spec.ts`
Expected: all PASS (plantuml page renders an SVG; code-block plantuml preview renders an SVG; existing code-block tests still pass).

- [ ] **Step 6: Commit**

```bash
git add apps/e2e/mermaid-page.spec.ts apps/e2e/plantuml-page.spec.ts apps/e2e/code-block.spec.ts
git commit -m "test(e2e): plantuml page + code-block preview; mermaid submenu fix"
```

---

## Task 18: Full gates + branch verification

- [ ] **Step 1: Run the full merge gate**

Run: `pnpm gates`
Expected: `check-types` + `lint` (`--max-warnings 0`) + `build` + `test` all green across the workspace.

- [ ] **Step 2: Run the full e2e suite** (with `docker compose up -d` running, including `plantuml`)

Run: `pnpm exec playwright test apps/e2e/mermaid-page.spec.ts apps/e2e/plantuml-page.spec.ts apps/e2e/code-block.spec.ts`
Expected: all PASS.

- [ ] **Step 3: Update CLAUDE.md package docs** (reflect the new packages)

In `CLAUDE.md`, under the Packages list, add entries for `@repo/diagram-board` (shared Monaco+Yjs split-pane diagram board consumed by mermaid/plantuml) and `@repo/plantuml` (PlantUML page; server-rendered via `/api/plantuml/render` → private `plantuml-server:jetty`), and add both to the documented `transpilePackages` list. Note that PlantUML rendering is server-side (Gotenberg-style proxy), unlike Mermaid's client-side render.

- [ ] **Step 4: Commit the docs**

```bash
git add CLAUDE.md
git commit -m "docs: document @repo/diagram-board + @repo/plantuml"
```

- [ ] **Step 5: Finish the development branch**

Use the superpowers:finishing-a-development-branch skill to choose how to integrate `feat/mermaid` (this work continues that branch). Confirm with the user before merging or opening a PR.

---

## Notes / known caveats (carry into execution)

- **Submenu fallback:** if the nested-`Menu` interaction proves flaky in e2e (focus fighting between stacked MUI modals), fall back to a flat list — a «Диаграмма» `ListSubheader` over two sibling items «MermaidJS» / «PlantUML» — and update the e2e to click the items directly (no parent click). Keep the nested submenu if it works.
- **PLANTUML_SECURITY_PROFILE:** `SANDBOX` is the strictest; if a needed diagram type fails to render under it, step up to `SECURE`. Confirm the enum value against the [plantuml-server README](https://github.com/plantuml/plantuml-server/blob/master/README.md).
- **Monaco typing in e2e:** auto-indent on `\n` is harmless for PlantUML (no bracket auto-close in `Alice -> Bob`). If a future bracketed sample flakes, type the source via `editor.fill()`-style insertion instead of char-by-char.
- **Dependency pruning:** `@repo/mermaid` keeps its old board deps after Task 4 (harmless). Pruning them is an optional follow-up, not part of this plan.
