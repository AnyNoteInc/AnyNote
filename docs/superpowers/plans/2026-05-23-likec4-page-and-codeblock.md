# LikeC4 page type + code-block preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LikeC4 as a diagram type in two places — a `LIKEC4` collaborative page (Monaco source + live preview) created from the «Диаграмма» submenu, and a ` ```likec4 ` editor code block with syntax highlighting and a Код↔Просмотр preview that defaults to the rendered diagram.

**Architecture:** LikeC4 parses + lays out + renders **entirely in the browser** (`@likec4/language-services/browser` → `@likec4/layouts` graphviz-wasm → `@likec4/diagram` xyflow). Unlike Mermaid/PlantUML it produces a **React component tree, not an SVG string**, so the shared `@repo/diagram-board` is extended with a pluggable `Preview` component, and a single `Likec4Diagram` React component drives both the page board and the code-block preview. A LikeC4 model has multiple views, shown via a view selector + LikeC4's built-in navigation buttons.

**Tech Stack:** Next.js 16 / React 19 / MUI v7 / Monaco + y-monaco / Yjs; `likec4` + `@likec4/diagram` + `@likec4/language-services` + `@likec4/layouts` all pinned at `1.57.0`; Prisma 7; Playwright; vitest.

**Spec:** [docs/superpowers/specs/2026-05-23-likec4-page-and-codeblock-design.md](../specs/2026-05-23-likec4-page-and-codeblock-design.md)

**Verified API (from the published `1.57.0` type defs — use exactly these):**
- `import { fromSource } from '@likec4/language-services/browser'` → `fromSource(source: string): Promise<LikeC4>`
- `await likec4.layoutedModel(): Promise<LikeC4Model.Layouted>`
- `model.views(): IteratorLike<LikeC4ViewModel>` — iterable; each view has `readonly id` (branded `ViewId`) and `readonly title: string | null`
- `import { LikeC4ModelProvider, ReactLikeC4 } from '@likec4/diagram'`
- `<LikeC4ModelProvider likec4model={model}>` — prop is **`likec4model`**
- `<ReactLikeC4 viewId colorScheme={'light'|'dark'} keepAspectRatio pannable zoomable showNavigationButtons onNavigateTo background style />`

**Testing convention (match the repo):** this codebase unit-tests **pure logic** (vitest) and verifies **rendered components via Playwright E2E** (see `@repo/diagram-board/src/export.test.ts` + `apps/e2e/mermaid-page.spec.ts`). LikeC4's wasm/xyflow render cannot run under vitest's node env, so render correctness is proven by E2E; pure helpers get unit tests.

---

## Task 1: Scaffold `@repo/likec4` package + install deps + wire workspace

**Files:**
- Create: `packages/likec4/package.json`
- Create: `packages/likec4/tsconfig.json`
- Create: `packages/likec4/eslint.config.mjs`
- Create: `packages/likec4/vitest.config.ts`
- Create: `packages/likec4/src/index.ts` (temporary stub)
- Modify: `apps/web/next.config.js` (add `'@repo/likec4'` to `transpilePackages`)
- Modify: `apps/web/package.json` (add dep)
- Modify: `packages/editor/package.json` (add dep)

- [ ] **Step 1: Copy the `@repo/plantuml` config files as the template**

Read `packages/plantuml/tsconfig.json`, `packages/plantuml/eslint.config.mjs`, `packages/plantuml/vitest.config.ts` and create `packages/likec4/` copies **verbatim** (they are package-name-agnostic).

- [ ] **Step 2: Write `packages/likec4/package.json`**

```jsonc
{
  "name": "@repo/likec4",
  "version": "0.1.0",
  "private": true,
  "exports": {
    ".": { "types": "./src/index.ts", "import": "./src/index.ts", "default": "./src/index.ts" },
    "./likec4-diagram": {
      "types": "./src/likec4-diagram.tsx",
      "import": "./src/likec4-diagram.tsx",
      "default": "./src/likec4-diagram.tsx"
    },
    "./*": { "types": "./src/*", "import": "./src/*", "default": "./src/*" }
  },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@repo/diagram-board": "workspace:*",
    "likec4": "1.57.0",
    "@likec4/diagram": "1.57.0",
    "@likec4/language-services": "1.57.0",
    "@likec4/layouts": "1.57.0",
    "monaco-editor": "^0.52.2",
    "react": "^19.2.0"
  },
  "peerDependencies": { "next": "^16.0.0" },
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

> `@likec4/*` + `likec4` are pinned to the **exact same** version. Do not use `^` on them — mismatched LikeC4 sub-packages break the model/layout/diagram contract.

- [ ] **Step 3: Write the temporary `src/index.ts` stub**

```ts
export {}
```

- [ ] **Step 4: Add `'@repo/likec4'` to `apps/web/next.config.js` `transpilePackages`**

Insert after the `'@repo/editor'` line (keep grouped with the other diagram packages):

```js
    '@repo/editor',
    '@repo/likec4',
    '@repo/excalidraw',
```

- [ ] **Step 5: Add the workspace dep to `apps/web/package.json` and `packages/editor/package.json`**

In each `dependencies`, add (alphabetical with the other `@repo/*`):

```jsonc
    "@repo/likec4": "workspace:*",
```

- [ ] **Step 6: Install**

Run: `pnpm install`
Expected: resolves and links `@repo/likec4`; downloads `likec4`, `@likec4/diagram`, `@likec4/language-services`, `@likec4/layouts` at 1.57.0. No peer-dep errors that fail the install.

- [ ] **Step 7: Verify the empty package type-checks**

Run: `pnpm --filter @repo/likec4 check-types`
Expected: PASS (no errors; empty `src`).

- [ ] **Step 8: Commit**

```bash
git add packages/likec4 apps/web/next.config.js apps/web/package.json packages/editor/package.json pnpm-lock.yaml
git commit -m "chore(likec4): scaffold @repo/likec4 package + install LikeC4 deps"
```

---

## Task 2: Extend `@repo/diagram-board` with a pluggable `Preview`

**Files:**
- Modify: `packages/diagram-board/src/types.ts`
- Modify: `packages/diagram-board/src/board-inner.tsx:107-109`
- Modify: `packages/diagram-board/src/index.ts:5`

No new unit test: `board-inner.tsx` is a `window`-touching client component (the repo verifies it via the Mermaid/PlantUML E2E, not vitest). The regression guard is that Mermaid/PlantUML tests + type-check stay green.

- [ ] **Step 1: Edit `types.ts` — make `render` optional, add `Preview` + `DiagramPreviewProps`**

Replace the imports + `DiagramConfig` block with:

```ts
import type { ComponentType } from 'react'
import type * as Y from 'yjs'
import type * as monaco from 'monaco-editor'
import type { ColorMode, DiagramRenderer } from './render-types'

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

/** Props a custom diagram preview component receives from the board. */
export type DiagramPreviewProps = {
  ytext: Y.Text
  mode: ColorMode
  idPrefix: string
}

export type DiagramConfig = {
  /** Y.Text root name (the collaborative source document). */
  docName: string
  /** Monaco language id set on the editor model. */
  languageId: string
  /** Registers the Monarch language on a Monaco instance (idempotent). */
  registerLanguage: (m: typeof monaco) => void
  /** Prefix for render ids and data-testids (e.g. 'mermaid' | 'plantuml' | 'likec4'). */
  idPrefix: string
  /** Optional Monaco placeholder shown when the source is empty. */
  placeholder?: string
  /**
   * SVG render path (mermaid, plantuml): produces SVG markup injected into the
   * preview. Supply exactly one of `render` / `Preview`.
   */
  render?: DiagramRenderer
  /**
   * Custom React preview (likec4): renders a component tree instead of SVG.
   * Supply exactly one of `render` / `Preview`.
   */
  Preview?: ComponentType<DiagramPreviewProps>
}
```

- [ ] **Step 2: Edit `board-inner.tsx` — branch on `config.Preview`**

The right-hand preview `Box` (currently lines ~107-109) becomes:

```tsx
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {config.Preview ? (
          <config.Preview ytext={resources.ytext} mode={mode} idPrefix={config.idPrefix} />
        ) : (
          <DiagramPreview
            ytext={resources.ytext}
            mode={mode}
            render={config.render!}
            idPrefix={config.idPrefix}
          />
        )}
      </Box>
```

> JSX requires a capitalized binding: assign `const Preview = config.Preview` above the `return` and use `<Preview …/>` if the linter objects to `<config.Preview/>`. Either form is fine.

- [ ] **Step 3: Export `DiagramPreviewProps` from `index.ts`**

Change the `types` re-export line to:

```ts
export type { DiagramBoardProps, DiagramUser, DiagramConfig, DiagramPreviewProps } from './types'
```

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm --filter @repo/diagram-board check-types && pnpm --filter @repo/diagram-board test && pnpm --filter @repo/mermaid check-types && pnpm --filter @repo/mermaid test && pnpm --filter @repo/plantuml check-types && pnpm --filter @repo/plantuml test`
Expected: all PASS (mermaid/plantuml configs still pass `render` only → unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git add packages/diagram-board/src
git commit -m "feat(diagram-board): allow a pluggable Preview component alongside SVG render"
```

---

## Task 3: LikeC4 Monaco language (TDD)

**Files:**
- Test: `packages/likec4/src/likec4-language.test.ts`
- Create: `packages/likec4/src/likec4-language.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { LIKEC4_LANGUAGE_ID, registerLikec4Language } from './likec4-language'

function fakeMonaco() {
  const registered: string[] = []
  return {
    languages: {
      getLanguages: () => registered.map((id) => ({ id })),
      register: ({ id }: { id: string }) => registered.push(id),
      setMonarchTokensProvider: vi.fn(),
    },
  } as unknown as typeof import('monaco-editor')
}

describe('registerLikec4Language', () => {
  it('exposes the language id', () => {
    expect(LIKEC4_LANGUAGE_ID).toBe('likec4')
  })

  it('registers the language and a tokens provider', () => {
    const m = fakeMonaco()
    registerLikec4Language(m)
    expect(m.languages.getLanguages().some((l) => l.id === 'likec4')).toBe(true)
    expect(m.languages.setMonarchTokensProvider).toHaveBeenCalledWith('likec4', expect.anything())
  })

  it('is idempotent (does not double-register)', () => {
    const m = fakeMonaco()
    registerLikec4Language(m)
    registerLikec4Language(m)
    const count = m.languages.getLanguages().filter((l) => l.id === 'likec4').length
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/likec4 test`
Expected: FAIL — cannot resolve `./likec4-language`.

- [ ] **Step 3: Implement `likec4-language.ts`**

```ts
import type * as monaco from 'monaco-editor'

export const LIKEC4_LANGUAGE_ID = 'likec4'

/**
 * Minimal Monarch tokenizer for LikeC4 DSL. Highlights structural keywords,
 * relationship arrows, strings and comments. No language server — the base
 * editor worker is enough (parsing/validation happens in the live preview).
 */
export const likec4MonarchLanguage: monaco.languages.IMonarchLanguage & { keywords: string[] } = {
  keywords: [
    'specification',
    'model',
    'views',
    'element',
    'tag',
    'relationship',
    'person',
    'system',
    'softwareSystem',
    'container',
    'component',
    'actor',
    'view',
    'viewof',
    'of',
    'extend',
    'extends',
    'include',
    'exclude',
    'style',
    'styles',
    'autoLayout',
    'group',
    'dynamic',
    'navigateTo',
    'title',
    'description',
    'technology',
    'link',
    'icon',
    'color',
    'shape',
    'with',
    'this',
    'it',
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/(->|<-|-\[|\]->|\.\.>|--|::)/, 'operator'],
      [/"[^"]*"/, 'string'],
      [/'[^']*'/, 'string'],
      [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      [/[{}()[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
}

/** Register the likec4 language + tokenizer on a Monaco instance (idempotent). */
export function registerLikec4Language(m: typeof monaco): void {
  const exists = m.languages.getLanguages().some((l) => l.id === LIKEC4_LANGUAGE_ID)
  if (exists) return
  m.languages.register({ id: LIKEC4_LANGUAGE_ID })
  m.languages.setMonarchTokensProvider(LIKEC4_LANGUAGE_ID, likec4MonarchLanguage)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/likec4 test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/likec4/src/likec4-language.ts packages/likec4/src/likec4-language.test.ts
git commit -m "feat(likec4): Monaco Monarch language for LikeC4 DSL"
```

---

## Task 4: View-selection helpers (TDD)

These are the pure pieces of the preview's multi-view logic — testable without wasm.

**Files:**
- Test: `packages/likec4/src/view-utils.test.ts`
- Create: `packages/likec4/src/view-utils.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { resolveSelectedViewId, viewLabel } from './view-utils'

const v = (id: string, title: string | null) => ({ id, title })

describe('viewLabel', () => {
  it('uses the title when present', () => {
    expect(viewLabel(v('index', 'Landscape'))).toBe('Landscape')
  })
  it('falls back to the id when title is null/empty', () => {
    expect(viewLabel(v('index', null))).toBe('index')
    expect(viewLabel(v('index', ''))).toBe('index')
  })
})

describe('resolveSelectedViewId', () => {
  const views = [v('index', 'Landscape'), v('ctx', 'Context')]
  it('keeps the current id when still present', () => {
    expect(resolveSelectedViewId(views, 'ctx')).toBe('ctx')
  })
  it('falls back to the first view when current is missing', () => {
    expect(resolveSelectedViewId(views, 'gone')).toBe('index')
  })
  it('returns undefined for an empty model', () => {
    expect(resolveSelectedViewId([], 'index')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/likec4 test view-utils`
Expected: FAIL — cannot resolve `./view-utils`.

- [ ] **Step 3: Implement `view-utils.ts`**

```ts
/** Minimal shape of a LikeC4 view model (subset of @likec4/core's LikeC4ViewModel). */
export type ViewLike = { id: string; title: string | null }

/** Display label for a view: its title, or its id when the title is empty/absent. */
export function viewLabel(view: ViewLike): string {
  return view.title && view.title.length > 0 ? view.title : view.id
}

/**
 * Pick which view id to show: keep `current` if it still exists in `views`,
 * otherwise the first view's id (or undefined when there are no views).
 */
export function resolveSelectedViewId(views: ViewLike[], current: string | undefined): string | undefined {
  if (views.length === 0) return undefined
  if (current && views.some((v) => v.id === current)) return current
  return views[0]!.id
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/likec4 test view-utils`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/likec4/src/view-utils.ts packages/likec4/src/view-utils.test.ts
git commit -m "feat(likec4): pure view-selection helpers"
```

---

## Task 5: `Likec4Diagram` — the shared parse→layout→render component

**Files:**
- Create: `packages/likec4/src/likec4-diagram.tsx`

This is the core. No unit test (wasm/xyflow can't run under vitest) — it is proven by the E2E in Task 9. It reuses the helpers from Task 4 and mirrors `DiagramPreview`'s debounce + generation-counter + last-good resilience.

- [ ] **Step 1: Implement `likec4-diagram.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, MenuItem, Select, Typography } from '@mui/material'
import { LikeC4ModelProvider, ReactLikeC4 } from '@likec4/diagram'
import type { ColorMode } from '@repo/diagram-board/render-types'

import { resolveSelectedViewId, viewLabel, type ViewLike } from './view-utils'

// LikeC4Model.Layouted (from @likec4/core). Typed loosely here to avoid pulling
// the heavy type graph through this component's public surface.
type LayoutedModel = { views(): Iterable<ViewLike> }

type Props = {
  source: string
  mode: ColorMode
  /** data-testid prefix; defaults to 'likec4'. */
  idPrefix?: string
}

/**
 * Parse + layout + render LikeC4 source entirely in the browser. Used by both
 * the page board (via Likec4PagePreview) and the editor code block. Keeps the
 * last good model on parse error and shows an error chip — same resilience as
 * @repo/diagram-board's DiagramPreview.
 */
export function Likec4Diagram({ source, mode, idPrefix = 'likec4' }: Props) {
  const [model, setModel] = useState<LayoutedModel | null>(null)
  const [views, setViews] = useState<ViewLike[]>([])
  const [viewId, setViewId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const genRef = useRef(0)
  const lastSource = useRef<string | null>(null)

  useEffect(() => {
    const trimmed = source.trim()
    if (trimmed === lastSource.current) return
    lastSource.current = trimmed
    const gen = ++genRef.current

    if (!trimmed) {
      setModel(null)
      setViews([])
      setError(null)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        // Dynamic import keeps the Langium parser + graphviz-wasm out of the
        // initial chunk — only loaded when a diagram actually renders.
        const { fromSource } = await import('@likec4/language-services/browser')
        const likec4 = await fromSource(trimmed)
        const layouted = (await likec4.layoutedModel()) as unknown as LayoutedModel
        if (genRef.current !== gen) return // superseded by a newer source
        const list = [...layouted.views()].map((v) => ({ id: String(v.id), title: v.title }))
        setModel(layouted)
        setViews(list)
        setViewId((cur) => resolveSelectedViewId(list, cur))
        setError(null)
      } catch (err) {
        if (genRef.current !== gen) return
        setError(err instanceof Error ? err.message : String(err)) // keep last good model mounted
      } finally {
        if (genRef.current === gen) setLoading(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [source])

  return (
    <Box
      data-testid={`${idPrefix}-preview`}
      sx={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}
    >
      {views.length > 1 && (
        <Select
          size="small"
          value={viewId ?? ''}
          onChange={(e) => setViewId(e.target.value)}
          data-testid={`${idPrefix}-view-select`}
          sx={{ position: 'absolute', top: 8, left: 8, zIndex: 2, bgcolor: 'background.paper', minWidth: 160 }}
        >
          {views.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {viewLabel(v)}
            </MenuItem>
          ))}
        </Select>
      )}

      {model && viewId ? (
        <LikeC4ModelProvider likec4model={model as never}>
          <ReactLikeC4
            viewId={viewId as never}
            colorScheme={mode}
            pannable
            zoomable
            keepAspectRatio
            showNavigationButtons
            onNavigateTo={(to) => setViewId((cur) => resolveSelectedViewId(views, String(to)) ?? cur)}
            background="dots"
            style={{ width: '100%', height: '100%' }}
          />
        </LikeC4ModelProvider>
      ) : (
        loading && (
          <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )
      )}

      {error && (
        <Box
          data-testid={`${idPrefix}-error`}
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            zIndex: 3,
            bgcolor: 'error.main',
            color: 'error.contrastText',
            borderRadius: 1,
            p: 1,
          }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
```

> **`data-testid` note:** `${idPrefix}-preview` sits on the outer container (the stable E2E hook, matching mermaid/plantuml's `*-preview` convention); the E2E also asserts the xyflow `.react-flow__node` DOM that renders inside it. The `as never` casts bridge LikeC4's branded `ViewId`/model types to our loose local types — runtime values are correct, only the brand is erased.

- [ ] **Step 2: Verify it compiles and lints**

Run: `pnpm --filter @repo/likec4 check-types && pnpm --filter @repo/likec4 lint`
Expected: PASS. If `ReactLikeC4` rejects `background="dots"` or `onNavigateTo`'s parameter type, consult `node_modules/@likec4/diagram` types and adjust (the prop set is confirmed present; only the exact value union for `background` may differ — `"dots" | "transparent" | "solid" | false`).

- [ ] **Step 3: Commit**

```bash
git add packages/likec4/src/likec4-diagram.tsx
git commit -m "feat(likec4): browser parse+layout+render diagram component with view selector"
```

---

## Task 6: `Likec4PagePreview` adapter + `Likec4Board` + package exports

**Files:**
- Create: `packages/likec4/src/likec4-page-preview.tsx`
- Create: `packages/likec4/src/likec4-board.tsx`
- Create: `packages/likec4/src/types.ts`
- Modify: `packages/likec4/src/index.ts` (replace the stub)

- [ ] **Step 1: `likec4-page-preview.tsx` — observe the Y.Text, feed the string down**

Mirrors how `DiagramPreview` subscribes to the `Y.Text` (initial render + debounced `observe`), but renders `<Likec4Diagram>` (which does its own debounce/parse).

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { DiagramPreviewProps } from '@repo/diagram-board'

import { Likec4Diagram } from './likec4-diagram'

/** Board adapter: turns the collaborative Y.Text into a source string for Likec4Diagram. */
export function Likec4PagePreview({ ytext, mode, idPrefix }: DiagramPreviewProps) {
  const [source, setSource] = useState(() => ytext.toString())

  useEffect(() => {
    const update = () => setSource(ytext.toString())
    update()
    ytext.observe(update)
    return () => ytext.unobserve(update)
  }, [ytext])

  return <Likec4Diagram source={source} mode={mode} idPrefix={idPrefix} />
}
```

- [ ] **Step 2: `likec4-board.tsx`**

```tsx
'use client'

import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'

import { LIKEC4_LANGUAGE_ID, registerLikec4Language } from './likec4-language'
import { Likec4PagePreview } from './likec4-page-preview'
import type { Likec4BoardProps } from './types'

const PLACEHOLDER = `specification {
  element system
  element person
}
model {
  user = person 'User'
  app  = system 'App'
  user -> app 'uses'
}
views {
  view index {
    include *
  }
}`

const likec4Config: DiagramConfig = {
  docName: 'likec4',
  languageId: LIKEC4_LANGUAGE_ID,
  registerLanguage: registerLikec4Language,
  idPrefix: 'likec4',
  Preview: Likec4PagePreview,
  placeholder: PLACEHOLDER,
}

export function Likec4Board(props: Likec4BoardProps) {
  return <DiagramBoard config={likec4Config} {...props} />
}
```

- [ ] **Step 3: `types.ts`**

```ts
export type { DiagramBoardProps as Likec4BoardProps, DiagramUser as Likec4User } from '@repo/diagram-board'
```

- [ ] **Step 4: Replace `src/index.ts`**

```ts
export { Likec4Board } from './likec4-board'
export { Likec4Diagram } from './likec4-diagram'
export type { Likec4BoardProps, Likec4User } from './types'
```

- [ ] **Step 5: Verify the package builds**

Run: `pnpm --filter @repo/likec4 check-types && pnpm --filter @repo/likec4 lint && pnpm --filter @repo/likec4 test`
Expected: PASS (check-types + lint clean; the 8 existing unit tests pass).

- [ ] **Step 6: Commit**

```bash
git add packages/likec4/src
git commit -m "feat(likec4): Likec4Board (DiagramBoard + custom preview) and package exports"
```

---

## Task 7: Prisma `LIKEC4` page type + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`enum PageType`)
- Create: `packages/db/prisma/migrations/<timestamp>_add_likec4_page_type/migration.sql`

- [ ] **Step 1: Add `LIKEC4` to the enum**

In `enum PageType`, add `LIKEC4` after `PLANTUML`:

```prisma
enum PageType {
  TEXT
  EXCALIDRAW
  GENOGRAM
  MERMAID
  PLANTUML
  LIKEC4
  DATABASE
  KANBAN
  FORM
}
```

- [ ] **Step 2: Create the migration**

Ensure `docker compose up -d` is running (Postgres), then run:
`pnpm --filter @repo/db exec prisma migrate dev --name add_likec4_page_type`
Expected: creates `migration.sql` containing `ALTER TYPE "PageType" ADD VALUE 'LIKEC4';` and regenerates the client.

- [ ] **Step 3: Verify the generated SQL**

Run: `cat packages/db/prisma/migrations/*add_likec4_page_type/migration.sql`
Expected: contains `ALTER TYPE "PageType" ADD VALUE 'LIKEC4';`

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add LIKEC4 to PageType enum"
```

---

## Task 8: Page-type wiring (renderer, submenu, type unions, full-bleed)

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx`
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`

- [ ] **Step 1: `page-renderer.tsx` — dynamic import + branch**

Add the dynamic import next to `PlantumlBoard`:

```tsx
const Likec4Board = dynamic(() => import('@repo/likec4').then((m) => m.Likec4Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
```

Add the branch right after the `PLANTUML` block (same props):

```tsx
  if (page.type === 'LIKEC4') {
    return (
      <Likec4Board
        pageId={page.id}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={fetchYjsToken}
        user={user}
      />
    )
  }
```

- [ ] **Step 2: `page-tree-section.tsx` — submenu item + union**

Add `'LIKEC4'` to the `CreatablePageType` union:

```tsx
type CreatablePageType = Extract<
  PageType,
  'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'KANBAN'
>
```

Add a third item inside the `DiagramSubmenu` child `Menu`, after the PlantUML item:

```tsx
        <MenuItem onClick={() => choose('LIKEC4')}>
          <ListItemIcon>
            <SchemaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="LikeC4" />
        </MenuItem>
```

- [ ] **Step 3: `page-actions-toolbar.tsx` — add to the page-type union**

Find the hardcoded page-type union containing `'PLANTUML'` and insert `'LIKEC4'` right after it, so it reads:

```tsx
'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'KANBAN'
```

(Match the exact members already present — only add `| 'LIKEC4'` after `| 'PLANTUML'`; don't rewrite the rest.)

- [ ] **Step 4: `page-actions-menu.tsx` — add to the `pageType` prop union**

Same edit in this file's `pageType` prop union — insert `| 'LIKEC4'` after `| 'PLANTUML'`:

```tsx
'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'KANBAN'
```

No other change — existing `=== 'TEXT'` guards already gate outline/export off for non-text types.

- [ ] **Step 5: `page.tsx` — full-bleed**

In the `isFullBleed` expression (currently `MERMAID || PLANTUML || …`) add:

```tsx
    page.type === 'LIKEC4' ||
```

- [ ] **Step 6: Verify the web app type-checks and builds**

Run: `pnpm --filter web check-types && pnpm --filter web build`
Expected: PASS. (If `build` is slow, `check-types` + `lint` is an acceptable interim gate; the full build is run in Task 11.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): wire LIKEC4 page type (renderer, submenu, actions, full-bleed)"
```

---

## Task 9: E2E — LikeC4 page render (⚠️ wasm/bundler de-risk milestone)

This is the **first end-to-end proof** that LikeC4's graphviz-wasm + xyflow render under the Next bundler. **Do not start Task 10 until this is green.**

**Files:**
- Create: `apps/e2e/likec4-page.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Modelled on `apps/e2e/plantuml-page.spec.ts` (read it for the current submenu-navigation selectors). xyflow renders `<div>`s — assert on `.react-flow__node`, **not** `svg`.

```ts
import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

const MODEL = `specification {
  element system
  element person
}
model {
  user = person 'User'
  app = system 'App'
  user -> app 'uses'
}
views {
  view index {
    include *
  }
}`

async function setupLikec4Page(page: Page) {
  const email = `likec4+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('LikeC4 WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createPageButton = page.getByRole('button', { name: 'Новая страница' })
  await expect(createPageButton).toBeVisible()
  await createPageButton.click()
  await page.getByRole('menuitem', { name: 'Диаграмма' }).click()
  await page.getByRole('menuitem', { name: 'LikeC4' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

async function typeIntoMonaco(page: Page, text: string) {
  const editor = page.locator('.monaco-editor').first()
  await editor.waitFor({ state: 'visible', timeout: 20_000 })
  await editor.click()
  // Select-all + overwrite so we replace any placeholder seeded in the editor.
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
}

test('renders a likec4 diagram from typed source', async ({ page }) => {
  await setupLikec4Page(page)
  await typeIntoMonaco(page, MODEL)

  // The xyflow canvas mounts nodes once parse+layout (wasm) succeed.
  await expect(page.locator('[data-testid="likec4-preview"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })
})
```

- [ ] **Step 2: Run the spec**

Ensure `docker compose up -d` is running, then:
Run: `pnpm exec playwright test apps/e2e/likec4-page.spec.ts`
Expected: PASS — a `.react-flow__node` appears.

- [ ] **Step 3: ⚠️ If it fails on wasm/module load, fix the bundler before continuing**

Symptoms: console errors about `.wasm`, "WebAssembly", or a failed dynamic import of `@likec4/layouts`/`@hpcc-js/wasm`; the node never appears. Remedies, in order:
1. Confirm `@repo/likec4` is in `apps/web/next.config.js` `transpilePackages` (Task 1) — Turbopack must transpile it.
2. If Turbopack (dev) cannot resolve the wasm asset, add the package to Next's `serverExternalPackages` is **not** right (this is client-side); instead verify `@hpcc-js/wasm` ships its `.wasm` and that the dynamic `import('@likec4/language-services/browser')` resolves at runtime (check the Network tab for a 404 on the `.wasm`).
3. As a fallback documented in the spec §9, the `.wasm` may need to be served from `public/` or referenced via `new URL(...)`; capture the exact failure and adjust. **Stop and report** if the wasm cannot be made to load — that invalidates the client-side approach and needs a spec amendment.

- [ ] **Step 4: Commit (only once green)**

```bash
git add apps/e2e/likec4-page.spec.ts
git commit -m "test(e2e): likec4 page renders a diagram (validates wasm under bundler)"
```

---

## Task 10: Code-block `likec4` preview + slash item

**Files:**
- Modify: `packages/editor/src/extensions/code-block.tsx`
- Modify: `packages/editor/src/slash-items.ts`

- [ ] **Step 1: Lazy-import `Likec4Diagram` in `code-block.tsx`**

Near the other imports (use `next/dynamic` so `@likec4/diagram` stays out of the editor's main chunk):

```tsx
import dynamic from 'next/dynamic'

const Likec4Diagram = dynamic(
  () => import('@repo/likec4/likec4-diagram').then((m) => m.Likec4Diagram),
  { ssr: false },
)
```

- [ ] **Step 2: Add the language to `CODE_LANGUAGES`**

After the `plantuml` entry:

```tsx
  { value: 'likec4', label: 'LikeC4' },
```

- [ ] **Step 3: Detect likec4 + extend `isDiagram`**

In `CodeBlockView`, alongside `isMermaid`/`isPlantuml`:

```tsx
  const isLikec4 = node.attrs.language === 'likec4'
  const isDiagram = isMermaid || isPlantuml || isLikec4
```

- [ ] **Step 4: Skip the SVG render effect for likec4**

The SVG render `useEffect` (the one selecting `renderPlantuml`/`renderMermaid` → `setSvg`) must not run for likec4 (no SVG). Guard its early return:

```tsx
  useEffect(() => {
    if (!showPreview || isLikec4) return // likec4 renders via a React component, not SVG
    // … existing mermaid/plantuml render logic unchanged …
  }, [showPreview, isLikec4, isPlantuml, source, mode])
```

- [ ] **Step 5: Render the React preview for likec4**

In the preview region, branch so likec4 mounts the component while mermaid/plantuml keep the `dangerouslySetInnerHTML` path. Replace the `{showPreview && ( … )}` block with:

```tsx
{showPreview && (
  <Box className="anynote-code-block__preview" contentEditable={false}>
    {isLikec4 ? (
      <Box sx={{ width: '100%', height: 360 }}>
        <Likec4Diagram source={source} mode={mode} />
      </Box>
    ) : error ? (
      <Box className="anynote-code-block__error">{error}</Box>
    ) : (
      <Box
        sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )}
  </Box>
)}
```

> The fixed `height: 360` gives xyflow a viewport — unlike an SVG it has no intrinsic height. The "non-empty block opens in Просмотр" default already lives in the `view` initializer and keys off `isDiagram`, so likec4 inherits "visualization on start".

- [ ] **Step 6: Add the `/likec4` slash item**

In `packages/editor/src/slash-items.ts`, after the `plantuml` item, before `d2`:

```ts
  {
    id: 'likec4',
    group: 'code',
    label: 'LikeC4',
    keywords: ['likec4', 'c4', 'architecture', 'архитектура', 'диаграмма'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'likec4' }).run(),
  },
```

- [ ] **Step 7: Verify the editor type-checks and lints**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/editor/src/extensions/code-block.tsx packages/editor/src/slash-items.ts
git commit -m "feat(editor): likec4 code block preview + slash item"
```

---

## Task 11: E2E — likec4 code block + final gates

**Files:**
- Modify: `apps/e2e/code-block.spec.ts`

- [ ] **Step 1: Add the likec4 code-block test**

Read the existing `plantuml code block toggles to a rendered preview` test in `apps/e2e/code-block.spec.ts` and add a sibling (reuse its `setupTextPage` helper). Assert a `.react-flow__node`, not `svg`.

```ts
test('likec4 code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('likec4')
  await page.getByRole('button', { name: 'LikeC4' }).click()
  await page.keyboard.type(
    "specification {\n element system\n}\nmodel {\n a = system 'A'\n}\nviews {\n view index {\n include *\n}\n}",
  )

  await page.getByRole('button', { name: 'Просмотр' }).click()
  await expect(page.locator('.anynote-code-block__preview .react-flow__node').first()).toBeVisible({
    timeout: 30_000,
  })
})
```

> Monaco/the code editor may auto-close brackets; if the typed source ends up malformed, switch to selecting the block and pasting via `page.evaluate`/clipboard, or assert on the error chip's absence + a node. Adjust to whatever the existing plantuml/mermaid code-block tests do for multi-line source.

- [ ] **Step 2: Run the code-block E2E**

Run: `pnpm exec playwright test apps/e2e/code-block.spec.ts`
Expected: PASS (all cases, including the new likec4 one).

- [ ] **Step 3: Run the full merge gate**

Run: `pnpm gates`
Expected: PASS — `check-types` + `lint --max-warnings 0` + `build` + `test` all green across the workspace. Critically, the Mermaid/PlantUML suites stay green (proves the diagram-board change is non-breaking).

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/code-block.spec.ts
git commit -m "test(e2e): likec4 code block renders a diagram preview"
```

---

## Self-review notes (coverage map spec → tasks)

- Spec §3 (diagram-board pluggable preview) → **Task 2**
- Spec §4 (`@repo/likec4` package: language, board, types, exports, package.json) → **Tasks 1, 3, 5, 6**
- Spec §5 (`Likec4Diagram`: parse→layout→render, view selector, navigation, theme, placeholder, resilience) → **Tasks 4, 5, 6**
- Spec §6 (page-type wiring: prisma+migration, renderer, submenu, unions, full-bleed, transpile, web dep) → **Tasks 1, 7, 8**
- Spec §7 (code-block preview as React mount + bounded height; `/likec4` slash item; editor dep) → **Tasks 1, 10**
- Spec §8 (testing: tokenizer unit, light smoke, page E2E, code-block E2E) → **Tasks 3, 4, 9, 11**
- Spec §9 (risks: wasm de-risk first, exact API, viewport) → **Task 9 gate; verified API in header; Task 10 fixed height**
- Spec "no infra" → no compose/traefik/env/turbo tasks (intentional)
- Type consistency: `DiagramPreviewProps` (Task 2) consumed by `Likec4PagePreview` (Task 6); `viewLabel`/`resolveSelectedViewId`/`ViewLike` (Task 4) consumed by `Likec4Diagram` (Task 5); `Likec4Diagram` (Task 5) consumed by `Likec4PagePreview` (Task 6) and `code-block.tsx` (Task 10); `Likec4Board` (Task 6) consumed by `page-renderer.tsx` (Task 8) — all names match.
