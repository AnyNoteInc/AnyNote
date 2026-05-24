# Draw.io page type + editor embed block — Design Spec

**Date:** 2026-05-24
**Status:** Draft, awaiting user review
**Branch:** `feat/drawio`

## Summary

Add **Draw.io** (diagrams.net) as a diagram surface in the two places the user asked for:

1. **Page creation** — the existing **«Холст»** entry in the create-page menu becomes a **submenu** offering **Excalidraw** (today's behaviour, unchanged) and **Draw.io** (a new `DRAWIO` `PageType`). A `DRAWIO` page renders a **full-width** draw.io editor whose source XML is collaboratively persisted via Yjs.
2. **Editor «Встраивание» block** — a brand-new slash group **«Встраивание»** with a **Draw.io** item. Inserting it opens a **full-screen editor modal** (draw.io iframe + our own top-right **Отмена / Сохранить** toolbar). On **Сохранить** the diagram is rendered into an inline node (an SVG image). **Single-click** the node → a full-screen **viewer** modal (image). **Double-click** → the **editor** modal again (Сохранить / Отмена).

Both surfaces embed draw.io through **[`react-drawio`](https://github.com/marcveens/react-drawio)** (`<DrawIoEmbed>`), which wraps the official `embed=1&proto=json` iframe protocol. The iframe app is loaded from a **configurable** `NEXT_PUBLIC_DRAWIO_URL` (default `https://embed.diagrams.net`); diagram data never leaves the browser (it is exchanged with the iframe via `postMessage`), and the URL can later be pointed at a self-hosted `jgraph/drawio` container by setting one env var.

**Key difference from Mermaid/PlantUML/LikeC4:** draw.io is a complete GUI editor delivered as a black-box iframe. There is **no Monaco source editor**, so this does **not** use `@repo/diagram-board`. The diagram's source is **mxGraph XML** (not a human-authored text language), and the editor cannot real-time-merge concurrent edits — so the page's collaboration model is **last-writer-wins**: XML lives in a `Y.Text`, loaded into the iframe on mount and reloaded when a remote peer saves.

---

## 1. Goals & Non-goals

### Goals

- A new `DRAWIO` `PageType` created from **«Холст» → Draw.io**, rendering a full-bleed draw.io editor.
- The page autosaves its XML to a `Y.Text('drawio')`; remote saves reload the open iframe (last-writer-wins).
- A new **«Встраивание»** slash group with a **Draw.io** item that opens a full-screen editor modal with our own **Отмена / Сохранить** toolbar at the top-right.
- A `drawio` inline editor node storing `xml` (mxGraph source) + `svg` (rendered preview, data-URL) **inline as node attributes** (Yjs-synced like every other node).
- Node interactions exactly as specified: **single-click → viewer modal (image)**, **double-click → editor modal**, move/delete via the editor's existing block drag-handle.
- One configurable `NEXT_PUBLIC_DRAWIO_URL` (default `https://embed.diagrams.net`), threaded as a prop — never read from `process.env` inside a workspace package (mirrors `resolveYjsUrl()`).

### Non-goals

- **No self-hosted draw.io container in v1.** We ship pointing at `embed.diagrams.net` behind the env var; adding a `jgraph/drawio` service to `compose.yml` + Traefik is a documented follow-up, enabled by flipping the env.
- **No real-time co-editing inside a diagram.** draw.io's embed iframe is opaque; the page is last-writer-wins (not CRDT-merged like Excalidraw). Stated, accepted.
- **No S3 upload for the editor node.** Per the chosen design, the node stores XML + SVG inline (same bloat caveat as Excalidraw images today).
- **No change to `@repo/diagram-board`, Mermaid, PlantUML, or LikeC4.** draw.io is a separate surface.
- **No PNG export.** Preview is **SVG** (crisp, scalable, native `xmlsvg` export). PNG is a possible follow-up.
- **No standalone draw.io page toolbar** (export/print buttons). The iframe provides its own chrome; the page is just the editor.

---

## 2. Architecture overview

```
PAGE TYPE (DRAWIO)
  page-tree-section.tsx   «Холст» submenu → Excalidraw | Draw.io
  page-renderer.tsx       type==='DRAWIO' → <DrawioBoard pageId initialContentYjs
                                              yjsUrl yjsToken user drawioUrl/>
        │
        ▼
  @repo/drawio  DrawioBoard → (next/dynamic, ssr:false) DrawioBoardInner
      ├─ useDrawioYjs(pageId, yjsUrl, yjsToken, initialContentYjs) → { ydoc, provider, ytext }
      └─ <DrawIoEmbed baseUrl={drawioUrl} autosave xml={initialXml}
             onAutoSave=(xml ⇒ write Y.Text, debounced)
             ytext.observe(remote ⇒ drawioRef.load({xml}))   ← last-writer-wins reload

EDITOR «Встраивание» BLOCK
  slash-items.ts     new group 'embedding' → { id:'drawio' } → handlers.openDrawioCreate(range)
  anynote-editor.tsx hosts the CREATE editor modal; on save inserts node at range
  drawio.schema.ts   node 'drawio' (block, atom, draggable): attrs { xml, svg }
  drawio.tsx         NodeView: <img src={svg}>  +  single-click → DrawioViewerDialog
                                                 +  double-click → DrawioEditorDialog
        │
        ├─ DrawioEditorDialog  (fullScreen): toolbar [Отмена | Сохранить] + <DrawIoEmbed>
        │     Сохранить ⇒ exportDiagram({format:'xmlsvg'}) ⇒ onExport(dataURL) ⇒ {xml, svg}
        └─ DrawioViewerDialog  (fullScreen): read-only <img src={svg}>
```

`react-drawio` is a plain npm dependency (compiled JS), so it needs **no** `transpilePackages` entry. The new `@repo/drawio` workspace package **does**. All draw.io chrome loads only on a `DRAWIO` page or when a Draw.io block's modal is open.

---

## 3. Shared plumbing: `react-drawio` + `NEXT_PUBLIC_DRAWIO_URL`

### 3.1 `react-drawio` API (confirmed against the v1.0.x README)

`<DrawIoEmbed>` props/refs we rely on:

- `baseUrl` (default `https://embed.diagrams.net`) — the iframe origin.
- `xml` — initial diagram XML to prefill.
- `autosave` (bool) — when `true`, fires `onAutoSave` on every change.
- `exportFormat` — `'xmlsvg'` (default) emits an **SVG with the mxGraph XML embedded**; this is what we store as the preview.
- `urlParameters` — `{ ui, spin, libraries, saveAndExit, noSaveBtn, noExitBtn }`.
- Callbacks: `onLoad`, `onAutoSave`, `onSave`, `onExport` (payload exposes the data-URL string as `data.data`), `onClose`.
- Ref (`DrawIoEmbedRef`): `load({ xml })`, `exportDiagram({ format })`, `merge`, `configure`.

> **To confirm during implementation** (README does not pin exact event field names): the property holding XML on the `onAutoSave` / `onSave` event object (assumed `event.xml`) and that `onExport` yields the data-URL at `event.data`. The example in the README is `onExport={(data) => setImg(data.data)}`. Adjust field access in one place (`DrawioEditorDialog`) if the installed types differ; the architecture is unaffected.

### 3.2 URL config

- New env var **`NEXT_PUBLIC_DRAWIO_URL`**, default `https://embed.diagrams.net`.
- Added to **both** [`.env.example`](../../.env.example) and [`turbo.json`](../../turbo.json) `globalEnv` (per CLAUDE.md — every env var consumed by a cached task must be mirrored or builds go stale).
- New helper `resolveDrawioUrl()` in `apps/web` (alongside `resolveYjsUrl()`): returns `process.env.NEXT_PUBLIC_DRAWIO_URL ?? 'https://embed.diagrams.net'`.
- `apps/web` passes the resolved string as a `drawioUrl` prop to **both** `DrawioBoard` and `AnyNoteEditor`. Packages never read `process.env` directly.

---

## 4. New package: `@repo/drawio` (page type)

At `packages/drawio`, same toolchain config as `@repo/excalidraw` (`moduleResolution: "Bundler"`, extensionless relative imports, consumed raw by Next via `transpilePackages`). Mirror its `tsconfig.json` and `eslint.config.mjs`. Two-file SSR pattern.

### 4.1 Files

| File | Purpose |
|------|---------|
| `src/index.ts` | `export { DrawioBoard } from './board'`; `export type { DrawioBoardProps } from './types'` |
| `src/types.ts` | `DrawioBoardProps` = `{ pageId; yjsUrl; yjsToken: () => Promise<string>; initialContentYjs?: string \| null; drawioUrl: string; user?: {...}; editable?: boolean }` |
| `src/board.tsx` | `'use client'` — `next/dynamic(() => import('./board-inner'), { ssr:false })` wrapper |
| `src/board-inner.tsx` | the editor + Yjs glue (§4.3) |
| `src/use-drawio-yjs.ts` | `useDrawioYjs(...)` → `{ ydoc, provider, ytext }`, mirroring `@repo/diagram-board`'s `useDiagramYjs` with `docName='drawio'` |

### 4.2 `use-drawio-yjs.ts`

Identical shape to `@repo/diagram-board/use-diagram-yjs.ts`: new `Y.Doc` per mount, decode `initialContentYjs` (base64 → `Y.applyUpdate`), `ytext = ydoc.getText('drawio')`, `HocuspocusProvider({ url: yjsUrl, name: pageId, document: ydoc, token: yjsToken })`, deferred destroy (`setTimeout(..., 300)`).

### 4.3 `board-inner.tsx` — XML ⇄ Yjs sync (last-writer-wins)

```tsx
'use client'
const res = useDrawioYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })
const drawioRef = useRef<DrawIoEmbedRef>(null)
const initialXml = useMemo(() => res?.ytext.toString() ?? '', [res])   // read once for mount

// remote saves → reload the iframe (skip our own local writes)
useEffect(() => {
  if (!res) return
  const onChange = (_e, tx) => {
    if (tx.local) return                 // our own autosave write — ignore
    drawioRef.current?.load({ xml: res.ytext.toString() })
  }
  res.ytext.observe(onChange)
  return () => res.ytext.unobserve(onChange)
}, [res])

const writeXml = useDebouncedCallback((xml: string) => {
  res!.ydoc.transact(() => {            // local tx → observer above skips it
    res!.ytext.delete(0, res!.ytext.length)
    res!.ytext.insert(0, xml)
  })
}, 600)

<DrawIoEmbed
  ref={drawioRef}
  baseUrl={drawioUrl}
  autosave
  xml={initialXml}
  urlParameters={{ spin: true, ui: mode === 'dark' ? 'dark' : 'kennedy' }}
  onAutoSave={(e) => writeXml(e.xml)}
/>
```

- **Reload guard:** `transaction.local` distinguishes our own debounced write from a remote peer's, preventing a reload loop. Only remote changes call `load()`.
- The board fills its container (full-bleed page); the iframe is `width/height: 100%`.
- Empty page → empty `Y.Text` → blank canvas (draw.io shows its template/empty state).

---

## 5. `DRAWIO` page-type wiring

Standard per-type touchpoints (mirroring how `LIKEC4`/`PLANTUML` were added — implementer should confirm each still matches on `main`):

| # | File | Change |
|---|------|--------|
| 1 | [packages/db/prisma/schema.prisma](../../packages/db/prisma/schema.prisma) | add `DRAWIO` to `enum PageType` |
| 2 | new migration | `pnpm --filter @repo/db exec prisma migrate dev --name add_drawio_page_type` → `ALTER TYPE "PageType" ADD VALUE 'DRAWIO';` |
| 3 | [apps/web/src/components/page/page-renderer.tsx](../../apps/web/src/components/page/page-renderer.tsx) | `const DrawioBoard = dynamic(() => import('@repo/drawio').then((m) => m.DrawioBoard), { ssr:false, loading: () => <CenteredSpinner/> })`; add `if (page.type === 'DRAWIO')` returning `<DrawioBoard pageId={page.id} initialContentYjs={page.contentYjs} yjsUrl={resolveYjsUrl()} yjsToken={fetchYjsToken} user={user} drawioUrl={resolveDrawioUrl()} />` |
| 4 | [apps/web/src/components/workspace/page-tree-section.tsx](../../apps/web/src/components/workspace/page-tree-section.tsx) | add `'DRAWIO'` to `CreatablePageType`; convert «Холст» to a submenu (§6) |
| 5 | [apps/web/src/components/page/page-actions-toolbar.tsx](../../apps/web/src/components/page/page-actions-toolbar.tsx) | add `'DRAWIO'` to the page-type union |
| 6 | [apps/web/src/components/page/page-actions-menu.tsx](../../apps/web/src/components/page/page-actions-menu.tsx) | add `'DRAWIO'` to the `pageType` prop union (existing `=== 'TEXT'` guards already gate outline/export) |
| 7 | [apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx](../../apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx) | add `page.type === 'DRAWIO'` to the `isFullBleed` check (alongside `EXCALIDRAW`/`MERMAID`/…) |
| 8 | [packages/trpc/src/routers/page.ts](../../packages/trpc/src/routers/page.ts) | none — `z.nativeEnum(PageType)` auto-validates; no seeding |
| 9 | [apps/web/next.config.js](../../apps/web/next.config.js) | add `'@repo/drawio'` to `transpilePackages` |
| 10 | [apps/web/package.json](../../apps/web/package.json) | add `"@repo/drawio": "workspace:*"` |
| 11 | [apps/web/src/lib](../../apps/web/src/lib) | add `resolveDrawioUrl()` (next to `resolveYjsUrl()`) |

---

## 6. Sidebar: «Холст» submenu

In [page-tree-section.tsx](../../apps/web/src/components/workspace/page-tree-section.tsx), the «Холст» `MenuItem` (currently fires `onCreate('EXCALIDRAW')` directly) becomes a nested submenu — **identical mechanism** to the existing `DiagramSubmenu` (`anchorEl` state, child `Menu`, `anchorOrigin={{vertical:'top',horizontal:'right'}}`):

```
Холст ▸ (BrushIcon)
   ├─ Excalidraw   → choose('EXCALIDRAW')   (BrushIcon)
   └─ Draw.io      → choose('DRAWIO')        (SchemaIcon / PolylineIcon)
```

- Add `'DRAWIO'` to the `CreatablePageType` union.
- New `HolstSubmenu` component (copy of `DiagramSubmenu`), rendered where the «Холст» item is today.
- `page.create` is unchanged (already accepts any `PageType`); success still routes to `/workspaces/{id}/pages/{newId}`.

---

## 7. Editor «Встраивание» → Draw.io block

### 7.1 Slash group + item

- [packages/editor/src/types.ts](../../packages/editor/src/types.ts): add `'embedding'` to `SlashCommandGroup`.
- [packages/editor/src/components/slash-menu-popover.tsx](../../packages/editor/src/components/slash-menu-popover.tsx): add `'embedding'` to `GROUP_ORDER` (after `'media'`) and `GROUP_TITLES` (`embedding: 'Встраивание'`).
- [packages/editor/src/slash-items.ts](../../packages/editor/src/slash-items.ts): extend `SlashMediaHandlers` with `openDrawioCreate: (range: SlashRange) => void`; add the item:

```ts
{
  id: 'drawio',
  group: 'embedding',
  label: 'Draw.io',
  description: 'Встроить диаграмму draw.io',
  keywords: ['drawio', 'diagram', 'диаграмма', 'схема', 'embed', 'встраивание'],
  icon: createElement(SchemaIcon),       // add an icon export to ./assets if missing
  run: ({ range }) => handlers.openDrawioCreate(range),
}
```

### 7.2 Node: `drawio.schema.ts` + `drawio.tsx`

Modelled on `file-attachment` (block atom, draggable).

`drawio.schema.ts`:
- `name: 'drawio'`, `group: 'block'`, `atom: true`, `selectable: true`, `draggable: true`.
- Attributes (both persisted as `data-*` and JSON-safe strings):
  - `xml: { default: '' }` — mxGraph source (re-editable).
  - `svg: { default: '' }` — rendered preview as a `data:image/svg+xml…` URL (drawn via `<img>`).
- `parseHTML`: `div[data-type="drawio"]` → read `data-xml` / `data-svg`.
- `renderHTML`: `div` with `data-type="drawio"`, `data-xml`, `data-svg`.

`drawio.tsx` (`ReactNodeViewRenderer(DrawioView)`):
- `addOptions()` → `{ drawioUrl: '' }`; registered as `Drawio.configure({ drawioUrl: opts.drawioUrl })`.
- Renders `<NodeViewWrapper as="div" data-type="drawio" data-drag-handle="" contentEditable={false}>` containing `<img src={node.attrs.svg} …>` (or an "empty diagram" placeholder if `svg` is blank).
- **Click disambiguation** (avoids the viewer flashing on the first click of a double-click):

```ts
const timer = useRef<ReturnType<typeof setTimeout>>()
const onClick = () => { timer.current = setTimeout(() => setView('viewer'), 250) }
const onDoubleClick = () => { clearTimeout(timer.current); setView('editor') }
useEffect(() => () => clearTimeout(timer.current), [])
```

- Hosts `DrawioViewerDialog` (view) and `DrawioEditorDialog` (edit, preloaded with `node.attrs.xml`); on editor save → `updateAttributes({ xml, svg })`.
- Move/delete: handled by the editor's existing block **drag-handle** (the node is `draggable` + carries `data-drag-handle`), so single-click can be reserved for the viewer.

### 7.3 Dialogs (shared, in `packages/editor/src/components/`)

Both are full-screen MUI `Dialog fullScreen` (matching `BlockMoveDialog`'s `@repo/ui` usage).

**`DrawioEditorDialog`** — props `{ open; initialXml; drawioUrl; onSave(xml, svg); onCancel() }`:
- Top **toolbar** (`AppBar`/`Toolbar`, or a flex `Box`) with title left, **Отмена** + **Сохранить** buttons pinned **top-right**.
- Body: `<DrawIoEmbed ref baseUrl={drawioUrl} autosave xml={initialXml} exportFormat="xmlsvg" urlParameters={{ spin:true, noSaveBtn:true, noExitBtn:true }} onAutoSave={e => latestXml.current = e.xml} />` (drawio's own save/exit chrome hidden — **our** toolbar drives it).
- **Сохранить** flow: `drawioRef.current.exportDiagram({ format: 'xmlsvg' })` → in `onExport`, call `onSave(latestXml.current || initialXml, e.data)` then the parent closes. (`xmlsvg` data-URL is both the preview image and carries the XML; we still keep plain `xml` from autosave for clean re-loading.)
- **Отмена** → `onCancel()` (no mutation; on create, inserts nothing).

**`DrawioViewerDialog`** — props `{ open; svg; onClose() }`: full-screen, a centered `<img src={svg}>` with object-fit contain, a close button top-right. Read-only.

### 7.4 Create flow (slash) — editor-level host

`AnyNoteEditor` ([anynote-editor.tsx](../../packages/editor/src/anynote-editor.tsx)) gains a new `drawioUrl` prop and a small piece of state for the **create** dialog (the node doesn't exist yet):

- `openDrawioCreate(range)` (passed into `createSlashItems` handlers) stores the `range` and opens a `DrawioEditorDialog` with `initialXml=''`.
- On **Сохранить**: `editor.chain().focus().deleteRange(range).insertContent({ type:'drawio', attrs:{ xml, svg } }).run()`, then close.
- On **Отмена**: close, insert nothing.
- `drawioUrl` flows `AnyNoteEditor` → `buildExtensions({ …, drawioUrl })` → `Drawio.configure({ drawioUrl })` (for edit/view dialogs inside NodeViews) **and** into the editor-level create dialog.

### 7.5 Registration

- [packages/editor/src/extensions/index.ts](../../packages/editor/src/extensions/index.ts): add `Drawio.configure({ drawioUrl: opts.drawioUrl })` to the extensions array; add `drawioUrl` to `BuildExtensionsOptions`.
- [packages/editor/package.json](../../packages/editor/package.json): add `"react-drawio": "^1.0.7"`.
- [apps/web/src/components/page/page-renderer.tsx](../../apps/web/src/components/page/page-renderer.tsx): pass `drawioUrl={resolveDrawioUrl()}` to `<AnyNoteEditor>` (TEXT branch).

---

## 8. Data model summary

| Surface | Where the XML lives | Where the image lives | Sync |
|---|---|---|---|
| `DRAWIO` page | `Y.Text('drawio')` in `Page.contentYjs` | — (live iframe) | Yjs, last-writer-wins (autosave→`Y.Text`, remote→`load()`) |
| Editor `drawio` node | `xml` node attribute | `svg` node attribute (data-URL) | Yjs (ProseMirror node attrs via Collaboration), like every node |

No DB columns beyond the `PageType` enum value. No tRPC changes. No S3.

---

## 9. Testing strategy

The draw.io editor is a **third-party iframe**; tests must not depend on its internals or (ideally) on reaching `embed.diagrams.net` from CI. Assertions target **our** chrome.

**Unit (vitest):**
- `@repo/drawio`: the XML⇄`Y.Text` reducer — a local write sets `Y.Text`; a simulated remote (`tx.local === false`) change triggers `load`; a local write does **not**. (Mock `DrawIoEmbedRef`.)
- `packages/editor`: the save reducer (`exportDiagram` result + latest XML → node attrs); the click/double-click disambiguation (single → viewer, double → editor, no viewer flash).

**E2E (Playwright):**
- **«Холст» → Draw.io** creates a `DRAWIO` page; assert the route + the `<iframe>` whose `src` starts with the configured base URL mounts inside the full-bleed container. (Do **not** assert drawing inside the canvas.)
- **«Встраивание» → Draw.io** slash item opens `DrawioEditorDialog`; assert the **Отмена / Сохранить** toolbar + the embed `<iframe>`; **Отмена** closes with no node inserted.
- A persisted node (seed `attrs.svg` directly via an inserted node) renders an `<img>`; **single-click** opens the viewer dialog, **double-click** opens the editor dialog.

> **External-iframe caveat:** asserting the *post-save rendered SVG* requires the embed iframe to load and answer `postMessage` — which needs network to `embed.diagrams.net` and is flaky in CI. v1 verifies the save→render path **manually** + via the unit reducer test. A deterministic E2E for it is a documented follow-up: serve a **minimal local draw.io stub** during Playwright and set `NEXT_PUBLIC_DRAWIO_URL` to it (the stub implements just `init`/`load`/`export` of the JSON protocol).

**Gates:** `pnpm gates` green (check-types + lint `--max-warnings 0` + build + test). Confirm `next build` succeeds with `react-drawio` bundled into `@repo/editor` and `@repo/drawio`.

---

## 10. Risks / things to verify during implementation

- **`react-drawio` event field names** (§3.1) — confirm `onAutoSave`/`onSave` expose `.xml` and `onExport` exposes `.data`. Localised to `DrawioEditorDialog` + `board-inner`; adjust if the installed types differ.
- **CI network to `embed.diagrams.net`** — the embed won't load offline/air-gapped. Tests are scoped to avoid depending on it (§9). Functionally, an air-gapped deployment must set `NEXT_PUBLIC_DRAWIO_URL` to a self-hosted instance — call this out in README/`.env.example`.
- **`next build` + `react-drawio`** — it ships ESM/CJS; verify it bundles under Turbopack (dev) and webpack (build) when imported from transpiled workspace packages. (`@repo/editor` already pulls many browser-only deps; pattern is proven.)
- **Inline SVG size in the snapshot** — `svg` data-URLs live in both `Page.contentYjs` (Yjs) and the `Page.content` JSON snapshot; large diagrams grow both (accepted inline trade-off, same class as the Excalidraw images note). If it becomes a problem, the S3 variant (rejected for v1) is the escape hatch.
- **`xmlsvg` round-trip** — verify draw.io re-opens a node from its stored plain `xml` cleanly; if the plain XML from autosave proves lossy, fall back to extracting the embedded XML from the stored `xmlsvg`.
- **`<img>`-rendered SVG** — rendering the preview via `<img src=dataURL>` (not raw injection) sandboxes the SVG (no script execution / XSS) and gives intrinsic sizing; keep it an `<img>`, not `dangerouslySetInnerHTML`.
- **Light/dark** — pass `urlParameters.ui` from the site theme; the diagram itself follows the user's drawio styling. Re-load on theme change is **not** required (avoid disrupting an open editor).

---

## 11. File-change checklist

**New — `packages/drawio/`:** `package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/{index.ts, types.ts, board.tsx, board-inner.tsx, use-drawio-yjs.ts}`

**New — editor:** `packages/editor/src/extensions/{drawio.schema.ts, drawio.tsx}`, `packages/editor/src/components/{drawio-editor-dialog.tsx, drawio-viewer-dialog.tsx}`

**Changed — editor:** `packages/editor/src/types.ts` (`'embedding'` group), `src/components/slash-menu-popover.tsx` (group order/title), `src/slash-items.ts` (handler + item), `src/anynote-editor.tsx` (`drawioUrl` prop + create dialog host), `src/extensions/index.ts` (register + option), `package.json` (`react-drawio`), and an icon export in `src/assets/` if needed.

**Changed — web/db:** `packages/db/prisma/schema.prisma` (+ migration), `apps/web/next.config.js`, `apps/web/package.json`, `apps/web/src/lib` (`resolveDrawioUrl`), `apps/web/src/components/workspace/page-tree-section.tsx`, `apps/web/src/components/page/{page-renderer,page-actions-toolbar,page-actions-menu}.tsx`, `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`

**Changed — config:** `.env.example`, `turbo.json` (`globalEnv: NEXT_PUBLIC_DRAWIO_URL`)

**Changed — lockfile:** `pnpm-lock.yaml`

**Changed — E2E:** new `apps/e2e/drawio-page.spec.ts` (+ a Draw.io case in the slash-block spec)
