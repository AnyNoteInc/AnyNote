# Tiptap Code Block: «Код» slash group + Mermaid preview toggle — Design Spec

**Date:** 2026-05-22
**Status:** Draft, awaiting user review
**Scope:** Reorganize the editor slash menu into a dedicated **«Код»** group offering Code / Mermaid / PlantUML / d2 blocks, and give the **Mermaid** code block an in-place *Code ↔ Preview* toggle (with client-side rendering) plus the existing copy button. PlantUML and d2 are inserted as syntax-highlighted code blocks (copy button, no rendering yet).

This builds on the current `CodeBlock` extension (`CodeBlockLowlight` + a React node view with a copy button) added in `fix(editor): restore code block syntax highlighting + add copy button`.

---

## 1. Goals & Non-goals

### Goals

- A **«Код»** section in the slash menu (alongside «Базовые блоки» / «Медиа») with four items: **Код**, **Mermaid**, **PlantUML**, **d2**. Each inserts a fenced code block with the matching `language` attribute.
- The **Mermaid** code block renders its diagram in place: a toolbar toggle switches between **Код** (editable source) and **Просмотр** (rendered SVG). Diagram theme follows the site light/dark mode. Invalid syntax shows a non-blocking error.
- Every code block keeps the **copy** button (already implemented).
- Mermaid rendering is **client-side / offline** — reuse `@repo/mermaid`'s `renderMermaid` (no new infra, no Monaco pulled into the editor bundle).

### Non-goals (this spec)

- Rendering PlantUML or d2. They are plain (syntax-highlighted) code blocks with a copy button for now; visualization is a future enhancement (would need a renderer such as a self-hosted Kroki service or a d2 WASM bundle).
- A language-picker dropdown inside the code block. Language is set by the slash item; lowlight still auto-detects for plain blocks.
- Persisting the per-block view mode (Код/Просмотр). It is local UI state, defaulting to **Код** on mount.
- Changing how code blocks serialize/persist. The node name stays `codeBlock`; only the in-editor node view changes, so `Page.content`/server serialization is unaffected.

---

## 2. Architecture Overview

```
Slash menu (packages/editor)
  groups: base → code → media                         ← NEW 'code' group
    code: [ Код, Mermaid, PlantUML, d2 ]              ← each: setCodeBlock({ language })

CodeBlock extension (extends CodeBlockLowlight)
  └─ ReactNodeViewRenderer(CodeBlockView)
       node.attrs.language === 'mermaid'
         → toolbar [ Код | Просмотр ] + copy
            Код:      <pre><NodeViewContent as="code"/></pre>      (editable, shown)
            Просмотр: <pre> hidden (display:none, stays mounted)
                      + <div contentEditable=false> SVG | error </div>
            render via renderMermaid(id, source, palette.mode)     ← @repo/mermaid/render
       else (plain | plantuml | d2)
         → <pre><NodeViewContent as="code"/></pre> + copy           (current behavior)
```

**Key invariant (ProseMirror):** the editable `NodeViewContent` (the `<code>` contentDOM) must stay mounted in every view mode. In **Просмотр** it is hidden with `display:none`; the SVG is rendered in a sibling `contentEditable={false}` element. Unmounting `NodeViewContent` would detach ProseMirror's contentDOM and break editing/serialization.

---

## 3. Slash menu — «Код» group

- [`packages/editor/src/types.ts`](../../packages/editor/src/types.ts): extend the union to `export type SlashCommandGroup = 'base' | 'code' | 'media'`.
- [`packages/editor/src/components/slash-menu-popover.tsx`](../../packages/editor/src/components/slash-menu-popover.tsx): `GROUP_ORDER = ['base', 'code', 'media']`; `GROUP_TITLES.code = 'Код'`.
- [`packages/editor/src/slash-items.ts`](../../packages/editor/src/slash-items.ts):
  - Move the existing **Код** item (`id: 'code'`, `toggleCodeBlock()`) from `group: 'base'` to `group: 'code'`.
  - Add three items in `group: 'code'`, all using the custom `CodeIcon`:
    - `mermaid` — label «Mermaid», keywords `['mermaid','diagram','диаграмма','схема']`, `run: setCodeBlock({ language: 'mermaid' })`.
    - `plantuml` — label «PlantUML», keywords `['plantuml','uml','диаграмма']`, `run: setCodeBlock({ language: 'plantuml' })`.
    - `d2` — label «d2», keywords `['d2','diagram','диаграмма']`, `run: setCodeBlock({ language: 'd2' })`.
  - All four use `editor.chain().focus().deleteRange(range).setCodeBlock({ language }).run()` (plain «Код» uses `toggleCodeBlock()` to preserve current toggle-off behavior). Using `setCodeBlock` keeps the cursor inside the new block (a previously fixed bug).

---

## 4. Mermaid rendering reuse — `@repo/mermaid/render`

- Add a Monaco-free subpath export to [`packages/mermaid/package.json`](../../packages/mermaid/package.json):
  ```jsonc
  "./render": {
    "types": "./src/render-mermaid.ts",
    "import": "./src/render-mermaid.ts",
    "default": "./src/render-mermaid.ts"
  }
  ```
  `src/render-mermaid.ts` imports only `mermaid` + `./mermaid-theme` (no Monaco), so the editor bundle stays Monaco-free. It already exports `renderMermaid(id, source, mode): Promise<RenderResult>` and `RenderResult`.
- [`packages/editor/package.json`](../../packages/editor/package.json): add `"@repo/mermaid": "workspace:*"`. (`@repo/mermaid` is already in `apps/web` `transpilePackages`.) `mermaid` itself is pulled transitively through the subpath; no direct `mermaid` dep needed in the editor.
- **Fallback** (only if the cross-package subpath import causes a build/transpile problem): add `mermaid` directly to `@repo/editor` and a ~15-line local `renderMermaidInline` mirroring `render-mermaid.ts`. Prefer the reuse path.

---

## 5. Code block node view — `code-block.tsx`

[`packages/editor/src/extensions/code-block.tsx`](../../packages/editor/src/extensions/code-block.tsx) (`CodeBlockView`):

- `const language = node.attrs.language as string | null`.
- Copy button: unchanged (top-right), present in all modes.
- **Plain / plantuml / d2** (`language !== 'mermaid'`): current markup — `<pre><NodeViewContent<'code'> as="code" /></pre>` + copy button.
- **Mermaid** (`language === 'mermaid'`):
  - `const [view, setView] = useState<'code' | 'preview'>('code')`.
  - Toolbar (top-right, `contentEditable={false}`): a 2-segment toggle **Код | Просмотр** + the copy `IconButton`.
  - Always render `<pre style={{ display: view === 'code' ? undefined : 'none' }}><NodeViewContent<'code'> as="code" /></pre>` (stays mounted).
  - When `view === 'preview'`: a `contentEditable={false}` `<div className="anynote-code-block__preview">` showing the rendered SVG (via `dangerouslySetInnerHTML` from `renderMermaid`) or an error panel.
  - Rendering:
    ```ts
    const mode = useTheme().palette.mode               // 'light' | 'dark'
    const [svg, setSvg] = useState('')
    const [error, setError] = useState<string | null>(null)
    const idRef = useRef(`cb-mermaid-${Math.random().toString(36).slice(2)}`)
    useEffect(() => {
      if (language !== 'mermaid' || view !== 'preview') return
      let cancelled = false
      void renderMermaid(idRef.current, node.textContent, mode).then((r) => {
        if (cancelled) return
        if (r.ok) { setSvg(r.svg); setError(null) } else setError(r.error)
      })
      return () => { cancelled = true }
    }, [language, view, node.textContent, mode])
    ```
  - Empty source in preview → render nothing (renderMermaid returns `{ ok: true, svg: '' }`).

---

## 6. Styles — `content.css`

[`packages/editor/src/styles/content.css`](../../packages/editor/src/styles/content.css), after the existing `.anynote-code-block` / `.hljs-*` rules:

- `.anynote-code-block__toolbar` — absolute top-right, `display:flex; gap`, `contentEditable:false`. For a **mermaid** block it holds the Код/Просмотр toggle **and** the copy button; for other languages there is no toolbar — the standalone copy button stays as today. Subtle background, reveal/raise opacity on hover like the copy button.
- `.anynote-code-block__toggle` — the two-segment Код/Просмотр control (MUI `ToggleButtonGroup size="small"` is acceptable; styling minimal).
- `.anynote-code-block__preview` — `padding`, `display:flex; justify-content:center`, `overflow:auto`, `& svg { max-width:100% }`. Light/dark handled by mermaid's own theme (already mode-driven).
- `.anynote-code-block__error` — `error.main` background, monospace caption, wraps.

The toggle/copy controls use MUI components with `sx` for positioning (parent-hover reveal via `.anynote-code-block:hover &`), consistent with the current copy button.

---

## 7. Testing strategy

- **E2E (Playwright)** — extend [`apps/e2e/code-block.spec.ts`](../../apps/e2e/code-block.spec.ts):
  - *Existing test stays:* plain «Код» → python → `.hljs-keyword` visible + copy button visible.
  - *New:* slash → «Mermaid» (in the «Код» group) → type `graph TD; A-->B;` → click **Просмотр** → assert `.anynote-code-block__preview svg` visible; copy button present.
  - *New:* slash menu shows the «Код» group with Mermaid / PlantUML / d2 items.
- **Unit (vitest):** `@repo/mermaid`'s `render-mermaid` test already covers the renderer. If the language→behavior split is extracted to a pure helper, add a small test; otherwise the node view is covered by E2E.
- **Gates:** `pnpm check-types`, `pnpm lint` (`--max-warnings 0`), `pnpm build`, `pnpm --filter @repo/editor test` all green. `pnpm --filter @repo/mermaid test` green (subpath export must not break its build).

---

## 8. File-change checklist

**Changed:**
- `packages/editor/src/types.ts` — `'code'` in `SlashCommandGroup`
- `packages/editor/src/components/slash-menu-popover.tsx` — group order + «Код» title
- `packages/editor/src/slash-items.ts` — move «Код», add Mermaid / PlantUML / d2
- `packages/editor/src/extensions/code-block.tsx` — language-aware node view (mermaid toggle + render)
- `packages/editor/package.json` — `@repo/mermaid: workspace:*`
- `packages/mermaid/package.json` — `./render` subpath export
- `packages/editor/src/styles/content.css` — toolbar / toggle / preview / error styles
- `apps/e2e/code-block.spec.ts` — Mermaid preview-toggle test + «Код» group assertion
- `pnpm-lock.yaml` — workspace dependency sync
