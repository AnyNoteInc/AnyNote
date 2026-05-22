# Mermaid Page Type — Design Spec

**Date:** 2026-05-21
**Status:** Draft, awaiting user review
**Scope:** A new `MERMAID` page type — a split-pane collaborative page (Monaco source editor 30% / live diagram canvas 70%) backed by a new `@repo/mermaid` package, persisted through the existing Hocuspocus/Yjs pipeline.

---

## 1. Goals & Non-goals

### Goals

- Author Mermaid diagrams on a dedicated page. Left 30% is a Monaco editor with Mermaid syntax highlighting; right 70% is a live-rendered diagram canvas with zoom/pan and SVG/PNG export. Source text collaborates in real time via Yjs exactly like other page types (TEXT, EXCALIDRAW, GENOGRAM).
- Monaco is **self-hosted (bundled)** so the editor works fully offline / in an air-gapped corporate deployment — no runtime CDN dependency.

### Non-goals (this spec)

- Indexing Mermaid source into the RAG/vector pipeline (the `content` snapshot is written, but no outbox event is enqueued — same posture as GENOGRAM). Future enhancement.
- A visual/WYSIWYG diagram builder. The only authoring surface is the Mermaid text source.
- Real-time collaborative cursors *inside* the Mermaid preview canvas (awareness is wired for the Monaco source editor only).
- Seeding starter diagram content server-side. New pages open empty with a Monaco placeholder hint.

---

## 2. Architecture Overview

```
Browser  apps/web  /workspaces/{wsId}/pages/{pageId}
  └─ <PageRenderer page={page}>
       ├─ type=EXCALIDRAW → <Board/>          (packages/excalidraw, dynamic ssr:false)
       ├─ type=GENOGRAM   → <GenogramBoard/>   (packages/genogram,   dynamic ssr:false)
       ├─ type=MERMAID    → <MermaidBoard/>     (packages/mermaid,    dynamic ssr:false)  ← NEW
       └─ type=TEXT       → <AnyNoteEditor/>    (packages/editor,     dynamic ssr:false)

Browser ↔ apps/yjs (WebSocket, Hocuspocus)   — unchanged transport
  onStoreDocument → persistence.ts switches on PageType:
     TEXT      → content = TiptapTransformer.fromYdoc(doc, 'default')
     EXCALIDRAW→ content = { elements: yArray('elements').toJSON() }
     MERMAID   → content = { source: doc.getText('mermaid').toString() }   ← NEW
     GENOGRAM  → (no content snapshot)

Postgres
  Page.type        PageType  — + MERMAID                                   ← NEW enum value
  Page.contentYjs  Bytes?    — authoritative Y.Doc state (mermaid source lives in Y.Text 'mermaid')
  Page.content     Json?     — { source } snapshot for MERMAID
```

**Key invariants (carried over from the collaborative-editor design):**

- `Page.contentYjs` is the source of truth for live state; `Page.content` is a denormalized snapshot written only by `apps/yjs`.
- The Mermaid source is a single `Y.Text` root named `'mermaid'`. Monaco binds to it via `y-monaco`; the preview observes it.
- Each new collaborative page-type package follows the established pattern: double `next/dynamic` `ssr:false`, a StrictMode-safe Yjs hook (create `Y.Doc` + `HocuspocusProvider` in `useEffect`, deferred destroy ~300ms), and `moduleResolution: "Bundler"` so Next transpiles `src/` directly.

---

## 3. `MERMAID` page type

### 3.1 New package `@repo/mermaid`

Mirrors `@repo/excalidraw`/`@repo/genogram`. Files:

| File | Responsibility |
|---|---|
| `src/index.ts` | Public exports: `MermaidBoard`, `type MermaidBoardProps` |
| `src/mermaid-board.tsx` | `'use client'`; `dynamic(() => import('./mermaid-board-inner').then(m => m.MermaidBoardInner), { ssr: false })` |
| `src/mermaid-board-inner.tsx` | Split-pane shell with a draggable divider (default 30/70); hosts source editor + preview |
| `src/use-mermaid-yjs.ts` | Creates `Y.Doc` + `HocuspocusProvider`; `ydoc.getText('mermaid')`; applies `initialContentYjs`; deferred destroy 300ms |
| `src/mermaid-source-editor.tsx` | Monaco editor; `MonacoBinding(ytext, model, new Set([editor]), provider.awareness)`; registers a Mermaid Monarch grammar; theme `vs`/`vs-dark` |
| `src/mermaid-preview.tsx` | Observes `Y.Text` → debounced (~300ms) `mermaid.render()` → injects SVG; error panel; zoom/pan viewport; export toolbar |
| `src/mermaid-theme.ts` | Maps MUI `palette.mode` → mermaid theme (`default`/`dark`) and Monaco theme (`vs`/`vs-dark`) |
| `src/mermaid-language.ts` | Minimal Monaco Monarch tokenizer + language registration for `mermaid` keywords (`graph`, `sequenceDiagram`, `classDiagram`, `-->`, `==>`, etc.) |
| `src/export.ts` | Pure helpers: serialize SVG string; rasterize SVG → PNG via offscreen `<canvas>`; copy to clipboard |
| `src/types.ts` | `MermaidBoardProps { pageId; yjsUrl; yjsToken: () => Promise<string>; initialContentYjs?: string \| null; user?: { id; name; color }; editable?: boolean; className?: string }` |
| `package.json`, `tsconfig.json`, `README.md` | Standard workspace package scaffolding (lint/build/check-types scripts; `moduleResolution: "Bundler"`) |

**Dependencies:** `mermaid@^11`, `monaco-editor@^0.52` (bundled), `@monaco-editor/react@^4` (configured via `loader.config({ monaco })` to use the npm package, not CDN), `y-monaco`, `@hocuspocus/provider@^3.4.4`, `yjs@^13.6.30`, `react-zoom-pan-pinch` (viewport zoom/pan + fit/reset), `@mui/material@^7`. Peer/runtime `react@^19`, `next@^16`. PNG export uses native `<canvas>` — no extra dependency.

### 3.2 Yjs structure & Monaco binding

- Single root: `ydoc.getText('mermaid')`.
- `MonacoBinding` from `y-monaco` binds the `Y.Text` to the Monaco model; `provider.awareness` is passed for remote selection awareness.
- `initialContentYjs` (base64) is decoded and `Y.applyUpdate`-d before binding (same flash-prevention as `@repo/excalidraw`), even though Hocuspocus also hydrates server-side.

### 3.3 Monaco bundling & web workers (PRIMARY RISK)

Bundled Monaco needs a web worker. Under Next 16 + Turbopack, `monaco-editor-webpack-plugin` is unavailable. Strategy:

```ts
self.MonacoEnvironment = {
  getWorker() {
    return new Worker(
      new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url),
      { type: 'module' },
    )
  },
}
```

This `new URL(..., import.meta.url)` worker pattern is understood by both Turbopack and webpack 5. Mermaid is a Monarch-only language (no language server), so only the base `editor.worker` is required. **Validate with a throwaway spike before building the rest of the package**, in both `pnpm --filter web dev` (Turbopack) and `pnpm build`.

### 3.4 Preview pane

- Observes the `Y.Text`; on change, debounced ~300ms, calls `mermaid.render(uniqueId, source)`.
- `mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' })`; theme from `mermaid-theme.ts`, re-initialized on MUI mode change.
- Invalid syntax: `mermaid.render` rejects → catch → render a non-destructive error panel (keep the last good SVG visible faded, show the parser message). The editor is never blocked.
- SVG is wrapped in a `react-zoom-pan-pinch` viewport: wheel-zoom, drag-pan, and a "fit" / reset control.
- Export toolbar: **Export SVG** (download serialized SVG), **Export PNG** (rasterize via `<canvas>`), **Copy** (SVG/PNG to clipboard). All client-side.

### 3.5 Server-side persistence snapshot

In [`apps/yjs/src/persistence.ts`](../../apps/yjs/src/persistence.ts) `storePageDocument`, add a branch after EXCALIDRAW:

```ts
} else if (pageType === PageType.MERMAID) {
  data.content = { source: document.getText('mermaid').toString() }
}
```

No outbox enqueue (MVP). Add a `persistence.spec.ts` case asserting `content === { source }` is written and no outbox event fires.

### 3.6 apps/web wiring

- `apps/web/next.config.js` → add `'@repo/mermaid'` to `transpilePackages`.
- [`page-renderer.tsx`](../../apps/web/src/components/page/page-renderer.tsx) → `dynamic` import `MermaidBoard` (`ssr:false`, spinner fallback) + `if (page.type === 'MERMAID')` branch passing `pageId`, `initialContentYjs`, `yjsUrl=resolveYjsUrl()`, `yjsToken=fetchYjsToken`, `user`.
- [`page-tree-section.tsx`](../../apps/web/src/components/workspace/page-tree-section.tsx) → add `MERMAID` to `CreatablePageType`; add a `CreatePageMenu` item (icon `SchemaIcon`, label **«Диаграмма»**); `createPage.mutate({ workspaceId, parentId, type: 'MERMAID' })`.
- [`page-actions-menu.tsx`](../../apps/web/src/components/page/page-actions-menu.tsx) and [`page-actions-toolbar.tsx`](../../apps/web/src/components/page/page-actions-toolbar.tsx) → add `'MERMAID'` to the `pageType` unions; it behaves like EXCALIDRAW (no outline, no full-width toggle, no text export).
- [`pages/[pageId]/page.tsx`](../../apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx) → add `|| page.type === 'MERMAID'` to `isFullBleed` (split-pane uses full height; no title header).
- tRPC `page.create` ([`packages/trpc/src/routers/page.ts`](../../packages/trpc/src/routers/page.ts)) → no change needed; `z.nativeEnum(PageType)` already accepts `MERMAID`, no seed defaults required.

### 3.7 Schema & migration

- Add `MERMAID` to the `PageType` enum in [`packages/db/prisma/schema.prisma`](../../packages/db/prisma/schema.prisma).
- Migration via `pnpm --filter @repo/db exec prisma migrate dev --name add_mermaid_page_type` → `ALTER TYPE "PageType" ADD VALUE 'MERMAID';`.

---

## 4. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Monaco web worker under Next 16 + Turbopack | `new URL(..., import.meta.url)` worker pattern; spike-validate in dev + build before full build-out |
| Bundle size (Monaco + mermaid) | Both load only via `next/dynamic ssr:false`, only on the relevant page; not in the marketing/RSC bundle |
| Mermaid `securityLevel` / XSS via diagram source | `securityLevel: 'strict'`; source is per-page collaborative content, same trust boundary as page text |

---

## 5. Testing strategy

- **TDD unit (vitest):**
  - `@repo/mermaid`: `mermaid-theme.ts` mapping; `export.ts` SVG→PNG / serialize; preview render wrapper with a mocked `mermaid.render` (success + reject → error state); Mermaid Monarch tokenizer smoke test.
  - `apps/yjs`: `persistence.spec.ts` MERMAID snapshot case.
- **E2E (Playwright):**
  - Create a MERMAID page, type `graph TD; A-->B;`, assert `<svg>` appears in the preview; type invalid syntax, assert the error panel; exercise an export control.
- **Gates:** `pnpm gates` (check-types + lint + build + test) must pass.

---

## 6. Decisions & defaults (confirmed)

- Monaco: **self-hosted / bundled** (offline-safe).
- Preview canvas: **zoom/pan + SVG/PNG export + copy**.
- Page-creation menu item: label **«Диаграмма»**, icon `SchemaIcon`.
- Split-pane divider: **draggable**, default 30/70.
- New page initial content: **empty** + Monaco placeholder hint.
- Mermaid RAG indexing: **out of scope** (snapshot written, no outbox).

---

## 7. File-change checklist

**New (`@repo/mermaid`):** `package.json`, `tsconfig.json`, `README.md`, `src/{index,mermaid-board,mermaid-board-inner,use-mermaid-yjs,mermaid-source-editor,mermaid-preview,mermaid-theme,mermaid-language,export,types}.ts(x)` + tests.

**Changed:**
- `apps/web/next.config.js` (transpilePackages)
- `apps/web/src/components/page/page-renderer.tsx`
- `apps/web/src/components/workspace/page-tree-section.tsx`
- `apps/web/src/components/page/page-actions-menu.tsx`
- `apps/web/src/components/page/page-actions-toolbar.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`
- `apps/yjs/src/persistence.ts` (+ `persistence.spec.ts`)
- `packages/db/prisma/schema.prisma` (+ migration)
- `CLAUDE.md` (page-renderer dispatch note, transpilePackages list)
- `apps/e2e/` (new specs)
