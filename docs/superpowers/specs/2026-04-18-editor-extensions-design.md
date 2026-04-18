# Editor Extensions — Toggle, HiddenText, Block Menu, Page Actions

**Date:** 2026-04-18
**Status:** Approved for implementation

## Scope

Six editor/page enhancements:

1. Fix Excalidraw canvas background not following MUI dark theme.
2. Block drag-handle menu: convert-to, color, duplicate, move-to-page, delete.
3. New `toggle` block type (collapsible container).
4. New `hiddenText` block type (masked content, toggle visibility).
5. Page actions menu in breadcrumbs: copy link, duplicate, move, delete, full-width toggle, export (PDF/MD/HTML).
6. Favorite star toggle in breadcrumbs.

## Architecture Overview

- Editor extensions live in `packages/editor/src/extensions/`, each as a TipTap Node/Mark with a React NodeView.
- Page-level UI (breadcrumbs, actions, dialogs) lives in `apps/web/src/components/page/`.
- Shared page mutation logic is extracted into a hook `use-page-actions` so sidebar context menu and breadcrumb menu share a single source of truth.
- Colors are keyword-based (not HEX) and resolved via CSS variables so dark-mode adaptation is automatic.

---

## 1. Excalidraw Dark Theme Fix

**Problem.** `packages/excalidraw/src/board.css` sets `filter: none !important` on `.excalidraw.theme--dark canvas` to prevent image inversion. Side effect: canvas background stays white in dark mode.

**Solution.** In `packages/excalidraw/src/board-inner.tsx`, track `muiTheme.palette.mode` and when it changes, call `api.updateScene({ appState: { viewBackgroundColor: next }, commitToHistory: false })` locally.

Color mapping:
- light → `#ffffff`
- dark → `#121212`

The `viewBackgroundColor` update is applied through the imperative API but not written to Yjs (Excalidraw's `appState` is not synced when `commitToHistory: false` is used with local-only scene updates). This means every user sees the background that matches their own theme.

The existing `filter: none !important` CSS override stays (still needed for documents where users have set a light background explicitly).

**Files changed:**
- `packages/excalidraw/src/board-inner.tsx` (~15 lines added)

---

## 2. Block Drag-Handle Menu

### Trigger

Clicking `DragIndicatorIcon` in `packages/editor/src/components/drag-handle.tsx` opens an MUI `Menu` anchored to the icon. Drag (mousedown + drag) still works — the icon's `onClick` only fires on a clean click without drag.

### Menu structure (top → bottom)

1. **Header** — disabled `MenuItem` showing the block's display name (e.g. "Заголовок 1", "Маркированный список"). Names map in `packages/editor/src/lib/block-names.ts`:
   ```
   paragraph → Текст
   heading(1-4) → Заголовок 1-4
   bulletList → Маркированный список
   orderedList → Нумерованный список
   blockquote → Цитата
   codeBlock → Код
   resizableImage → Изображение
   fileAttachment → Файл
   pageLink → Ссылка на страницу
   callout → Подсказка
   toggle → Переключатель
   hiddenText → Скрытый текст
   taskList → Задачи
   ```

2. **"Превратить в"** with `SyncAltOutlinedIcon` — nested menu. Shown only when current block is convertible: `paragraph | heading | bulletList | orderedList | blockquote | codeBlock`. Targets: text, h1-4, bullet list, numbered list, quote, code. Conversion commands in `packages/editor/src/lib/block-conversion.ts`:
   - text → `editor.chain().focus().setParagraph().run()`
   - h1-4 → `editor.chain().focus().setHeading({ level: N }).run()`
   - bullet → `editor.chain().focus().toggleBulletList().run()`
   - numbered → `editor.chain().focus().toggleOrderedList().run()`
   - quote → `editor.chain().focus().setBlockquote().run()`
   - code → `editor.chain().focus().toggleCodeBlock().run()`

3. **"Цвет"** with `FormatPaintOutlinedIcon` — nested menu with two sections:
   - **Цвет текста**: 10 rows (По умолчанию + 9 colors). Each row: 14×14 color square + label.
   - **Фон**: 10 rows (same structure).
   - Both groups use keyword values (`"default" | "gray" | "brown" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "red"`).

4. Divider.

5. **Дубликат** with `ContentCopyIcon` — extracts the block's JSON via `editor.state.doc.nodeAt(pos).toJSON()`, inserts a copy at `pos + node.nodeSize` via `editor.commands.insertContentAt(posAfter, json)`.

6. **Переместить** with `ShortcutIcon` — opens `BlockMoveDialog`. After selection, runs `block-move` logic (see below).

Implementation note: the existing `MovePageDialog` in `apps/web/src/components/workspace/move-page-dialog.tsx` contains page-specific tree picker UI (recursive `MoveTreeItem`). For block-move we need the same tree but a different submit action and no descendant exclusion. Refactor: extract `PageTreePicker` into `apps/web/src/components/workspace/page-tree-picker.tsx` with props `{ workspaceId, excludePageIds?, onSelect }`. Both `MovePageDialog` and new `BlockMoveDialog` compose it.

7. **Удалить** with `DeleteIcon` (`sx={{ color: "error.main" }}`) — `editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run()`.

### Color system

**Text color** — custom TipTap mark `anynoteTextColor`:
```ts
Mark.create({
  name: "anynoteTextColor",
  addAttributes: () => ({ color: { default: "default" } }),
  parseHTML: () => [{ tag: "span[data-anynote-color]" }],
  renderHTML: ({ HTMLAttributes }) =>
    ["span", { class: `anynote-color-${HTMLAttributes.color}`, "data-anynote-color": HTMLAttributes.color }, 0],
})
```
- `color: "default"` removes the mark.
- Applying: `editor.chain().setMark("anynoteTextColor", { color }).run()`.

**Background color** — added as attribute on base block nodes via a small extension `BlockBackground` that uses `extendNodeSchema` on `paragraph | heading | bulletList | orderedList | blockquote | codeBlock | taskList | callout | toggle | hiddenText | resizableImage | fileAttachment | pageLink`:
```ts
addGlobalAttributes: () => [{
  types: [...above list],
  attributes: { backgroundColor: { default: null, renderHTML: attrs =>
    attrs.backgroundColor ? { class: `anynote-bg-${attrs.backgroundColor}` } : {}
  } }
}]
```

**CSS palette** (in `packages/editor/src/styles/content.css`):
```css
:root {
  --anynote-color-gray: #6B6B6B;
  --anynote-color-brown: #6A4B3C;
  --anynote-color-orange: #B45309;
  --anynote-color-yellow: #A16207;
  --anynote-color-green: #347D47;
  --anynote-color-blue: #1A6BB3;
  --anynote-color-purple: #6B3FA0;
  --anynote-color-pink: #B5338E;
  --anynote-color-red: #B42318;

  --anynote-bg-gray: rgba(107,107,107,0.12);
  --anynote-bg-brown: rgba(106,75,60,0.14);
  --anynote-bg-orange: rgba(180,83,9,0.14);
  --anynote-bg-yellow: rgba(161,98,7,0.14);
  --anynote-bg-green: rgba(52,125,71,0.14);
  --anynote-bg-blue: rgba(26,107,179,0.14);
  --anynote-bg-purple: rgba(107,63,160,0.14);
  --anynote-bg-pink: rgba(181,51,142,0.14);
  --anynote-bg-red: rgba(180,35,24,0.14);
}

[data-mui-color-scheme="dark"] {
  --anynote-color-gray: #9AA0A6;
  /* ... all 9 darker-mode equivalents */
  --anynote-bg-gray: rgba(154,160,166,0.22);
  /* ... 9 darker-mode bg equivalents */
}

.anynote-color-gray { color: var(--anynote-color-gray); }
.anynote-bg-gray    { background-color: var(--anynote-bg-gray); }
/* ... 9 more classes per kind */
```

### Block move across pages

1. Extract block JSON from source editor: `const json = editor.state.doc.nodeAt(pos).toJSON()`.
2. Remove block from source: `editor.chain().focus().deleteRange({ from: pos, to: pos + nodeSize }).run()`. Yjs propagates.
3. Create a headless Yjs session for the destination page:
   - Fetch `/api/yjs/token` to get a short-lived JWT.
   - Open `HocuspocusProvider` pointing at destination page ID.
   - `await provider.whenSynced` (or equivalent promise).
4. Convert JSON → Y.XmlFragment using `prosemirrorJSONToYXmlFragment` from `y-prosemirror`.
5. Append to the destination's `prosemirror` XmlFragment: `yFragment.insert(yFragment.length, [newXmlElement])`.
6. `provider.destroy()` to close the background connection.
7. `router.push(/workspaces/{wsId}/pages/{targetId})`.

Expected latency: 1-2s for sync + insert. Show loading indicator in the menu item while running.

### Files

**New:**
- `packages/editor/src/components/drag-handle-menu.tsx` — main menu UI
- `packages/editor/src/components/block-move-dialog.tsx` — wraps MovePageDialog for block target
- `packages/editor/src/extensions/text-color.ts` — `anynoteTextColor` mark
- `packages/editor/src/extensions/block-background.ts` — `BlockBackground` attribute extension
- `packages/editor/src/lib/block-names.ts`
- `packages/editor/src/lib/block-conversion.ts`
- `packages/editor/src/lib/block-duplicate.ts`
- `packages/editor/src/lib/block-move.ts`
- `packages/editor/src/lib/color-palette.ts` — color keyword constants + labels

**Modified:**
- `packages/editor/src/components/drag-handle.tsx` — add onClick → open menu
- `packages/editor/src/extensions/index.ts` — register new extensions
- `packages/editor/src/styles/content.css` — color variables + classes
- `packages/editor/src/index.ts` — export `BlockMoveDialog` if consumed outside

---

## 3. Toggle Block

### Schema

```ts
Node.create({
  name: "toggle",
  content: "block+",
  group: "block",
  defining: true,
  addAttributes: () => ({
    open: { default: true, parseHTML: el => el.getAttribute("data-open") === "true",
            renderHTML: attrs => ({ "data-open": attrs.open }) },
  }),
  parseHTML: () => [{ tag: 'div[data-type="toggle"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-type": "toggle" }, 0],
  addNodeView: () => ReactNodeViewRenderer(ToggleView),
})
```

### NodeView

```tsx
function ToggleView({ node, updateAttributes }) {
  const open = node.attrs.open
  return (
    <NodeViewWrapper className="anynote-toggle" data-open={open}>
      <IconButton size="small" onClick={() => updateAttributes({ open: !open })}
        sx={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 120ms" }}>
        <ArrowRightOutlinedIcon fontSize="small" />
      </IconButton>
      <NodeViewContent className="anynote-toggle-content" />
    </NodeViewWrapper>
  )
}
```

### CSS

```css
.anynote-toggle { display: grid; grid-template-columns: 28px 1fr; align-items: start; }
.anynote-toggle[data-open="false"] > .anynote-toggle-content > :not(:first-child) {
  display: none;
}
```

### Keyboard behavior

- Enter in first child when `open=false` → pre-handler sets `open=true`, then default Enter behavior.
- Backspace on empty first child → `lift` to unwrap toggle into plain blocks.

Implemented via `addKeyboardShortcuts` or `Plugin` with `handleKeyDown`.

### Slash command (group: base)

```ts
{ id: "toggle", label: "Переключатель", description: "Скрываемое содержимое",
  icon: ArrowRightOutlinedIcon, group: "base",
  command: ({ editor }) => editor.chain().focus().insertContent({
    type: "toggle", attrs: { open: true },
    content: [{ type: "paragraph" }],
  }).run() }
```

### Files

- `packages/editor/src/extensions/toggle.tsx` (~140 lines)
- slash-items.ts entry
- styles/content.css rules

---

## 4. HiddenText Block

### Schema

```ts
Node.create({
  name: "hiddenText",
  content: "block+",
  group: "block",
  defining: true,
  // visible is local-only — never persisted, never parsed
  parseHTML: () => [{ tag: 'div[data-type="hidden-text"]' }],
  renderHTML: ({ HTMLAttributes }) => ["div", { ...HTMLAttributes, "data-type": "hidden-text" }, 0],
  addNodeView: () => ReactNodeViewRenderer(HiddenTextView),
})
```

### NodeView

```tsx
function HiddenTextView() {
  const [visible, setVisible] = useState(false)  // local only
  return (
    <NodeViewWrapper className="anynote-hidden-text" data-visible={visible}>
      <IconButton size="small" onClick={() => setVisible(v => !v)}>
        {visible ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
      </IconButton>
      <NodeViewContent className="anynote-hidden-text-content" />
    </NodeViewWrapper>
  )
}
```

### CSS

```css
.anynote-hidden-text { display: grid; grid-template-columns: 28px 1fr; align-items: start; }
.anynote-hidden-text[data-visible="false"] > .anynote-hidden-text-content {
  -webkit-text-security: disc;
  text-security: disc;
}
@supports not ((-webkit-text-security: disc) or (text-security: disc)) {
  .anynote-hidden-text[data-visible="false"] > .anynote-hidden-text-content {
    filter: blur(5px);
  }
}
```

### Slash command (group: base)

```ts
{ id: "hidden", label: "Скрытый текст", description: "Скрывает содержимое под маской",
  icon: VisibilityOffIcon, group: "base",
  command: ({ editor }) => editor.chain().focus().insertContent({
    type: "hiddenText",
    content: [{ type: "paragraph" }],
  }).run() }
```

### Files

- `packages/editor/src/extensions/hidden-text.tsx` (~100 lines)
- slash-items.ts entry
- styles/content.css rules

---

## 5. Page Actions Menu in Breadcrumbs

### Toolbar integration

Extend `apps/web/src/components/workspace/workspace-toolbar.tsx` with an optional `rightSlot?: ReactNode` prop that renders right of the `<Box flex={1} />` spacer. Existing callers don't set it (no behavioral change).

Page route (`apps/web/src/app/(protected)/workspaces/[wsId]/pages/[pageId]/page.tsx`) passes `<PageActionsToolbar pageId={...} workspaceId={...} />` as `rightSlot`.

### `PageActionsToolbar` component

Contains: `<FavoriteStar />` (section 6) + `<PageActionsMenu />` side by side.

### Shared hook `use-page-actions`

Extracted from `workspace/page-context-menu.tsx`. Signature:

```ts
function usePageActions(pageId: string, workspaceId: string) {
  return {
    isFavorite: boolean,
    toggleFavorite: () => void,
    copyLink: () => void,
    duplicate: () => void,           // runs mutation, navigates
    delete: () => void,              // opens confirm, runs mutation
    openMoveDialog: () => void,
    moveDialog: ReactNode,           // rendered by consumer
    deleteConfirm: ReactNode,
  }
}
```

Both `page-context-menu.tsx` (sidebar) and new `page-actions-menu.tsx` (breadcrumb) use this hook.

### `PageActionsMenu` structure

Triggered by `MoreHorizIcon` `IconButton`. `Menu` contains:

1. **Копировать ссылку** — `LinkIcon` → `navigator.clipboard.writeText(window.location.href)` + snackbar "Ссылка скопирована".
2. **Копия** — `ContentCopyIcon` → `trpc.page.duplicate.mutate({ id })`, navigate to new page.
3. **Переместить** — `ShortcutIcon` → opens `MovePageDialog`.
4. **Удалить** — `DeleteIcon` (red) → confirm dialog → `trpc.page.softDelete` → redirect to parent or `/app`.
5. Divider.
6. **Полноэкранный** — `HeightIcon` (rotated 90°) + `Switch`. State via `useFullWidth(pageId)` hook using `localStorage` key `anynote.page-full-width.{pageId}`. CSS applies `data-full-width="true"` on the page content wrapper; `max-width` changes from `713px` to `100%` (with 32px padding both sides).
7. Divider.
8. **Экспортировать** — `PublishIcon` → opens `PageExportDialog`.

### `PageExportDialog`

Three buttons: PDF, Markdown, HTML.

**PDF** (`window.print()` approach):
- Inject a `<style>` element with `@media print` rules: hide `.workspace-sidebar`, `.workspace-toolbar`, `.drag-handle`, `.slash-menu-popover`; remove max-width; print-friendly typography.
- Call `window.print()`.
- Remove style element after print dialog closes (listen for `afterprint`).

**Markdown** (via `turndown`):
- `const html = editor.getHTML()` (editor instance exposed via ref from `AnyNoteEditor`).
- `const turndown = new TurndownService({ headingStyle: "atx" })`.
- Custom rules:
  - `callout` → `> {emoji} {content}`
  - `toggle` → `<details><summary>{title}</summary>{body}</details>`
  - `hiddenText` → `<span class="hidden">{content}</span>` (not much else — MD doesn't have masked text)
  - `fileAttachment` → `[{name}]({url})`
  - `pageLink` → `[{pageTitle}](/workspaces/{ws}/pages/{id})`
- `const md = turndown.turndown(html)`.
- `const blob = new Blob([md], { type: "text/markdown" })`.
- Trigger download as `{title}.md`.

**HTML**:
- `const html = editor.getHTML()`.
- Wrap in `<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title><style>{inline css}</style></head><body>{html}</body></html>`.
- Inline CSS includes color palette + typography.
- Blob download as `{title}.html`.

For Excalidraw pages: export dialog shows "Экспорт недоступен для этого типа страницы". Copy link / duplicate / move / delete / full-width still work.

### Files

**New:**
- `apps/web/src/hooks/use-page-actions.tsx`
- `apps/web/src/hooks/use-full-width.ts`
- `apps/web/src/components/page/page-actions-toolbar.tsx`
- `apps/web/src/components/page/page-actions-menu.tsx`
- `apps/web/src/components/page/page-export-dialog.tsx`
- `apps/web/src/components/page/favorite-star.tsx`
- `apps/web/src/lib/editor-to-markdown.ts` — turndown config

**Modified:**
- `apps/web/src/components/workspace/workspace-toolbar.tsx` — rightSlot prop
- `apps/web/src/components/workspace/page-context-menu.tsx` — use new hook
- `apps/web/src/components/workspace/move-page-dialog.tsx` — compose extracted PageTreePicker
- Page route layout (where `PageRenderer` is mounted) — pass `data-full-width` + render `rightSlot`

**New shared:**
- `apps/web/src/components/workspace/page-tree-picker.tsx` — extracted tree UI reused by MovePageDialog and BlockMoveDialog

**Dependencies:**
- `turndown` (~15KB) → `apps/web/package.json`

---

## 6. Favorite Star Toggle

### Component

`apps/web/src/components/page/favorite-star.tsx`:

```tsx
function FavoriteStar({ pageId, workspaceId }) {
  const { isFavorite, toggleFavorite } = usePageActions(pageId, workspaceId)
  return (
    <IconButton size="small" onClick={toggleFavorite}>
      {isFavorite
        ? <StarIcon sx={{ color: "warning.main" }} fontSize="small" />
        : <StarBorderIcon fontSize="small" />}
    </IconButton>
  )
}
```

### Optimistic mutation

Inside `use-page-actions`, `toggleFavorite` uses `useMutation` with:
- `onMutate`: toggle `isFavorite` in the query cache immediately.
- `onError`: revert to snapshot.
- `onSettled`: invalidate affected queries.

### Data source

`trpc.page.getById` response already contains `isFavorite` (verified during implementation; if not, add to the `select` in `packages/trpc/src/routers/page.ts`).

### Files

See section 5 (lives in `page-actions-toolbar.tsx`, no standalone additions).

---

## Cross-cutting Concerns

### Registration order in editor extensions

`packages/editor/src/extensions/index.ts` `buildExtensions()`:
```
...existing StarterKit + customs,
AnynoteTextColor,
BlockBackground,
Toggle,
HiddenText,
```

Order matters for mark / node-attribute extensions: `AnynoteTextColor` must be loaded before any mark rendering occurs; `BlockBackground` uses `addGlobalAttributes` so order within that group is stable.

### Slash menu additions

`packages/editor/src/slash-items.ts` `buildItems()` adds two entries in `base` group: `toggle`, `hidden`.

### Theming contract

All custom colors reference CSS variables. The `EditorThemeBridge` already manages `--editor-*` variables; we add a new block of `--anynote-color-*` / `--anynote-bg-*` that respond to MUI `palette.mode`. The bridge sets `data-mui-color-scheme="dark"` on a parent when mode is dark; CSS selects on that attribute.

### Dependencies

- `turndown`: new dep in `apps/web/package.json`.
- `y-prosemirror`: already present (used by editor Yjs sync). We use its `prosemirrorJSONToYXmlFragment` helper for block-move.

---

## Verification Checklist

After implementation:

1. `pnpm run lint` — ESLint passes with `--max-warnings 0`.
2. `pnpm run format` — Prettier formatting applied.
3. `pnpm run check-types` — TypeScript passes (`tsc --noEmit`) across all workspace packages.
4. `pnpm exec playwright test` — all existing E2E tests pass, with particular attention to image upload and file attachment specs (should not regress).
5. Manual smoke test in browser:
   - Toggle / hidden text inserted via slash menu, functional.
   - Drag-handle menu opens on click, all 7 items work.
   - Block color applied correctly in light + dark mode.
   - Block move between pages: source removes block, destination gains it, navigation happens.
   - Breadcrumbs show star + more-horiz on page routes.
   - Star toggles favorite.
   - More-horiz menu: all 7 items work (copy, duplicate, move, delete, full-width toggle, export PDF/MD/HTML).
   - Excalidraw canvas background matches MUI theme.

## Out of scope

- Per-page full-width (saved to DB) — kept as per-user `localStorage` for now.
- Exporting Excalidraw to PDF/MD/HTML — only TEXT pages support export.
- Per-coloring palette for drag-handle (the 9 colors are hardcoded — no user customization).
- Keyboard shortcuts for the drag-handle menu (only mouse/trackpad supported in this iteration).
- Accessibility review beyond standard MUI `IconButton` semantics.

## Open questions resolved during brainstorming

- HiddenText as block (not inline mark). Confirmed by user.
- PDF via `window.print()` (not `jsPDF`). Confirmed by user.
- Full-screen = full-width CSS toggle (not true fullscreen). Confirmed by user.
- "Превратить в" hidden for non-text blocks. Confirmed by user.
- Color palette with CSS variables for theme adaptation. Confirmed by user.
- Block move via client-side Yjs second session (variant A). Confirmed by user.
