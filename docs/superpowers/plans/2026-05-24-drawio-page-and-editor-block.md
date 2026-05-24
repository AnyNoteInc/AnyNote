# Draw.io Page Type + Editor Embed Block — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Draw.io (diagrams.net) as both a full-page `DRAWIO` page type (collaborative via Yjs `Y.Text`) and an inline "Встраивание → Draw.io" editor block, embedding the editor through `react-drawio`.

**Architecture:** A new `@repo/drawio` package renders a full-width `react-drawio` iframe whose mxGraph XML lives in a `Y.Text('drawio')` (autosave→write, remote→reload, last-writer-wins). In `@repo/editor`, a new `drawio` block node stores `xml` + a rendered `svg` inline as node attributes; a full-screen editor dialog (our own Отмена/Сохранить toolbar) drives create/edit, and a viewer dialog shows the image. The draw.io iframe origin is a configurable `NEXT_PUBLIC_DRAWIO_URL` (default `https://embed.diagrams.net`) threaded as a prop.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Turborepo + pnpm, Prisma 7 (Postgres enum), Yjs + Hocuspocus, Tiptap v3, MUI v7, `react-drawio@^1.0.7`, Vitest (node env), Playwright.

**Spec:** [docs/superpowers/specs/2026-05-24-drawio-page-and-editor-block-design.md](../specs/2026-05-24-drawio-page-and-editor-block-design.md)

**Conventions:** Prettier = no semicolons, single quotes, 100-char width. Commit style = Conventional Commits with scope (e.g. `feat(drawio): …`). Do not bypass husky.

---

## Task 1: `NEXT_PUBLIC_DRAWIO_URL` env + `resolveDrawioUrl()`

**Files:**
- Modify: `.env.example` (after line 45, the `YJS_PORT` line)
- Modify: `turbo.json` (the `globalEnv` array, near `NEXT_PUBLIC_YJS_URL`)
- Create: `apps/web/src/lib/drawio-config.ts`
- Test: `apps/web/test/drawio-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/drawio-config.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'

import { resolveDrawioUrl } from '../src/lib/drawio-config'

describe('resolveDrawioUrl', () => {
  const original = process.env.NEXT_PUBLIC_DRAWIO_URL

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DRAWIO_URL
    else process.env.NEXT_PUBLIC_DRAWIO_URL = original
  })

  it('falls back to embed.diagrams.net when unset', () => {
    delete process.env.NEXT_PUBLIC_DRAWIO_URL
    expect(resolveDrawioUrl()).toBe('https://embed.diagrams.net')
  })

  it('returns the configured url when set', () => {
    process.env.NEXT_PUBLIC_DRAWIO_URL = 'https://draw.example.com'
    expect(resolveDrawioUrl()).toBe('https://draw.example.com')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test drawio-config`
Expected: FAIL — `Cannot find module '../src/lib/drawio-config'`.

- [ ] **Step 3: Create the implementation**

Create `apps/web/src/lib/drawio-config.ts`:

```ts
'use client'

const DEFAULT_DRAWIO_URL = 'https://embed.diagrams.net'

// NEXT_PUBLIC_DRAWIO_URL is inlined at build time. Read it at call time so tests
// (and any runtime override) see the current value. Point it at a self-hosted
// jgraph/drawio instance to avoid the diagrams.net CDN.
export function resolveDrawioUrl(): string {
  return process.env.NEXT_PUBLIC_DRAWIO_URL || DEFAULT_DRAWIO_URL
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test drawio-config`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the env var to `.env.example` and `turbo.json`**

In `.env.example`, add immediately after the `YJS_PORT=1234` line:

```bash
# Draw.io embed iframe origin. Default is the public diagrams.net embed.
# Point at a self-hosted jgraph/drawio instance to avoid the external CDN.
NEXT_PUBLIC_DRAWIO_URL=https://embed.diagrams.net
```

In `turbo.json`, add `"NEXT_PUBLIC_DRAWIO_URL",` to the `globalEnv` array immediately after the `"NEXT_PUBLIC_YJS_URL",` entry.

- [ ] **Step 6: Verify check-types + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .env.example turbo.json apps/web/src/lib/drawio-config.ts apps/web/test/drawio-config.test.ts
git commit -m "feat(drawio): add NEXT_PUBLIC_DRAWIO_URL config + resolveDrawioUrl"
```

---

## Task 2: Prisma `DRAWIO` page type + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (the `enum PageType` block)
- Create: a new migration under `packages/db/prisma/migrations/`

- [ ] **Step 1: Ensure local Postgres is up**

Run: `docker compose up -d`
Expected: postgres/minio/qdrant/gotenberg healthy.

- [ ] **Step 2: Add `DRAWIO` to the enum**

In `packages/db/prisma/schema.prisma`, add `DRAWIO` to `enum PageType` (after `LIKEC4`):

```prisma
enum PageType {
  TEXT
  EXCALIDRAW
  GENOGRAM
  MERMAID
  PLANTUML
  LIKEC4
  DRAWIO
  DATABASE
  KANBAN
  FORM
}
```

- [ ] **Step 3: Generate + apply the migration**

Run: `pnpm --filter @repo/db exec prisma migrate dev --name add_drawio_page_type`
Expected: creates `packages/db/prisma/migrations/<timestamp>_add_drawio_page_type/migration.sql` and applies it.

- [ ] **Step 4: Verify the migration SQL**

Run: `cat packages/db/prisma/migrations/*add_drawio_page_type/migration.sql`
Expected: contains `ALTER TYPE "PageType" ADD VALUE 'DRAWIO';`

- [ ] **Step 5: Regenerate the client + check-types**

Run: `pnpm --filter @repo/db prisma:generate && pnpm --filter @repo/db check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(drawio): add DRAWIO to PageType enum"
```

---

## Task 3: Scaffold the `@repo/drawio` package

**Files:**
- Create: `packages/drawio/package.json`
- Create: `packages/drawio/tsconfig.json`
- Create: `packages/drawio/eslint.config.mjs`

- [ ] **Step 1: Create `packages/drawio/package.json`**

```json
{
  "name": "@repo/drawio",
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
    "@mui/material": "^7.3.10",
    "react": "^19.2.0",
    "react-drawio": "^1.0.7",
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

- [ ] **Step 2: Create `packages/drawio/tsconfig.json`**

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

- [ ] **Step 3: Create `packages/drawio/eslint.config.mjs`**

```js
import { config } from "@repo/eslint-config/react-internal"

/** @type {import("eslint").Linter.Config} */
export default config
```

- [ ] **Step 4: Install (links the workspace package + pulls react-drawio)**

Run: `pnpm install`
Expected: `react-drawio` resolved; `@repo/drawio` linked.

- [ ] **Step 5: Commit**

```bash
git add packages/drawio/package.json packages/drawio/tsconfig.json packages/drawio/eslint.config.mjs pnpm-lock.yaml
git commit -m "feat(drawio): scaffold @repo/drawio package"
```

---

## Task 4: Yjs sync helper (TDD) + `useDrawioYjs`

**Files:**
- Create: `packages/drawio/src/sync.ts`
- Test: `packages/drawio/src/sync.test.ts`
- Create: `packages/drawio/src/use-drawio-yjs.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/drawio/src/sync.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { writeXmlToYText } from './sync'

describe('writeXmlToYText', () => {
  it('replaces the entire Y.Text content', () => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('drawio')
    writeXmlToYText(ydoc, ytext, '<mxfile>a</mxfile>')
    expect(ytext.toString()).toBe('<mxfile>a</mxfile>')
    writeXmlToYText(ydoc, ytext, '<mxfile>b</mxfile>')
    expect(ytext.toString()).toBe('<mxfile>b</mxfile>')
  })

  it('writes in a local transaction so the reload observer can skip it', () => {
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('drawio')
    const localFlags: boolean[] = []
    ytext.observe((_event, tx) => localFlags.push(tx.local))
    writeXmlToYText(ydoc, ytext, '<mxfile/>')
    expect(localFlags).toEqual([true])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/drawio test`
Expected: FAIL — `Cannot find module './sync'`.

- [ ] **Step 3: Create `packages/drawio/src/sync.ts`**

```ts
import type * as Y from 'yjs'

/**
 * Replace the entire Y.Text content with `xml` in a single local transaction.
 * Running in one transaction means the board's observer sees exactly one event
 * with `transaction.local === true`, which it uses to skip reloading the iframe
 * from our own write (only remote peers' saves trigger a reload).
 */
export function writeXmlToYText(ydoc: Y.Doc, ytext: Y.Text, xml: string): void {
  ydoc.transact(() => {
    if (ytext.length > 0) ytext.delete(0, ytext.length)
    if (xml) ytext.insert(0, xml)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/drawio test`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `packages/drawio/src/use-drawio-yjs.ts`**

```ts
'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

export type DrawioYjsResources = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  ytext: Y.Text
}

/**
 * Create the Y.Doc + HocuspocusProvider inside useEffect (not useState init) so
 * React StrictMode's mount→unmount→remount doesn't leave destroyed resources in
 * state. The diagram source (mxGraph XML) is a single Y.Text root named 'drawio'.
 */
export function useDrawioYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
}): DrawioYjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = args
  const [resources, setResources] = useState<DrawioYjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const ytext = ydoc.getText('drawio')
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
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

- [ ] **Step 6: Verify check-types + lint**

Run: `pnpm --filter @repo/drawio check-types && pnpm --filter @repo/drawio lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/drawio/src/sync.ts packages/drawio/src/sync.test.ts packages/drawio/src/use-drawio-yjs.ts
git commit -m "feat(drawio): yjs sync helper + useDrawioYjs hook"
```

---

## Task 5: `@repo/drawio` board (types, inner, wrapper, index)

**Files:**
- Create: `packages/drawio/src/types.ts`
- Create: `packages/drawio/src/board-inner.tsx`
- Create: `packages/drawio/src/board.tsx`
- Create: `packages/drawio/src/index.ts`

- [ ] **Step 1: Create `packages/drawio/src/types.ts`**

```ts
export type DrawioUser = {
  id: string
  name: string
  color: string
}

export type DrawioBoardProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
  /** Draw.io embed iframe origin (e.g. https://embed.diagrams.net). */
  drawioUrl: string
  user?: DrawioUser
  editable?: boolean
  className?: string
}
```

- [ ] **Step 2: Create `packages/drawio/src/board-inner.tsx`**

```tsx
'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Box } from '@mui/material'
import { DrawIoEmbed, type DrawIoEmbedRef } from 'react-drawio'
import type * as Y from 'yjs'

import { useDrawioYjs } from './use-drawio-yjs'
import { writeXmlToYText } from './sync'
import type { DrawioBoardProps } from './types'

export function DrawioBoardInner({
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  drawioUrl,
  className,
}: DrawioBoardProps) {
  const resources = useDrawioYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })
  const drawioRef = useRef<DrawIoEmbedRef>(null)
  // Read the stored XML once for the iframe's initial load. Remote updates after
  // mount are applied imperatively via load() in the observer below.
  const initialXml = useMemo(() => resources?.ytext.toString() ?? '', [resources])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reload the iframe when a *remote* peer saves. Our own debounced write runs in
  // a local transaction (writeXmlToYText), so tx.local === true filters it out and
  // we never reload from our own keystrokes.
  useEffect(() => {
    if (!resources) return
    const { ytext } = resources
    const onChange = (_event: Y.YTextEvent, tx: Y.Transaction) => {
      if (tx.local) return
      drawioRef.current?.load({ xml: ytext.toString() })
    }
    ytext.observe(onChange)
    return () => ytext.unobserve(onChange)
  }, [resources])

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    [],
  )

  if (!resources) return null

  const handleAutoSave = (data: { xml: string }) => {
    const xml = data.xml
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      writeXmlToYText(resources.ydoc, resources.ytext, xml)
    }, 600)
  }

  return (
    <Box
      className={className}
      sx={{ height: '100%', width: '100%', '& iframe': { border: 0, width: '100%', height: '100%' } }}
    >
      <DrawIoEmbed
        ref={drawioRef}
        baseUrl={drawioUrl}
        autosave
        xml={initialXml || undefined}
        urlParameters={{ spin: true }}
        onAutoSave={handleAutoSave}
      />
    </Box>
  )
}
```

> If `pnpm --filter @repo/drawio check-types` complains that `onAutoSave`'s argument doesn't have `.xml`, remove the `: { xml: string }` annotation on `handleAutoSave` and let it infer from the prop, then read the correct field name from react-drawio's exported event type.

- [ ] **Step 3: Create `packages/drawio/src/board.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'

import type { DrawioBoardProps } from './types'

const DrawioBoardInnerDynamic = dynamic(
  () => import('./board-inner').then((m) => m.DrawioBoardInner),
  { ssr: false },
)

export function DrawioBoard(props: DrawioBoardProps) {
  return <DrawioBoardInnerDynamic {...props} />
}
```

- [ ] **Step 4: Create `packages/drawio/src/index.ts`**

```ts
export { DrawioBoard } from './board'
export type { DrawioBoardProps, DrawioUser } from './types'
```

- [ ] **Step 5: Verify check-types + lint**

Run: `pnpm --filter @repo/drawio check-types && pnpm --filter @repo/drawio lint`
Expected: PASS. (If `react-drawio` ships no bundled types, add a `declare module 'react-drawio'` ambient or a `@types` shim and re-run.)

- [ ] **Step 6: Commit**

```bash
git add packages/drawio/src/types.ts packages/drawio/src/board-inner.tsx packages/drawio/src/board.tsx packages/drawio/src/index.ts
git commit -m "feat(drawio): full-page DrawioBoard with Yjs load/save sync"
```

---

## Task 6: Wire the `DRAWIO` page type into `apps/web`

**Files:**
- Modify: `apps/web/next.config.js` (`transpilePackages`)
- Modify: `apps/web/package.json` (deps)
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx:26-34`
- Modify: `apps/web/src/components/page/page-actions-menu.tsx:42`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx:34-40`

- [ ] **Step 1: Add `@repo/drawio` to `transpilePackages`**

In `apps/web/next.config.js`, add `'@repo/drawio',` to the `transpilePackages` array (next to `'@repo/excalidraw',`).

- [ ] **Step 2: Add the workspace dependency**

In `apps/web/package.json` dependencies, add `"@repo/drawio": "workspace:*",` (keep alphabetical with the other `@repo/*` deps), then run:

Run: `pnpm install`
Expected: `@repo/drawio` linked into `apps/web`.

- [ ] **Step 3: Add the dynamic import + branch in `page-renderer.tsx`**

After the `Likec4Board` dynamic import (around line 61-64) add:

```tsx
const DrawioBoard = dynamic(() => import('@repo/drawio').then((m) => m.DrawioBoard), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
```

Add `resolveDrawioUrl` to the existing `@/lib` imports — change the line

```tsx
import { resolveYjsUrl, fetchYjsToken } from '@/lib/yjs-config'
```

to also import the new helper:

```tsx
import { resolveYjsUrl, fetchYjsToken } from '@/lib/yjs-config'
import { resolveDrawioUrl } from '@/lib/drawio-config'
```

Add the branch immediately after the `LIKEC4` branch (after line 430):

```tsx
  if (page.type === 'DRAWIO') {
    return (
      <DrawioBoard
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={fetchYjsToken}
        user={user}
        drawioUrl={resolveDrawioUrl()}
      />
    )
  }
```

- [ ] **Step 4: Add `'DRAWIO'` to the page-type unions**

In `apps/web/src/components/page/page-actions-toolbar.tsx`, change the `pageType` union + narrowing (lines 26-34) to include `DRAWIO`:

```tsx
  const pageType:
    | 'TEXT'
    | 'EXCALIDRAW'
    | 'GENOGRAM'
    | 'MERMAID'
    | 'PLANTUML'
    | 'LIKEC4'
    | 'DRAWIO'
    | 'KANBAN' =
    rawType === 'EXCALIDRAW' ||
    rawType === 'GENOGRAM' ||
    rawType === 'MERMAID' ||
    rawType === 'PLANTUML' ||
    rawType === 'LIKEC4' ||
    rawType === 'DRAWIO' ||
    rawType === 'KANBAN'
      ? rawType
      : 'TEXT'
```

In `apps/web/src/components/page/page-actions-menu.tsx`, change the `pageType` prop union (line 42) to add `| 'DRAWIO'`:

```tsx
  pageType: 'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'DRAWIO' | 'KANBAN'
```

- [ ] **Step 5: Add `DRAWIO` to the full-bleed list**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`, add to the `isFullBleed` expression (lines 34-40):

```tsx
  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'PLANTUML' ||
    page.type === 'LIKEC4' ||
    page.type === 'DRAWIO' ||
    page.type === 'KANBAN'
```

- [ ] **Step 6: Verify check-types + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/next.config.js apps/web/package.json pnpm-lock.yaml apps/web/src/components/page/page-renderer.tsx apps/web/src/components/page/page-actions-toolbar.tsx apps/web/src/components/page/page-actions-menu.tsx "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx"
git commit -m "feat(drawio): render DRAWIO page type in apps/web"
```

---

## Task 7: «Холст» submenu (Excalidraw / Draw.io) + fix affected E2E specs

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`
- Modify: `apps/e2e/collab.spec.ts:65`
- Modify: `apps/e2e/excalidraw-persistence.spec.ts:19`

- [ ] **Step 1: Add `'DRAWIO'` to `CreatablePageType`**

In `apps/web/src/components/workspace/page-tree-section.tsx`, change the `CreatablePageType` union (lines 29-32) to include `'DRAWIO'`:

```tsx
type CreatablePageType = Extract<
  PageType,
  'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'DRAWIO' | 'KANBAN'
>
```

- [ ] **Step 2: Add a `HolstSubmenu` component**

In the same file, add this component right before `function CreatePageMenu(` (it mirrors the existing `DiagramSubmenu`):

```tsx
function HolstSubmenu({
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
          <BrushIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Холст" />
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
        <MenuItem onClick={() => choose('EXCALIDRAW')}>
          <ListItemIcon>
            <BrushIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Excalidraw" />
        </MenuItem>
        <MenuItem onClick={() => choose('DRAWIO')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Draw.io" />
        </MenuItem>
      </Menu>
    </>
  )
}
```

- [ ] **Step 3: Replace the flat «Холст» item with the submenu**

In `CreatePageMenu`, delete the existing «Холст» `<MenuItem>` block (lines 120-130, the one that calls `onCreate('EXCALIDRAW')`) and put the submenu in its place, immediately after the «Текст» item:

```tsx
      <HolstSubmenu onCreate={onCreate} onClose={onClose} />
```

(Leave «Генограмма», «Канбан», and the `DiagramSubmenu` as they are.)

- [ ] **Step 4: Update `apps/e2e/collab.spec.ts`**

At line 65, replace the single «Холст» click with the submenu path:

```ts
  await page.getByRole('menuitem', { name: 'Холст' }).click()
  await page.getByRole('menuitem', { name: 'Excalidraw' }).click()
```

- [ ] **Step 5: Update `apps/e2e/excalidraw-persistence.spec.ts`**

At line 19, make the same replacement:

```ts
  await page.getByRole('menuitem', { name: 'Холст' }).click()
  await page.getByRole('menuitem', { name: 'Excalidraw' }).click()
```

- [ ] **Step 6: Verify check-types + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx apps/e2e/collab.spec.ts apps/e2e/excalidraw-persistence.spec.ts
git commit -m "feat(drawio): split Холст into Excalidraw/Draw.io submenu"
```

---

## Task 8: E2E — DRAWIO page creation

**Files:**
- Create: `apps/e2e/drawio-page.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/drawio-page.spec.ts`:

```ts
import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function createDrawioPage(page: Page) {
  const email = `drawio+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Drawio WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Холст' }).click()
  await page.getByRole('menuitem', { name: 'Draw.io' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

// Asserts our chrome only: the embed iframe element mounts. We use toBeAttached
// (not a content assertion) so the test does not depend on reaching the
// diagrams.net CDN from CI.
test('creates a DRAWIO page that mounts the draw.io embed iframe', async ({ page }) => {
  await createDrawioPage(page)
  const frame = page.locator('iframe[src*="diagrams.net"], iframe[src*="drawio"]')
  await expect(frame.first()).toBeAttached({ timeout: 20_000 })
})
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/drawio-page.spec.ts`
Expected: PASS. (Requires `docker compose up -d`; Playwright runs its own dev server on :3100.)

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/drawio-page.spec.ts
git commit -m "test(e2e): DRAWIO page creation mounts the draw.io iframe"
```

---

## Task 9: Editor save reducer (TDD) + `react-drawio` dependency

**Files:**
- Create: `packages/editor/src/extensions/drawio-save.ts`
- Test: `packages/editor/src/extensions/drawio-save.test.ts`
- Modify: `packages/editor/package.json` (deps)

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/extensions/drawio-save.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { finalizeDrawioSave } from './drawio-save'

describe('finalizeDrawioSave', () => {
  it('prefers the latest autosaved xml and uses the exported svg', () => {
    expect(
      finalizeDrawioSave({ latestXml: '<b/>', initialXml: '<a/>', exportData: 'data:image/svg+xml,b' }),
    ).toEqual({ xml: '<b/>', svg: 'data:image/svg+xml,b' })
  })

  it('falls back to the initial xml when nothing changed', () => {
    expect(
      finalizeDrawioSave({ latestXml: '', initialXml: '<a/>', exportData: 'data:image/svg+xml,a' }),
    ).toEqual({ xml: '<a/>', svg: 'data:image/svg+xml,a' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor test drawio-save`
Expected: FAIL — `Cannot find module './drawio-save'`.

- [ ] **Step 3: Create `packages/editor/src/extensions/drawio-save.ts`**

```ts
export type DrawioNodeAttrs = {
  /** mxGraph XML — the editable source. */
  xml: string
  /** Rendered SVG as a data-URL — the preview image. */
  svg: string
}

export type DrawioSaveInput = {
  /** Latest XML captured from the embed's autosave events (empty if untouched). */
  latestXml: string
  /** XML the editor modal was opened with (fallback when nothing changed). */
  initialXml: string
  /** Data-URL returned by exportDiagram({ format: 'xmlsvg' }). */
  exportData: string
}

/** Combine the editor modal's captured XML + exported image into node attributes. */
export function finalizeDrawioSave({
  latestXml,
  initialXml,
  exportData,
}: DrawioSaveInput): DrawioNodeAttrs {
  return { xml: latestXml || initialXml, svg: exportData }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/editor test drawio-save`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `react-drawio` to the editor's deps**

In `packages/editor/package.json` dependencies, add `"react-drawio": "^1.0.7",` (keep ordering sensible), then:

Run: `pnpm install`
Expected: `react-drawio` available to `@repo/editor`.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/extensions/drawio-save.ts packages/editor/src/extensions/drawio-save.test.ts packages/editor/package.json pnpm-lock.yaml
git commit -m "feat(editor): drawio save reducer + react-drawio dep"
```

---

## Task 10: Draw.io editor + viewer dialogs

**Files:**
- Create: `packages/editor/src/components/drawio-editor-dialog.tsx`
- Create: `packages/editor/src/components/drawio-viewer-dialog.tsx`

- [ ] **Step 1: Create `packages/editor/src/components/drawio-editor-dialog.tsx`**

```tsx
'use client'

import { useRef } from 'react'
import { AppBar, Box, Button, Dialog, Toolbar, Typography } from '@mui/material'
import { DrawIoEmbed, type DrawIoEmbedRef } from 'react-drawio'

import { finalizeDrawioSave, type DrawioNodeAttrs } from '../extensions/drawio-save'

type Props = {
  open: boolean
  initialXml: string
  drawioUrl: string
  onSave: (attrs: DrawioNodeAttrs) => void
  onCancel: () => void
}

export function DrawioEditorDialog({ open, initialXml, drawioUrl, onSave, onCancel }: Props) {
  const drawioRef = useRef<DrawIoEmbedRef>(null)
  const latestXml = useRef(initialXml)

  // Our own Save button triggers an SVG export; the export callback finalizes the
  // node attributes (drawio's built-in Save/Exit buttons are hidden via urlParameters).
  const handleSave = () => {
    drawioRef.current?.exportDiagram({ format: 'xmlsvg' })
  }

  return (
    <Dialog open={open} onClose={onCancel} fullScreen>
      <AppBar position="relative" color="default" elevation={1}>
        <Toolbar variant="dense">
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Draw.io
          </Typography>
          <Button onClick={onCancel}>Отмена</Button>
          <Button onClick={handleSave} variant="contained" sx={{ ml: 1 }}>
            Сохранить
          </Button>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          '& iframe': { border: 0, width: '100%', height: '100%' },
        }}
      >
        {open ? (
          <DrawIoEmbed
            ref={drawioRef}
            baseUrl={drawioUrl}
            autosave
            xml={initialXml || undefined}
            exportFormat="xmlsvg"
            urlParameters={{ spin: true, noSaveBtn: true, noExitBtn: true }}
            onAutoSave={(data) => {
              latestXml.current = data.xml
            }}
            onExport={(data) => {
              onSave(
                finalizeDrawioSave({
                  latestXml: latestXml.current,
                  initialXml,
                  exportData: data.data,
                }),
              )
            }}
          />
        ) : null}
      </Box>
    </Dialog>
  )
}
```

> The `onAutoSave`/`onExport` argument types come from `react-drawio`. If check-types complains that `.xml` or `.data` doesn't exist, open `react-drawio`'s exported event types and use the correct field names (the README example reads the export image as `data.data`).

- [ ] **Step 2: Create `packages/editor/src/components/drawio-viewer-dialog.tsx`**

```tsx
'use client'

import { Box, Dialog, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

type Props = {
  open: boolean
  svg: string
  onClose: () => void
}

export function DrawioViewerDialog({ open, svg, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
        <IconButton onClick={onClose} aria-label="Закрыть">
          <CloseIcon />
        </IconButton>
      </Box>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
        }}
      >
        {svg ? (
          <Box
            component="img"
            src={svg}
            alt=""
            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : null}
      </Box>
    </Dialog>
  )
}
```

- [ ] **Step 3: Verify check-types + lint**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/components/drawio-editor-dialog.tsx packages/editor/src/components/drawio-viewer-dialog.tsx
git commit -m "feat(editor): draw.io editor + viewer dialogs"
```

---

## Task 11: Draw.io block node (schema + NodeView)

**Files:**
- Create: `packages/editor/src/extensions/drawio.schema.ts`
- Create: `packages/editor/src/extensions/drawio.tsx`

- [ ] **Step 1: Create `packages/editor/src/extensions/drawio.schema.ts`**

```ts
import { Node, mergeAttributes } from '@tiptap/core'

// Server-safe schema (no React / react-drawio). The .tsx sibling re-extends it
// with the React NodeView. renderHTML emits an <img> so PDF/HTML export shows the
// diagram; parseHTML reads the editable XML from data-xml and the image from the img.
export const DrawioSchema = Node.create({
  name: 'drawio',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '' },
      svg: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="drawio"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            xml: el.getAttribute('data-xml') ?? '',
            svg: el.querySelector('img')?.getAttribute('src') ?? '',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as { xml: string; svg: string }
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'drawio', 'data-xml': attrs.xml }),
      ['img', { src: attrs.svg, alt: '' }],
    ]
  },
})
```

- [ ] **Step 2: Create `packages/editor/src/extensions/drawio.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Box } from '@mui/material'

import { DrawioEditorDialog } from '../components/drawio-editor-dialog'
import { DrawioViewerDialog } from '../components/drawio-viewer-dialog'
import { DrawioSchema } from './drawio.schema'
import type { DrawioNodeAttrs } from './drawio-save'

export type DrawioOptions = {
  /** Draw.io embed iframe origin, injected at registration. */
  drawioUrl: string
}

function DrawioView({ node, updateAttributes, extension, editor }: NodeViewProps) {
  const attrs = node.attrs as DrawioNodeAttrs
  const drawioUrl = (extension.options as DrawioOptions).drawioUrl
  const [view, setView] = useState<'idle' | 'viewer' | 'editor'>('idle')
  // Single click opens the viewer, double click opens the editor. Delay the
  // single-click action so a double-click cancels it (no viewer flash).
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (clickTimer.current) clearTimeout(clickTimer.current)
    },
    [],
  )

  const handleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => setView('viewer'), 250)
  }

  const handleDoubleClick = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    if (!editor.isEditable) return
    setView('editor')
  }

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-drawio"
      data-type="drawio"
      data-drag-handle=""
      contentEditable={false}
    >
      <Box
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        sx={{
          cursor: 'pointer',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1,
          my: 0.5,
          display: 'flex',
          justifyContent: 'center',
          minHeight: 80,
          '&:hover': { borderColor: 'text.secondary' },
        }}
      >
        {attrs.svg ? (
          <Box component="img" src={attrs.svg} alt="" sx={{ maxWidth: '100%' }} />
        ) : (
          <Box sx={{ color: 'text.secondary', fontSize: 13, py: 3 }}>
            Пустая диаграмма draw.io — двойной клик для редактирования
          </Box>
        )}
      </Box>
      <DrawioViewerDialog open={view === 'viewer'} svg={attrs.svg} onClose={() => setView('idle')} />
      <DrawioEditorDialog
        open={view === 'editor'}
        initialXml={attrs.xml}
        drawioUrl={drawioUrl}
        onSave={(next) => {
          updateAttributes(next)
          setView('idle')
        }}
        onCancel={() => setView('idle')}
      />
    </NodeViewWrapper>
  )
}

export const Drawio = DrawioSchema.extend<DrawioOptions>({
  addOptions() {
    return { drawioUrl: '' }
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawioView)
  },
})
```

- [ ] **Step 3: Verify check-types + lint**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/drawio.schema.ts packages/editor/src/extensions/drawio.tsx
git commit -m "feat(editor): drawio block node + NodeView"
```

---

## Task 12: «Встраивание» slash group + Draw.io item

**Files:**
- Modify: `packages/editor/src/types.ts:29`
- Modify: `packages/editor/src/components/slash-menu-popover.tsx:24-30`
- Modify: `packages/editor/src/slash-items.ts`

- [ ] **Step 1: Add the `'embedding'` group to the type**

In `packages/editor/src/types.ts`, change line 29:

```ts
export type SlashCommandGroup = 'base' | 'code' | 'media' | 'embedding'
```

- [ ] **Step 2: Add the group to the popover order + title**

In `packages/editor/src/components/slash-menu-popover.tsx`, update lines 24-30:

```ts
const GROUP_ORDER: SlashCommandGroup[] = ['base', 'code', 'media', 'embedding']

const GROUP_TITLES: Record<SlashCommandGroup, string> = {
  base: 'Базовые блоки',
  code: 'Код',
  media: 'Медиа',
  embedding: 'Встраивание',
}
```

- [ ] **Step 3: Add the handler type + Draw.io item in `slash-items.ts`**

Add the `SchemaIcon` import near the other `@mui/icons-material` imports (top of file):

```ts
import SchemaIcon from '@mui/icons-material/Schema'
```

Add an optional handler to `SlashMediaHandlers` (mirrors the optional `openReminderCreate`):

```ts
export type SlashMediaHandlers = {
  openDatePopover: (range: SlashRange) => void
  openFilePopover: (range: SlashRange) => void
  openMarkdownPopover: (range: SlashRange) => void
  openPageLinkPopover: (range: SlashRange) => void
  openReminderCreate?: (reminderId: string) => void
  openDrawioCreate?: (range: SlashRange) => void
}
```

Add this item to the array returned by `buildItems` (place it last, after the `markdown` item):

```ts
  {
    id: 'drawio',
    group: 'embedding',
    label: 'Draw.io',
    description: 'Встроить диаграмму draw.io',
    keywords: ['drawio', 'диаграмма', 'схема', 'embed', 'встраивание'],
    icon: createElement(SchemaIcon, { fontSize: 'small' }),
    run: ({ range }) => handlers.openDrawioCreate?.(range),
  },
```

- [ ] **Step 4: Verify check-types + lint**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: PASS. (The handler is optional, so the existing `createSlashItems(...)` call in `anynote-editor.tsx` still type-checks — Task 13 wires the real handler.)

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/components/slash-menu-popover.tsx packages/editor/src/slash-items.ts
git commit -m "feat(editor): add Встраивание slash group with Draw.io item"
```

---

## Task 13: Register the node + thread `drawioUrl` end-to-end

**Files:**
- Modify: `packages/editor/src/extensions/index.ts`
- Modify: `packages/editor/src/extensions/server.ts`
- Modify: `packages/editor/src/types.ts` (`AnyNoteEditorProps`)
- Modify: `packages/editor/src/anynote-editor.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx` (TEXT branch)

- [ ] **Step 1: Register the node + add the option in `extensions/index.ts`**

Add the import near the other extension imports:

```ts
import { Drawio } from './drawio'
```

Add `drawioUrl` to `BuildExtensionsOptions`:

```ts
export type BuildExtensionsOptions = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  placeholder: string
  slashItems: (query: string) => SlashCommandItem[]
  slashRender: () => SlashMenuRender
  mentionItems: (query: string) => Promise<MentionLookupItem[]> | MentionLookupItem[]
  mentionRender: MentionRender
  onNavigateToPage: (pageId: string) => void
  drawioUrl: string
}
```

Add the configured node to the extensions array (next to `FileAttachment`):

```ts
  Drawio.configure({ drawioUrl: opts.drawioUrl }),
```

- [ ] **Step 2: Re-export the schema for server-side rendering**

In `packages/editor/src/extensions/server.ts`, add (next to the other `*.schema` re-exports):

```ts
export { DrawioSchema as Drawio } from './drawio.schema'
```

- [ ] **Step 3: Add `drawioUrl` to `AnyNoteEditorProps`**

In `packages/editor/src/types.ts`, add to `AnyNoteEditorProps` (after `onNavigateToPage`):

```ts
  drawioUrl: string
```

- [ ] **Step 4: Host the create dialog + wire the handler in `anynote-editor.tsx`**

Add the import:

```tsx
import { DrawioEditorDialog } from './components/drawio-editor-dialog'
```

Inside `AnyNoteEditorInner`, add create-dialog state next to the `popover` state (line ~103):

```tsx
  const [drawioCreate, setDrawioCreate] = useState<{ range: SlashRange } | null>(null)
```

Then add the `openDrawioCreate` callback immediately **after** `closePopover` (line ~143) — it must come after `slashRendererRef` is declared (line ~115) to avoid a no-use-before-define lint error, and before `slashItems`:

```tsx
  const openDrawioCreate = useCallback((range: SlashRange) => {
    slashRendererRef.current.popup?.hide()
    setDrawioCreate({ range })
  }, [])
```

Pass it into `createSlashItems` (extend the handlers object at line ~147):

```tsx
  const slashItems = useMemo(
    () =>
      createSlashItems({
        openDatePopover: (range) => openKind('date', range),
        openFilePopover: (range) => openKind('file', range),
        openMarkdownPopover: (range) => openKind('markdown', range),
        openPageLinkPopover: (range) => openKind('pageLink', range),
        openReminderCreate: props.onReminderCreate,
        openDrawioCreate,
      }),
    [openKind, props.onReminderCreate, openDrawioCreate],
  )
```

Pass `drawioUrl` into `buildExtensions` (in the `useEditor` extensions list, after `onNavigateToPage`):

```tsx
        onNavigateToPage,
        drawioUrl: props.drawioUrl,
```

Render the create dialog inside the `{editor ? ( <> … </> ) : null}` block (after `<PageLinkPopover … />`):

```tsx
          <DrawioEditorDialog
            open={drawioCreate != null}
            initialXml=""
            drawioUrl={props.drawioUrl}
            onSave={(attrs) => {
              if (drawioCreate) {
                editor
                  .chain()
                  .focus()
                  .deleteRange(drawioCreate.range)
                  .insertContent({ type: 'drawio', attrs })
                  .run()
              }
              setDrawioCreate(null)
            }}
            onCancel={() => setDrawioCreate(null)}
          />
```

- [ ] **Step 5: Pass `drawioUrl` from `page-renderer.tsx`**

In the `TEXT` branch's `<AnyNoteEditor>` (after `onNavigateToPage={onNavigateToPage}`), add:

```tsx
          drawioUrl={resolveDrawioUrl()}
```

(`resolveDrawioUrl` was imported in Task 6.)

- [ ] **Step 6: Confirm no other `AnyNoteEditor` caller broke**

Run: `grep -rn "AnyNoteEditor" apps packages --include=*.tsx --include=*.ts | grep -v "AnyNoteEditorProps\|AnyNoteEditorUser\|function AnyNoteEditor\|import"`
Expected: only the `page-renderer.tsx` usage. If any other caller renders `<AnyNoteEditor …>`, add `drawioUrl={resolveDrawioUrl()}` there too.

- [ ] **Step 7: Verify check-types + lint (editor + web)**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/editor/src/extensions/index.ts packages/editor/src/extensions/server.ts packages/editor/src/types.ts packages/editor/src/anynote-editor.tsx apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(editor): register drawio node + thread drawioUrl"
```

---

## Task 14: E2E — «Встраивание» → Draw.io block

**Files:**
- Create: `apps/e2e/drawio-block.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/drawio-block.spec.ts`:

```ts
import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function createTextPage(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Драв', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Drawio Block Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  await page.getByRole('button', { name: 'Страницы' }).click()
  const previousUrl = page.url()
  const addBtn = page.getByRole('button', { name: 'Новая страница' })
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

test('Встраивание slash group opens the Draw.io editor modal; Отмена inserts nothing', async ({
  page,
}) => {
  const editor = await createTextPage(page, 'drawio-block')
  await editor.click()
  await editor.press('/')

  // The new group heading + item render in the slash popover.
  await expect(page.getByText('Встраивание', { exact: true })).toBeVisible()
  await page.locator('[data-slash-item-id="drawio"]').click()

  // Our full-screen editor modal: Отмена / Сохранить toolbar + the embed iframe.
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeVisible()
  await expect(page.locator('iframe[src*="diagrams.net"], iframe[src*="drawio"]')).toBeAttached({
    timeout: 15_000,
  })

  // Cancel inserts no node.
  await page.getByRole('button', { name: 'Отмена' }).click()
  await expect(editor.locator('[data-type="drawio"]')).toHaveCount(0)
})
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/drawio-block.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/drawio-block.spec.ts
git commit -m "test(e2e): Встраивание → Draw.io block editor modal"
```

---

## Task 15: Full gates + manual verification

- [ ] **Step 1: Run the full merge gate**

Run: `pnpm gates`
Expected: check-types + lint (`--max-warnings 0`) + build + test all PASS. Pay attention to `next build` succeeding with `react-drawio` bundled into both `@repo/editor` and `@repo/drawio`.

- [ ] **Step 2: Manual verification (the iframe save path E2E can't cover)**

With `docker compose up -d` and `pnpm --filter web dev`:

1. Sidebar → «Страницы» → **+** → **Холст ▸ Draw.io** → a full-width draw.io editor opens. Draw a shape; reload the page → the shape persists (Yjs `Y.Text`). Open the same page URL in a second browser → editing in one and saving reflects in the other after a reload.
2. Sidebar → «Страницы» → **+** → **Холст ▸ Excalidraw** → still creates a normal Excalidraw page (regression check).
3. On a TEXT page: `/` → **Встраивание → Draw.io** → modal opens; draw something; **Сохранить** → the block renders the diagram as an image. **Single-click** the block → full-screen image viewer. **Double-click** → editor modal preloaded with the diagram; change it, **Сохранить** → preview updates; **Отмена** → no change. Use the block drag-handle to move/delete it.
4. Export the TEXT page to PDF/HTML (page actions menu is disabled for non-TEXT, but the block lives on a TEXT page) → the diagram image appears in the export.

- [ ] **Step 3: Final commit (if manual fixes were needed)**

```bash
git add -A
git commit -m "fix(drawio): address manual verification findings"
```

---

## Self-Review notes (resolved during planning)

- **Spec coverage:** «Холст» submenu (T7), DRAWIO page + Yjs sync (T2–T6), «Встраивание» group + Draw.io item (T12), node + inline xml/svg attrs (T11), editor/viewer dialogs + single/double-click (T10–T11), `NEXT_PUBLIC_DRAWIO_URL` threading (T1, T6, T13), tests (T8, T14 E2E + T1/T4/T9 unit). All spec sections map to a task.
- **Regression guard:** `collab.spec.ts` + `excalidraw-persistence.spec.ts` click «Холст» directly today — both updated in T7 to use the submenu.
- **Server safety:** `server.ts` re-exports `DrawioSchema` only (no react-drawio), so PDF/HTML export never pulls the iframe into a server context.
- **Type consistency:** `DrawioNodeAttrs { xml, svg }` is defined once in `drawio-save.ts` and reused by the dialog (T10) and NodeView (T11); `finalizeDrawioSave` signature is identical across T9/T10; `openDrawioCreate` is optional in `SlashMediaHandlers` (T12) and provided in `anynote-editor.tsx` (T13), keeping every intermediate task green.
- **External-iframe risk:** E2E asserts our own chrome with `toBeAttached`, never the iframe's loaded content, so CI does not depend on reaching diagrams.net. The save→render path is unit-tested (`finalizeDrawioSave`) + manually verified (T15).
