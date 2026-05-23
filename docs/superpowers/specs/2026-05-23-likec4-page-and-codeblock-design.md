# LikeC4 page type + code-block preview — Design Spec

**Date:** 2026-05-23
**Status:** Draft, awaiting user review
**Branch:** `feat/mermaid`

## Summary

Add **LikeC4** as a first-class diagram surface, in the two places the user asked for, mirroring how Mermaid and PlantUML already work:

1. **Page creation** — a new `LIKEC4` `PageType`, created from the existing **«Диаграмма»** submenu (which today offers MermaidJS / PlantUML), rendered by the same collaborative split-pane board (Monaco source editor + live preview).
2. **Editor «Код» code block** — a new ` ```likec4 ` language with Monaco syntax highlighting and a **Код↔Просмотр** toggle that defaults a non-empty block to the rendered diagram ("на старте с визуализацией").

The crucial difference from Mermaid/PlantUML: **LikeC4 does not produce an SVG string.** A LikeC4 source describes a *model* with **multiple views**, parsed and laid out in the browser, then rendered as an **interactive React/xyflow component tree** — not markup injected via `innerHTML`. So LikeC4 cannot reuse the shared `DiagramPreview` (which does `containerRef.innerHTML = svg`) or the `DiagramRenderer` `(id, source, mode) => Promise<{svg}>` contract. It needs its own React preview component, used in **both** the page board and the code block.

Per the user's choice, the preview shows a **view selector** (dropdown listing every declared view) plus LikeC4's **built-in navigation buttons** (click-through between linked views) — fully surfacing LikeC4's multi-view nature.

Rendering is **fully client-side**: parse via `@likec4/language-services/browser` `fromSource`, layout via `@likec4/layouts` (graphviz-wasm), render via `@likec4/diagram`. **No server, no Docker container, no Traefik route, no env vars** — simpler than PlantUML.

This builds on the shared `@repo/diagram-board` extracted in [2026-05-22-plantuml-page-and-diagram-board-design.md](2026-05-22-plantuml-page-and-diagram-board-design.md), which it extends with a pluggable preview.

---

## 1. Goals & Non-goals

### Goals

- A new `LIKEC4` `PageType` created from the «Диаграмма» submenu (third item, after MermaidJS / PlantUML), rendering the same split-pane board UX: Monaco source editor (left, Yjs-collaborative) + live preview (right).
- The preview parses + lays out + renders LikeC4 **in the browser**, showing a **view selector** (all declared views) + LikeC4's built-in navigation buttons, with pan/zoom.
- The editor gains a ` ```likec4 ` code block: Monaco highlighting, a **Код↔Просмотр** toggle, and a new `/likec4` slash item. A non-empty block opens in **Просмотр** (rendered) by default.
- Generalize `@repo/diagram-board` so a diagram type can supply a **custom React preview component** instead of an SVG render function — **without changing Mermaid/PlantUML behaviour or their tests**.
- One shared `Likec4Diagram` React component drives **both** the page preview and the code-block preview (single render path).

### Non-goals

- **No SVG/PNG export buttons** for LikeC4 (v1). LikeC4 emits no plain-SVG string; it relies on its built-in pan/zoom + navigation. Image export is a possible follow-up.
- **No server-side rendering.** No `/api/likec4/render` route, no container, no Traefik, no env vars. (LikeC4's official SVG export needs a headless browser — explicitly rejected; it would also kill the interactivity the user chose.)
- **No d2 rendering.** d2 stays a plain highlighted code block.
- **No change to page persistence.** LikeC4 source lives in a `Y.Text('likec4')` root; the page persists via the existing `contentYjs`/`content` snapshot path, exactly like Mermaid/PlantUML.
- **No change to Mermaid/PlantUML.** Their SVG `render` path and tests stay green.
- **No dark-theme recoloring beyond what LikeC4 offers.** The diagram follows LikeC4's own color scheme, mapped from site light/dark; the Monaco editor chrome follows site light/dark as today.

---

## 2. Architecture overview

```
PAGE TYPE (LIKEC4)
  page-tree-section.tsx  «Диаграмма» submenu → MermaidJS | PlantUML | LikeC4
  page-renderer.tsx      type==='LIKEC4' → <Likec4Board pageId initialContentYjs yjsUrl yjsToken user/>
        │
        ▼
  @repo/likec4  Likec4Board = <DiagramBoard config={likec4Config} {...props}/>
        │                                  │
        │                                  ├── Preview: <Likec4PagePreview ytext mode/>   ← NEW: React preview, not SVG
        ▼                                  ├── language: likec4 monarch
  @repo/diagram-board (shared, extended)   └── docName: 'likec4', idPrefix: 'likec4'
    DiagramBoard → (dynamic, ssr:false) BoardInner
      ├─ SourceEditor (Monaco + y-monaco, languageId + registerLanguage)   ← reused unchanged
      └─ Preview ? <Preview ytext mode idPrefix/> : <DiagramPreview render/>  ← NEW branch
                              │
                              ▼
                  @repo/likec4  <Likec4Diagram source mode/>   ← THE shared preview
                    fromSource(source) → likec4.layoutedModel()         (@likec4/language-services/browser)
                    → <LikeC4ModelProvider model>                       (@likec4/diagram)
                         <ViewSelect/> + <ReactLikeC4 viewId pannable zoomable
                                            showNavigationButtons onNavigateTo/>

EDITOR CODE BLOCK
  code-block.tsx  language==='likec4'
    → Код↔Просмотр toggle; in Просмотр mounts <Likec4Diagram source={node.textContent} mode/>   ← same component
      (mermaid/plantuml keep the dangerouslySetInnerHTML SVG path; likec4 mounts a React child)
  slash-items.ts  new `/likec4` item → setCodeBlock({ language: 'likec4' })
```

Both surfaces render LikeC4 through the **single** `Likec4Diagram` component. All LikeC4 work (Langium parser, graphviz-wasm, xyflow) loads behind `ssr:false` dynamic imports — only on a LikeC4 page or when a `likec4` code block enters Просмотр.

---

## 3. `@repo/diagram-board` — pluggable preview (the only shared-core change)

Today `DiagramConfig` requires `render: DiagramRenderer` and `board-inner.tsx` always renders `<DiagramPreview render={config.render} …/>` (which injects SVG via `innerHTML`). LikeC4 has no SVG, so we make the preview pluggable.

### 3.1 `src/types.ts` — `DiagramConfig` change

```ts
import type { ComponentType } from 'react'
import type * as Y from 'yjs'
import type { ColorMode, DiagramRenderer } from './render-types'

export type DiagramPreviewProps = { ytext: Y.Text; mode: ColorMode; idPrefix: string }

export type DiagramConfig = {
  docName: string
  languageId: string
  registerLanguage: (m: typeof import('monaco-editor')) => void
  idPrefix: string
  placeholder?: string
  /** SVG path (mermaid, plantuml). Mutually exclusive with `Preview`. */
  render?: DiagramRenderer
  /** Custom React preview (likec4). Mutually exclusive with `render`. */
  Preview?: ComponentType<DiagramPreviewProps>
}
```

`render` becomes optional; exactly one of `render` / `Preview` is supplied.

### 3.2 `src/board-inner.tsx` — branch

Replace the hard-coded preview with:

```tsx
const Preview = config.Preview
…
<Box sx={{ flex: 1, minWidth: 0 }}>
  {Preview ? (
    <Preview ytext={resources.ytext} mode={mode} idPrefix={config.idPrefix} />
  ) : (
    <DiagramPreview ytext={resources.ytext} mode={mode} render={config.render!} idPrefix={config.idPrefix} />
  )}
</Box>
```

### 3.3 `src/index.ts` — export the new prop type

Add `DiagramPreviewProps` to the type re-exports.

> Mermaid/PlantUML configs still pass `render` only → identical behaviour, same `data-testid`s, same tests. This is the regression guard.

---

## 4. New package: `@repo/likec4`

At `packages/likec4`, same toolchain config as `@repo/plantuml` (`moduleResolution: "Bundler"`, extensionless relative imports, consumed raw by Next via `transpilePackages`). Mirror `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`.

### 4.1 Files

| File | Purpose |
|------|---------|
| `src/likec4-language.ts` | `LIKEC4_LANGUAGE_ID = 'likec4'` + `registerLikec4Language(m)` — Monarch tokenizer (idempotent register), modelled on `mermaid-language.ts` |
| `src/likec4-diagram.tsx` | **The shared preview** (§5). `Likec4Diagram({ source, mode })` — parse→layout→render with view selector + navigation + error/loading |
| `src/likec4-page-preview.tsx` | Board adapter: `Likec4PagePreview({ ytext, mode, idPrefix })` — observes the `Y.Text` (debounced, like `DiagramPreview`) and feeds its string to `<Likec4Diagram>` |
| `src/likec4-board.tsx` | `Likec4Board(props) => <DiagramBoard config={likec4Config} {...props}/>` |
| `src/types.ts` | `export type { DiagramBoardProps as Likec4BoardProps, DiagramUser as Likec4User } from '@repo/diagram-board'` |
| `src/index.ts` | `export { Likec4Board } from './likec4-board'`; `export { Likec4Diagram } from './likec4-diagram'`; `export type { Likec4BoardProps, Likec4User } from './types'` |

### 4.2 `likec4-board.tsx`

```tsx
'use client'
import { DiagramBoard, type DiagramConfig } from '@repo/diagram-board'
import { LIKEC4_LANGUAGE_ID, registerLikec4Language } from './likec4-language'
import { Likec4PagePreview } from './likec4-page-preview'
import type { Likec4BoardProps } from './types'

const likec4Config: DiagramConfig = {
  docName: 'likec4',
  languageId: LIKEC4_LANGUAGE_ID,
  registerLanguage: registerLikec4Language,
  idPrefix: 'likec4',
  Preview: Likec4PagePreview,
  placeholder: PLACEHOLDER_MODEL, // §5.4
}

export function Likec4Board(props: Likec4BoardProps) {
  return <DiagramBoard config={likec4Config} {...props} />
}
```

### 4.3 `likec4-language.ts`

Monarch tokenizer with LikeC4 keywords: `specification`, `model`, `views`, `element`, `tag`, `relationship`, `person`, `system`, `softwareSystem`, `container`, `component`, `actor`, `view`, `viewof`, `of`, `extend`, `include`, `exclude`, `style`, `autoLayout`, `group`, `dynamic`, `navigateTo`, `title`, `description`, `technology`, `link`, `icon`, `color`, `shape`; arrows `->`, `<-`, `-[`, `]->`; `'…'`/`"…"` strings; `//` and `/* */` comments. `registerLikec4Language` follows the mermaid pattern (check `getLanguages()` for idempotency, `register` + `setMonarchTokensProvider`).

### 4.4 `package.json`

```jsonc
{
  "name": "@repo/likec4",
  "private": true,
  "exports": {
    ".":            { "types": "./src/index.ts",          "import": "./src/index.ts",          "default": "./src/index.ts" },
    "./likec4-diagram": { "types": "./src/likec4-diagram.tsx", "import": "./src/likec4-diagram.tsx", "default": "./src/likec4-diagram.tsx" },
    "./*":          { "types": "./src/*", "import": "./src/*", "default": "./src/*" }
  },
  "dependencies": {
    "@repo/diagram-board": "workspace:*",
    "likec4": "^1.57.0",
    "@likec4/diagram": "^1.57.0",
    "@likec4/language-services": "^1.57.0",
    "@likec4/layouts": "^1.57.0",
    "monaco-editor": "^0.52.2",
    "react": "^19.2.0"
  },
  "peerDependencies": { "next": "^16.0.0" }
}
```

> Pin all `@likec4/*` + `likec4` to the **same** version (1.57.0 today). Mismatched LikeC4 sub-package versions break the model/layout/diagram contract. Confirm the exact set of runtime deps needed (e.g. whether `@likec4/core` must be direct) once `pnpm install` resolves the tree.

---

## 5. The shared preview: `Likec4Diagram`

`src/likec4-diagram.tsx` — `'use client'`. Props `{ source: string; mode: ColorMode }` (`ColorMode` from `@repo/diagram-board/render-types`). Used by the page board (via `Likec4PagePreview`) and the code block.

### 5.1 Parse + layout (browser, async, cancellable)

```ts
// dynamic import keeps the Langium parser + wasm out of the main bundle
const { fromSource } = await import('@likec4/language-services/browser')
const likec4 = await fromSource(source)
const model = await likec4.layoutedModel()   // LikeC4Model.Layouted
```

- Debounce source changes (~300 ms) and guard with a generation counter, exactly like `DiagramPreview.draw` (skip no-op updates, ignore superseded renders).
- On parse/layout error: keep the **last good model** mounted and show an error chip (bottom overlay, `data-testid="likec4-error"`) — same resilience pattern as `DiagramPreview`.
- Empty/whitespace source → render nothing (no error).

### 5.2 View selector + render

```tsx
import { LikeC4ModelProvider, ReactLikeC4 } from '@likec4/diagram'
…
const views = [...model.views()]                 // enumerate; confirm API shape vs v1.57 types
const [viewId, setViewId] = useState(views[0]?.id)
// reset/keep viewId when the view set changes (e.g. selected view removed → fall back to first)

<LikeC4ModelProvider model={model}>
  {views.length > 1 && (
    <Select size="small" value={viewId} onChange={…} data-testid="likec4-view-select">
      {views.map((v) => <MenuItem key={v.id} value={v.id}>{v.title ?? v.id}</MenuItem>)}
    </Select>
  )}
  <ReactLikeC4
    viewId={viewId}
    pannable
    zoomable
    keepAspectRatio
    showNavigationButtons
    onNavigateTo={setViewId}
    colorScheme={mode}            // map MUI 'light'|'dark' → LikeC4; confirm prop name vs types
    background="transparent"
  />
</LikeC4ModelProvider>
```

- Container fills its parent (`height/width: 100%`), `position: relative`; the `Select` floats top-left, mirroring `DiagramPreview`'s top-right toolbar placement.
- `data-testid="likec4-preview"` on the diagram container (E2E target).
- Loading state (parsing/laying out, no model yet) → centered `CircularProgress`.

> **API names to confirm against the installed `@likec4/diagram` / `likec4` v1.57 types during impl:** `layoutedModel()`, `model.views()` enumeration + `view.id`/`view.title`, `ReactLikeC4` prop names (`colorScheme`, `showNavigationButtons`, `onNavigateTo`, `keepAspectRatio`). If `ReactLikeC4` is not the right export, fall back to `likec4/react`'s `LikeC4View` + a manual `<Select>`. The component choice does not change this spec's structure.

### 5.3 Theme

Map MUI `mode` → LikeC4 color scheme each render. If `ReactLikeC4` has no direct `colorScheme` prop, wrap in LikeC4's theme mechanism or set the documented CSS variable/attribute. Re-render on `mode` change (it's a prop/dep).

### 5.4 Placeholder model

A minimal valid model so a freshly-created page/block previews immediately:

```
specification {
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
}
```

---

## 6. LikeC4 page type wiring

Every per-type touchpoint (traced from how `PLANTUML` was added — confirmed current on `feat/mermaid`):

| # | File | Change |
|---|------|--------|
| 1 | [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) | add `LIKEC4` to `enum PageType` (after `PLANTUML`) |
| 2 | new migration | `pnpm --filter @repo/db exec prisma migrate dev --name add_likec4_page_type` → `ALTER TYPE "PageType" ADD VALUE 'LIKEC4';` |
| 3 | [apps/web/src/components/page/page-renderer.tsx](../../apps/web/src/components/page/page-renderer.tsx) | `const Likec4Board = dynamic(() => import('@repo/likec4').then((m) => m.Likec4Board), { ssr: false, loading: () => <CenteredSpinner/> })`; add `if (page.type === 'LIKEC4')` returning `<Likec4Board pageId={page.id} initialContentYjs={page.contentYjs} yjsUrl={resolveYjsUrl()} yjsToken={fetchYjsToken} user={user} />` (same props as the `PLANTUML` case) |
| 4 | [apps/web/src/components/workspace/page-tree-section.tsx](../../apps/web/src/components/workspace/page-tree-section.tsx) | add `'LIKEC4'` to `CreatablePageType`; add a third `<MenuItem onClick={() => choose('LIKEC4')}>` (label **LikeC4**, `SchemaIcon`) in the `DiagramSubmenu` child `Menu` |
| 5 | [apps/web/src/components/page/page-actions-toolbar.tsx](../../apps/web/src/components/page/page-actions-toolbar.tsx) | add `'LIKEC4'` to the page-type union |
| 6 | [apps/web/src/components/page/page-actions-menu.tsx](../../apps/web/src/components/page/page-actions-menu.tsx) | add `'LIKEC4'` to the `pageType` prop union; behaves like other non-`TEXT` types (existing `=== 'TEXT'` guards already cover outline/export) |
| 7 | [apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx](../../apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx) | add `page.type === 'LIKEC4'` to the `isFullBleed` check (lines ~34-38, alongside `MERMAID`/`PLANTUML`) |
| 8 | [packages/trpc/src/routers/page.ts](../../packages/trpc/src/routers/page.ts) | none — `z.nativeEnum(PageType)` auto-validates; no seeding (mirror Mermaid/PlantUML) |
| 9 | [apps/web/next.config.js](../../apps/web/next.config.js) | add `'@repo/likec4'` to `transpilePackages` |
| 10 | [apps/web/package.json](../../apps/web/package.json) | add `"@repo/likec4": "workspace:*"` |

---

## 7. Editor «Код» block — LikeC4 preview + slash item

### 7.1 [packages/editor/src/extensions/code-block.tsx](../../packages/editor/src/extensions/code-block.tsx)

`CodeBlockView` is a React NodeView (`ReactNodeViewRenderer(CodeBlockView)`, renders a `NodeViewWrapper`), so mounting a React child for LikeC4 is natural.

- Add `{ value: 'likec4', label: 'LikeC4' }` to `CODE_LANGUAGES`.
- `const isLikec4 = node.attrs.language === 'likec4'`; `const isDiagram = isMermaid || isPlantuml || isLikec4`. The toggle UI + default-to-preview logic (`source.trim() ? 'preview' : 'code'`) already key off `isDiagram` → LikeC4 inherits the **Код↔Просмотр** toggle and the "non-empty opens in Просмотр" default for free.
- **Render branch:** mermaid/plantuml keep the existing effect (`renderMermaid`/`renderPlantuml` → `setSvg` → `dangerouslySetInnerHTML`). For LikeC4 there is **no SVG**: when `showPreview && isLikec4`, render `<Likec4Diagram source={source} mode={mode} />` (imported from `@repo/likec4/likec4-diagram`) directly in the preview `Box` instead of the `dangerouslySetInnerHTML` node. Skip the SVG render effect entirely when `isLikec4` (the component manages its own parse/layout/debounce).
- Give the LikeC4 preview a bounded height in the code block (e.g. `min-height` ~320px, `resize: vertical` or fixed) so the xyflow canvas has a viewport — unlike an SVG it has no intrinsic height.
- [packages/editor/package.json](../../packages/editor/package.json): add `"@repo/likec4": "workspace:*"`.

### 7.2 [packages/editor/src/slash-items.ts](../../packages/editor/src/slash-items.ts)

Add a `likec4` item to the `code` group (after `plantuml`, before `d2`), mirroring the existing entries:

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

In the protected app the same-origin session already covers everything; LikeC4 needs no network/auth (all client-side).

---

## 8. Testing strategy

**Unit (vitest, `@repo/likec4`):**
- `likec4-language.test.ts` — `registerLikec4Language` is idempotent and registers `likec4`.
- A **light** smoke test that `fromSource(PLACEHOLDER_MODEL)` resolves and yields ≥1 view. If the browser parser needs real DOM/wasm not available under the vitest `node`/`jsdom` env, downgrade this to a type-level/structure assertion or mark it integration — do **not** block the suite on wasm.

**E2E (Playwright)** — no container needed (client-side):
- New `apps/e2e/likec4-page.spec.ts` — «Диаграмма» → **LikeC4**; wait for the page route; type the placeholder/known model into Monaco; assert the diagram renders. **Selectors:** assert `[data-testid="likec4-preview"]` contains a `.react-flow` node/`.react-flow__node` (xyflow renders `<div>`s, **not** a single `svg`); if >1 view, assert `[data-testid="likec4-view-select"]` present.
- Extend [apps/e2e/code-block.spec.ts](../../apps/e2e/code-block.spec.ts) — `/likec4` slash item → type model → **Просмотр** → assert a `.react-flow` node renders inside `.anynote-code-block__preview`.
- The existing «Диаграмма» submenu E2E (mermaid/plantuml) is unaffected; LikeC4 just adds a third item.

**Gates:** `pnpm gates` (check-types + lint `--max-warnings 0` + build + test) green. Critically, `pnpm --filter @repo/mermaid test` / `@repo/plantuml` and their E2E confirm the `diagram-board` preview-pluggability change is non-breaking.

---

## 9. Risks / things to verify during implementation

- **wasm under Next/Turbopack (highest risk).** `@likec4/layouts` lays out via graphviz-wasm (`@hpcc-js/wasm`). Confirm the `.wasm` loads under both Turbopack (dev) and webpack (`next build`). If not automatic, may need `transpilePackages` coverage, a webpack `asyncWebAssembly`/asset rule, or the package's documented init. **De-risk this first**, before the full wiring — it's the one thing that could invalidate the client-side approach. (If it proves intractable, the fallback is server-side layout + client render, a larger change requiring its own spec amendment.)
- **Exact v1.57 API** — `fromSource` return shape, `layoutedModel()`, view enumeration, `ReactLikeC4` props (esp. color scheme). Pin against installed types; adjust §5.2 imports/props accordingly without changing the architecture.
- **Bundle size** — Langium + xyflow + wasm are large. Mitigated by `ssr:false` dynamic import (only LikeC4 pages / previewing `likec4` code blocks). Confirm dev compile time stays acceptable.
- **Code-block viewport** — xyflow needs an explicit height; verify the bounded-height preview renders and pans inside the editor flow.
- **MUI version** — `@repo/diagram-board` uses MUI v7 (`@mui/material@^7`). `@repo/likec4`'s `Select` must import from the same MUI to avoid a second instance; reuse the board's MUI peer/dep pattern.

---

## 10. File-change checklist

**New — `packages/likec4/`:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `src/{index,likec4-language,likec4-language.test,likec4-diagram,likec4-page-preview,likec4-board,types}.ts(x)`

**Changed — `@repo/diagram-board`:** `src/types.ts` (`DiagramConfig.render` optional + `Preview` + `DiagramPreviewProps`), `src/board-inner.tsx` (preview branch), `src/index.ts` (export `DiagramPreviewProps`)

**Changed — web/db:** `packages/db/prisma/schema.prisma` (+ migration), `apps/web/next.config.js`, `apps/web/package.json`, `apps/web/src/components/workspace/page-tree-section.tsx`, `apps/web/src/components/page/{page-renderer,page-actions-toolbar,page-actions-menu}.tsx`, `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`

**Changed — editor:** `packages/editor/src/extensions/code-block.tsx`, `packages/editor/src/slash-items.ts`, `packages/editor/package.json`

**Changed — lockfile:** `pnpm-lock.yaml`

**Changed — E2E:** `apps/e2e/code-block.spec.ts` (likec4 case); **new** `apps/e2e/likec4-page.spec.ts`

> No infra/config changes (`compose.yml`, `deploy/`, `.env*`, `turbo.json`, `playwright.config.ts`) — LikeC4 renders client-side.
