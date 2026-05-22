# PlantUML page type + shared diagram-board core — Design Spec

**Date:** 2026-05-22
**Status:** Draft, awaiting user review
**Branch:** `feat/mermaid`

## Summary

Add **PlantUML** as a first-class diagram surface, in three places that mirror how Mermaid already works:

1. **Page creation menu** — the flat **«Диаграмма»** item becomes a submenu with **MermaidJS** and **PlantUML** children.
2. **PlantUML page type** — a new `PLANTUML` `PageType` rendered by a collaborative board (Monaco source editor + live preview, same as the Mermaid page) whose preview is produced by a self-hosted **`plantuml/plantuml-server:jetty`** container.
3. **Editor «Код» code block** — the existing `plantuml` code block (currently a plain highlighted block) gains the **Код↔Просмотр** toggle, rendering through the same server.

Because the Mermaid page board and a PlantUML page board overlap ~80% (Monaco + Yjs + split-pane + zoom/pan + export), this spec **extracts a shared `@repo/diagram-board` package** that both Mermaid and PlantUML consume. The only per-diagram differences are: (a) the render function, (b) the Monaco language, (c) the `Y.Text` doc name, (d) a test-id prefix.

PlantUML rendering is **server-side and internal**: the browser never talks to the PlantUML server directly. It POSTs source to a same-origin Next.js API route, which proxies to `http://plantuml:8080` — the **same pattern as Gotenberg** (an unauthenticated render service kept private, never exposed through Traefik). This decision intentionally supersedes the original request wording ("add Traefik proxying"); see [2026-05-07-server-side-page-export-design.md](2026-05-07-server-side-page-export-design.md) for the Gotenberg precedent.

This spec fulfils the PlantUML "future enhancement" deferred in [2026-05-22-tiptap-code-block-diagrams-design.md](2026-05-22-tiptap-code-block-diagrams-design.md) §1.

---

## 1. Goals & Non-goals

### Goals

- «Диаграмма» in the page-create menu is a **submenu** → **MermaidJS** (creates `MERMAID`, unchanged) / **PlantUML** (creates `PLANTUML`).
- A `PLANTUML` page renders a collaborative board identical in UX to the Mermaid page: Monaco source editor (left, Yjs-collaborative) + live preview (right) with zoom/pan and SVG/PNG export.
- The editor's `plantuml` code block gains the **Код↔Просмотр** toggle (render + copy), rendering via the PlantUML server.
- Extract a shared **`@repo/diagram-board`** package; refactor `@repo/mermaid` to consume it **without changing its public API** (`MermaidBoard`, `renderMermaid`) so existing Mermaid behaviour and tests are preserved.
- PlantUML server runs as a **private** container reached only through a Next.js proxy route (Gotenberg pattern); no public Traefik route.

### Non-goals

- **No Traefik route** for the PlantUML server (deliberate — internal only).
- **No dark-theme recoloring** of PlantUML diagrams. PlantUML themes are author-controlled in the source (`!theme …`); the preview renders the SVG as-is. Only the Monaco editor chrome follows site light/dark.
- **No d2 rendering.** d2 stays a plain highlighted code block (still a future enhancement).
- **No change to page persistence.** PlantUML source lives in a `Y.Text('plantuml')` root; the page persists via the existing `contentYjs`/`content` snapshot path, exactly like Mermaid.
- **No PlantUML server clustering / caching layer.** One container; the proxy adds a short timeout and per-session auth.

---

## 2. Architecture overview

```
PAGE TYPE (PLANTUML)
  page-tree-section.tsx  «Диаграмма» submenu → MermaidJS | PlantUML
  page-renderer.tsx      type==='PLANTUML' → <PlantumlBoard pageId initialContentYjs yjsUrl yjsToken user/>
        │
        ▼
  @repo/plantuml  PlantumlBoard = <DiagramBoard config={plantumlConfig} {...props}/>
        │                                  │
        │                                  ├── render: renderPlantuml(source) ──┐
        ▼                                  │                                    │
  @repo/diagram-board (shared)             └── language: plantuml monarch       │
    DiagramBoard → (dynamic, ssr:false) BoardInner                              │
      ├─ SourceEditor (Monaco + y-monaco, languageId + registerLanguage)        │
      └─ DiagramPreview (zoom/pan + export, calls config.render on Y.Text)      │
                                                                                ▼
EDITOR CODE BLOCK                                          POST /api/plantuml/render  (Next, auth-gated)
  code-block.tsx  language==='plantuml'                      └─ server/plantuml/render.ts
    → Код↔Просмотр toggle, render = renderPlantuml ──────────────► GET http://plantuml:8080/svg/<encoded>
                                                                     (plantuml/plantuml-server:jetty)
```

Both the page board's preview **and** the editor code-block preview render PlantUML through the **single** `renderPlantuml` client function → `/api/plantuml/render` proxy → PlantUML server. One render path.

---

## 3. Shared package: `@repo/diagram-board`

New workspace package at `packages/diagram-board`. Compiled with `moduleResolution: "Bundler"` + extensionless relative imports, consumed raw by Next (added to `transpilePackages`) — same toolchain rules as `@repo/mermaid`/`@repo/editor` (see CLAUDE.md "Realtime collaboration").

### 3.1 Files (generalized from the current `@repo/mermaid`)

| File | Origin | Generalization |
|------|--------|----------------|
| `src/monaco-env.ts` | mermaid `monaco-env.ts` | verbatim move (`configureMonaco()` — already generic) |
| `src/theme.ts` | mermaid `mermaid-theme.ts` | keep `ColorMode` + `monacoThemeForMode` (generic Monaco chrome); **`mermaidThemeForMode` stays in `@repo/mermaid`** |
| `src/export.ts` (+ `export.test.ts`) | mermaid `export.ts` | verbatim move (SVG/PNG export — already generic) |
| `src/use-diagram-yjs.ts` | mermaid `use-mermaid-yjs.ts` | add `docName: string` arg (replaces hard-coded `'mermaid'`); returns `{ ydoc, provider, ytext }` |
| `src/source-editor.tsx` | mermaid `mermaid-source-editor.tsx` | props add `languageId: string` + `registerLanguage: (m) => void` + optional `placeholder`; uses `monacoThemeForMode` |
| `src/diagram-preview.tsx` | mermaid `mermaid-preview.tsx` | takes `render: DiagramRenderer` + `idPrefix: string` props instead of importing `renderMermaid`; test-ids become `${idPrefix}-preview` / `${idPrefix}-export-svg` / `${idPrefix}-error` |
| `src/board-inner.tsx` | mermaid `mermaid-board-inner.tsx` | takes `DiagramConfig` + `DiagramBoardProps`; divider test-id `${idPrefix}-divider`; wires `useDiagramYjs({docName})`, `SourceEditor`, `DiagramPreview` |
| `src/board.tsx` | mermaid `mermaid-board.tsx` | `DiagramBoard({config, ...props})` — `dynamic(() => import('./board-inner'), { ssr:false })` wrapper |
| `src/render-types.ts` | (new, Monaco-free) | `ColorMode`, `RenderResult`, `DiagramRenderer` |
| `src/types.ts` | mermaid `types.ts` | `DiagramUser`, `DiagramBoardProps`, `DiagramConfig` |
| `src/index.ts` | (new) | re-exports below |

**Why a Monaco-free `render-types.ts`:** the editor and the leaf render functions need `RenderResult`/`ColorMode` **without** pulling Monaco into their bundle. Keeping those types in a dependency-free module (imported `import type`, fully erased) guarantees that.

### 3.2 Public contract

```ts
// render-types.ts  (Monaco-free)
export type ColorMode = 'light' | 'dark'                       // = PaletteMode
export type RenderResult = { ok: true; svg: string } | { ok: false; error: string }
export type DiagramRenderer = (id: string, source: string, mode: ColorMode) => Promise<RenderResult>

// types.ts
export type DiagramUser = { id: string; name: string; color: string }
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
  docName: string                              // Y.Text root: 'mermaid' | 'plantuml'
  languageId: string                           // Monaco language id
  registerLanguage: (m: typeof import('monaco-editor')) => void
  render: DiagramRenderer                      // client-side (mermaid) or server-proxied (plantuml)
  idPrefix: string                             // render-id + data-testid prefix
  placeholder?: string                         // editor placeholder
}

// index.ts
export { DiagramBoard } from './board'
export { configureMonaco } from './monaco-env'
export { monacoThemeForMode } from './theme'
export * from './export'
export type { DiagramBoardProps, DiagramUser, DiagramConfig } from './types'
export type { ColorMode, RenderResult, DiagramRenderer } from './render-types'
```

`DiagramBoard` is `'use client'`. It renders `<BoardInner config={config} {...props} />` through a `ssr:false` dynamic import (Monaco/board-inner touch `window` at module-eval). The leaf packages pass `config` (a plain object with function fields) from their own client components — no RSC boundary is crossed.

### 3.3 `package.json`

Move the board's runtime deps here: `@hocuspocus/provider`, `@monaco-editor/react`, `monaco-editor`, `y-monaco`, `yjs`, `react-zoom-pan-pinch`, `@mui/material`, `@mui/icons-material`, `react`; `peerDependencies: next`. Mirror `@repo/mermaid`'s `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`.

`exports` mirror Mermaid's: `"."` → `./src/index.ts` and a `"./*"` wildcard → `./src/*`. The wildcard is what lets `render-mermaid.ts`/`render-plantuml.ts`/the editor resolve `@repo/diagram-board/render-types` (and `@repo/diagram-board/types`) as raw TS without an explicit per-file entry.

---

## 4. `@repo/mermaid` after the refactor — **public API unchanged**

`page-renderer.tsx` keeps importing `MermaidBoard` from `@repo/mermaid`; the editor keeps importing `renderMermaid`/`RenderResult` from `@repo/mermaid/render-mermaid`. Both must keep working.

**Kept / changed:**
- `render-mermaid.ts` — unchanged logic; imports `mermaidThemeForMode` from `./mermaid-theme`, and `RenderResult`/`ColorMode` via `import type` from `@repo/diagram-board/render-types`. **Re-exports** `RenderResult` so `@repo/mermaid/render-mermaid` still exports it (editor relies on this). Stays Monaco-free.
- `mermaid-theme.ts` — trimmed to `mermaidThemeForMode` (imports `ColorMode` from shared). `monacoThemeForMode` moves to the shared `theme.ts`. Split `mermaid-theme.test.ts` accordingly (Monaco-theme assertions move to `@repo/diagram-board`).
- `mermaid-language.ts` (+ test) — unchanged.
- `mermaid-board.tsx` — becomes:
  ```ts
  'use client'
  import { DiagramBoard } from '@repo/diagram-board'
  import { renderMermaid } from './render-mermaid'
  import { MERMAID_LANGUAGE_ID, registerMermaidLanguage } from './mermaid-language'
  import type { MermaidBoardProps } from './types'
  const mermaidConfig = {
    docName: 'mermaid', languageId: MERMAID_LANGUAGE_ID,
    registerLanguage: registerMermaidLanguage, render: renderMermaid,
    idPrefix: 'mermaid', placeholder: 'graph TD;\n  A --> B;',
  }
  export function MermaidBoard(props: MermaidBoardProps) {
    return <DiagramBoard config={mermaidConfig} {...props} />
  }
  ```
- `types.ts` — `export type { DiagramBoardProps as MermaidBoardProps, DiagramUser as MermaidUser } from '@repo/diagram-board'`.
- `index.ts` — **unchanged** (`export { MermaidBoard }`, `export type { MermaidBoardProps, MermaidUser }`).
- `package.json` — add `@repo/diagram-board: workspace:*`; keep `mermaid`; drop the deps now owned by the shared core (monaco/y-monaco/hocuspocus/react-zoom-pan-pinch — keep any still referenced by remaining files).

**Deleted (moved to shared):** `monaco-env.ts`, `export.ts` (+test), `use-mermaid-yjs.ts`, `mermaid-board-inner.tsx`, `mermaid-preview.tsx`, `mermaid-source-editor.tsx`.

> **Regression guard:** the existing `mermaid-page.spec.ts` and `code-block.spec.ts` Mermaid cases are the proof this refactor is behaviour-preserving. Test-ids stay `mermaid-*` because `mermaidConfig.idPrefix === 'mermaid'`.

---

## 5. New package: `@repo/plantuml`

At `packages/plantuml`, same toolchain config as `@repo/mermaid`.

- `src/plantuml-language.ts` — `PLANTUML_LANGUAGE_ID = 'plantuml'` + `registerPlantumlLanguage(m)`; a small Monarch tokenizer (keywords: `@startuml`, `@enduml`, `participant`, `actor`, `class`, `interface`, `enum`, `package`, `namespace`, `note`, `activate`, `deactivate`, `alt`, `else`, `opt`, `loop`, `par`, `if`, `endif`, `start`, `stop`; arrows `->`, `-->`, `<-`, `<--`, `..>`, `--|>`; `'…'` strings; `'` line comments). Modelled on `mermaid-language.ts`.
- `src/render-plantuml.ts` — Monaco-free client renderer used by **both** the board and the editor:
  ```ts
  import type { RenderResult, ColorMode } from '@repo/diagram-board/render-types'
  export async function renderPlantuml(_id: string, source: string, _mode: ColorMode): Promise<RenderResult> {
    if (!source.trim()) return { ok: true, svg: '' }
    try {
      const res = await fetch('/api/plantuml/render', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source }),
      })
      const data = (await res.json()) as RenderResult
      return data
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  ```
  (`id`/`mode` are ignored — the server renders as-is. Empty source short-circuits with no network call, mirroring `renderMermaid`.)
- `src/plantuml-board.tsx` — `PlantumlBoard(props) => <DiagramBoard config={plantumlConfig} {...props} />` with `plantumlConfig = { docName:'plantuml', languageId: PLANTUML_LANGUAGE_ID, registerLanguage: registerPlantumlLanguage, render: renderPlantuml, idPrefix:'plantuml', placeholder:'@startuml\n\n@enduml' }`.
- `src/types.ts` — `export type { DiagramBoardProps as PlantumlBoardProps, DiagramUser as PlantumlUser } from '@repo/diagram-board'`.
- `src/index.ts` — `export { PlantumlBoard } from './plantuml-board'; export type { PlantumlBoardProps, PlantumlUser } from './types'`.
- `package.json` — deps: `@repo/diagram-board: workspace:*`, `monaco-editor` (type-only for the language module), `react`; `peerDependencies: next`. Exports: `.` (index), `./render-plantuml`, and the `./*` wildcard (so the editor can import `@repo/plantuml/render-plantuml`, exactly as it imports `@repo/mermaid/render-mermaid`).

---

## 6. PlantUML server (infra) — private, Gotenberg-style

### 6.1 `compose.yml` (local dev) — add service

```yaml
  plantuml:
    image: plantuml/plantuml-server:jetty
    container_name: anynote-plantuml
    environment:
      PLANTUML_SECURITY_PROFILE: SANDBOX   # most restrictive that still renders normal diagrams; blocks file/URL includes (SSRF/XXE). Confirm against the image's README during impl.
    ports:
      - "3002:8080"                        # host 3002 (grouped with Gotenberg's 3001) → container 8080
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
    restart: unless-stopped
```
> Confirm the jetty image ships `wget`/`curl`; if neither, fall back to a TCP healthcheck. Confirm the exact `PLANTUML_SECURITY_PROFILE` enum value (`SANDBOX` vs `SECURE`) against [plantuml-server README](https://github.com/plantuml/plantuml-server/blob/master/README.md) — pick the strictest that still renders standard diagrams.

### 6.2 `deploy/compose.yml` (production) — add service

Same image + `PLANTUML_SECURITY_PROFILE` + healthcheck + `restart: unless-stopped`, but **no `ports`** (internal compose network only). The web app reaches it at `http://plantuml:8080`. **No change to `deploy/traefik/`** — no router, no public hostname. Mirrors how Gotenberg is deployed (no port, no Traefik route).

### 6.3 Env vars (add in all three places per CLAUDE.md)

- `.env.example`:
  ```
  # PlantUML diagram rendering — internal HTTP service (keep private, no public route)
  PLANTUML_URL=http://localhost:3002
  PLANTUML_TIMEOUT_MS=15000
  ```
- `turbo.json` `globalEnv`: add `PLANTUML_TIMEOUT_MS`, `PLANTUML_URL`.
- `deploy/.env.template`: `PLANTUML_URL=${PLANTUML_URL}` (prod value `http://plantuml:8080`), `PLANTUML_TIMEOUT_MS=${PLANTUML_TIMEOUT_MS}`; add matching GitHub Secrets.
- `playwright.config.ts` `webServer.env`: pass `PLANTUML_URL` through so the test dev server can reach the container.

---

## 7. Render proxy (web, server-side) — Gotenberg-style

Mirrors `apps/web/src/server/page-export/{html-to-pdf,errors}.ts` + the export route.

### 7.1 `apps/web/src/server/plantuml/errors.ts`

`PlantumlTimeoutError`, `PlantumlUpstreamError(status, body)`, `PlantumlUnreachableError(reason)` — identical shape to the Gotenberg errors.

### 7.2 `apps/web/src/server/plantuml/render.ts`

```ts
export async function renderPlantumlSvg(source: string): Promise<string>
```
- Encode `source` with PlantUML's deflate+base64 scheme via the **`plantuml-encoder`** npm package (server-only dep of `apps/web`).
- `GET ${PLANTUML_URL}/svg/<encoded>` with `signal: AbortSignal.timeout(PLANTUML_TIMEOUT_MS ?? 15000)`.
- Network/abort → `PlantumlTimeoutError`/`PlantumlUnreachableError`.
- **Syntax errors:** the PlantUML server returns its own *error diagram* as an SVG (commonly HTTP 400 with an SVG body). Treat a response whose body is an SVG as success and **return that SVG** — the user sees PlantUML's rendered error, matching how Mermaid shows inline errors. Only non-SVG 4xx and all 5xx become `PlantumlUpstreamError`. (Confirm the exact status/`content-type` on bad input during impl.)
- Returns the SVG string.

### 7.3 `apps/web/src/app/api/plantuml/render/route.ts`

- `export const runtime = 'nodejs'`.
- `POST`: `getSession()` gate → **401** if unauthenticated (prevents the proxy from being an open SSRF relay). Zod-validate `{ source: z.string().min(1).max(20_000) }` (length cap bounds the encoded URL + limits abuse).
- Success → `Response.json({ ok: true, svg })`. `PlantumlTimeoutError` → 504, upstream/unreachable → 502, each as `{ ok: false, error }`. `Cache-Control: private, no-store`.
- `renderPlantuml` (client, §5) reads the JSON body as `RenderResult` regardless of status, so server errors surface inline in the preview.

---

## 8. PlantUML page type wiring

Every per-type touchpoint (traced from how `MERMAID` was added):

| # | File | Change |
|---|------|--------|
| 1 | [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) | add `PLANTUML` to `enum PageType` (after `MERMAID`) |
| 2 | new migration | `pnpm --filter @repo/db exec prisma migrate dev --name add_plantuml_page_type` → `ALTER TYPE "PageType" ADD VALUE 'PLANTUML';` |
| 3 | [apps/web/src/components/page/page-renderer.tsx](../../apps/web/src/components/page/page-renderer.tsx) | `const PlantumlBoard = dynamic(() => import('@repo/plantuml').then(m => m.PlantumlBoard), { ssr:false, loading: () => <CenteredSpinner/> })`; add `if (page.type === 'PLANTUML')` returning `<PlantumlBoard pageId={page.id} initialContentYjs={page.contentYjs} yjsUrl={resolveYjsUrl()} yjsToken={fetchYjsToken} user={user} />` (same props as the `MERMAID` case) |
| 4 | [apps/web/src/components/workspace/page-tree-section.tsx](../../apps/web/src/components/workspace/page-tree-section.tsx) | add `'PLANTUML'` to `CreatablePageType`; turn the «Диаграмма» `MenuItem` into a **submenu** (see §8.1) → MermaidJS / PlantUML |
| 5 | [apps/web/src/components/page/page-actions-toolbar.tsx](../../apps/web/src/components/page/page-actions-toolbar.tsx) | add `'PLANTUML'` to the page-type union (~L26-29) |
| 6 | [apps/web/src/components/page/page-actions-menu.tsx](../../apps/web/src/components/page/page-actions-menu.tsx) | add `'PLANTUML'` to the `pageType` prop type; behaves like other non-`TEXT` types (no outline/export — existing `=== 'TEXT'` guards already cover it) |
| 7 | [apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx](../../apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx) | add `'PLANTUML'` to the `isFullBleed` check (like `MERMAID`) |
| 8 | [packages/trpc/src/routers/page.ts](../../packages/trpc/src/routers/page.ts) | none required — `z.nativeEnum(PageType)` auto-validates; **no seeding** (mirror Mermaid). Empty source renders blank (no server call). |
| 9 | [apps/web/next.config.js](../../apps/web/next.config.js) | add `'@repo/diagram-board'` and `'@repo/plantuml'` to `transpilePackages` |

### 8.1 «Диаграмма» submenu

MUI core (v7 here) has **no native nested `MenuItem`**, so implement a child `Menu` with its own anchor:

- Replace the single «Диаграмма» `MenuItem` with a trigger `MenuItem` (icon `SchemaIcon`, trailing `ArrowRightIcon`) that on click/`onMouseEnter` opens a secondary `<Menu anchorEl={diagramAnchor} …>` containing two items:
  - **MermaidJS** → `onCreate('MERMAID')`
  - **PlantUML** → `onCreate('PLANTUML')`
- Selecting either child closes both menus. Keyboard: ArrowRight/Enter opens, ArrowLeft/Esc closes — the standard nested-menu affordance.
- Keep `onCreate(type)` as the existing callback (`createPage.mutate({ workspaceId, parentId, type })`).

> Acceptable simpler fallback if submenu interaction proves fiddly in E2E: a flat list with a «Диаграмма» `ListSubheader` over two sibling items. The submenu is preferred to match the request.

---

## 9. Editor «Код» block — PlantUML preview

[packages/editor/src/extensions/code-block.tsx](../../packages/editor/src/extensions/code-block.tsx):

- Import `renderPlantuml` from `@repo/plantuml/render-plantuml` (Monaco-free, like the existing `renderMermaid` import).
- `const language = node.attrs.language`; `const isMermaid = language === 'mermaid'`; `const isPlantuml = language === 'plantuml'`; `const isDiagram = isMermaid || isPlantuml`.
- Toggle UI + `showPreview` gate use `isDiagram` (was `isMermaid`). Default-view logic (`source.trim() ? 'preview' : 'code'`) unchanged — applies to both.
- In the render effect pick the renderer: `const render = isPlantuml ? renderPlantuml : renderMermaid`; call `render(renderId, source, mode)`. Both return `RenderResult`; existing ok/error handling is unchanged.
- Add `{ value: 'plantuml', label: 'PlantUML' }` to `CODE_LANGUAGES`.
- [packages/editor/package.json](../../packages/editor/package.json): add `@repo/plantuml: workspace:*`.

The slash item for `plantuml` already exists ([slash-items.ts](../../packages/editor/src/slash-items.ts)) — no change. In the editor (protected app) the same-origin session cookie authorizes `/api/plantuml/render`.

---

## 10. Testing strategy

**Unit (vitest):**
- `@repo/diagram-board`: `export.test.ts` (moved) + a `theme.test.ts` for `monacoThemeForMode`.
- `@repo/mermaid`: existing `render-mermaid` / `mermaid-language` tests stay green; trimmed `mermaid-theme.test.ts`.
- `@repo/plantuml`: `render-plantuml.test.ts` — mock `fetch`; assert empty-source short-circuit, `{ok:true,svg}` passthrough, error mapping.

**E2E (Playwright)** — requires the `plantuml` container (now in `compose.yml`; **CI must `docker compose up` it**, and `PLANTUML_URL` must reach the Playwright dev server, §6.3):
- **Update [apps/e2e/mermaid-page.spec.ts](../../apps/e2e/mermaid-page.spec.ts)** — create flow now opens the «Диаграмма» submenu then clicks **MermaidJS** (was a direct `getByRole('menuitem', { name: 'Диаграмма' })`).
- New `apps/e2e/plantuml-page.spec.ts` — «Диаграмма» → **PlantUML**; type `@startuml\nAlice->Bob: hi\n@enduml`; assert `[data-testid="plantuml-preview"] svg` appears; export-SVG button present.
- Extend [apps/e2e/code-block.spec.ts](../../apps/e2e/code-block.spec.ts) — slash «PlantUML» → type source → **Просмотр** → assert `.anynote-code-block__preview svg` renders; copy button present.

**Gates:** `pnpm gates` (check-types + lint `--max-warnings 0` + build + test) green. Critically: `pnpm --filter @repo/mermaid test` and the Mermaid E2E confirm the extraction is non-breaking.

---

## 11. Security notes

- **Proxy is auth-gated** (`getSession()` → 401) so it can't be used as an open SSRF relay.
- **PlantUML server is never publicly reachable** — internal compose network only, no Traefik route, restrictive `PLANTUML_SECURITY_PROFILE` (blocks `!include` of local files/URLs — the historical PlantUML XXE/SSRF surface).
- **Source length cap** (20 KB) on the proxy bounds encoded-URL length and abuse.
- `Cache-Control: private, no-store` on rendered output.

---

## 12. File-change checklist

**New — `packages/diagram-board/`:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `src/{index,monaco-env,theme,export,export.test,use-diagram-yjs,source-editor,diagram-preview,board-inner,board,render-types,types}.ts(x)`

**New — `packages/plantuml/`:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `vitest.config.ts`, `src/{index,plantuml-language,render-plantuml,render-plantuml.test,plantuml-board,types}.ts(x)`

**New — web proxy:** `apps/web/src/server/plantuml/{errors,render}.ts`, `apps/web/src/app/api/plantuml/render/route.ts`

**Changed — `@repo/mermaid`:** `package.json`, `index.ts` (unchanged content), `types.ts`, `mermaid-theme.ts` (+test), `mermaid-board.tsx`, `render-mermaid.ts`; **delete** `monaco-env.ts`, `export.ts`(+test), `use-mermaid-yjs.ts`, `mermaid-board-inner.tsx`, `mermaid-preview.tsx`, `mermaid-source-editor.tsx`

**Changed — web/db/editor:** `packages/db/prisma/schema.prisma` (+ migration), `apps/web/next.config.js`, `apps/web/src/components/workspace/page-tree-section.tsx`, `apps/web/src/components/page/{page-renderer,page-actions-toolbar,page-actions-menu}.tsx`, `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`, `apps/web/package.json` (+ `plantuml-encoder`), `packages/editor/src/extensions/code-block.tsx`, `packages/editor/package.json`

**Changed — infra/config:** `compose.yml`, `deploy/compose.yml`, `.env.example`, `turbo.json`, `deploy/.env.template`, `playwright.config.ts`, `pnpm-lock.yaml`

**Changed — E2E:** `apps/e2e/mermaid-page.spec.ts` (submenu), `apps/e2e/code-block.spec.ts` (plantuml); **new** `apps/e2e/plantuml-page.spec.ts`
