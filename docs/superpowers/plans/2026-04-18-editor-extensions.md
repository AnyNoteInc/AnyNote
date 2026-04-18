# Editor Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build six editor/page features: Excalidraw dark-theme fix, block drag-handle menu with convert/color/duplicate/move/delete, Toggle block, HiddenText block, page actions menu in breadcrumbs (copy link / duplicate / move / delete / full-width / export), favorite star toggle in breadcrumbs.

**Architecture:** New TipTap extensions (`toggle`, `hiddenText`, `anynoteTextColor`, `blockBackground`) registered alongside existing ones in `packages/editor/src/extensions/`. UI-level extraction of a `usePageActions` hook shared between the sidebar context menu and the new breadcrumb actions menu. Block-move across pages via a temporary headless `HocuspocusProvider` session on the destination doc. PDF export via `window.print()` with print-scoped CSS; Markdown via `turndown` library; HTML via `editor.getHTML()`.

**Tech Stack:** TipTap v3, Y.js / Hocuspocus, MUI v6, Next.js 16 App Router, tRPC v11, React 19, Playwright for E2E.

**Testing note:** The repo has no unit-test framework (only Playwright E2E). This plan prefers TypeScript + targeted Playwright tests over per-unit TDD. Pure-logic helpers are verified by integration use; UI changes are verified via existing + new Playwright specs at the end of each phase.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/editor/src/lib/block-names.ts` | Localized Russian display names for block node types |
| `packages/editor/src/lib/color-palette.ts` | Keyword color list + labels + helpers |
| `packages/editor/src/lib/block-conversion.ts` | "Convert to" command dispatch |
| `packages/editor/src/lib/block-duplicate.ts` | Duplicate block at position |
| `packages/editor/src/lib/block-move.ts` | Cross-page block move via headless Yjs |
| `packages/editor/src/extensions/text-color.ts` | `anynoteTextColor` TipTap mark |
| `packages/editor/src/extensions/block-background.ts` | Global `backgroundColor` attribute on block nodes |
| `packages/editor/src/extensions/toggle.tsx` | Collapsible container block |
| `packages/editor/src/extensions/hidden-text.tsx` | Masked-content block |
| `packages/editor/src/components/drag-handle-menu.tsx` | MUI Menu + color/convert submenus on drag handle |
| `packages/editor/src/components/block-move-dialog.tsx` | Dialog wrapping shared page tree picker |
| `apps/web/src/components/workspace/page-tree-picker.tsx` | Extracted shared tree picker (from `MovePageDialog`) |
| `apps/web/src/hooks/use-page-actions.tsx` | Shared page actions (duplicate/move/delete/favorite/copyLink) |
| `apps/web/src/hooks/use-full-width.ts` | Per-page full-width state via localStorage |
| `apps/web/src/components/page/page-actions-toolbar.tsx` | Star + MoreHoriz host for breadcrumbs right slot |
| `apps/web/src/components/page/page-actions-menu.tsx` | MoreHoriz menu: copy/dup/move/delete/full-width/export |
| `apps/web/src/components/page/page-export-dialog.tsx` | PDF / Markdown / HTML export entry |
| `apps/web/src/components/page/favorite-star.tsx` | Star toggle using usePageActions |
| `apps/web/src/lib/editor-to-markdown.ts` | turndown instance with custom rules |

### Modified files

| Path | Change |
|---|---|
| `packages/excalidraw/src/board-inner.tsx` | Sync `viewBackgroundColor` with MUI theme |
| `packages/editor/src/extensions/index.ts` | Register TextColor / BlockBackground / Toggle / HiddenText |
| `packages/editor/src/slash-items.ts` | Add toggle + hidden slash commands |
| `packages/editor/src/styles/content.css` | CSS palette + block-level rules for toggle/hidden |
| `packages/editor/src/components/drag-handle.tsx` | Click-to-open menu on drag indicator icon |
| `packages/editor/src/anynote-editor.tsx` | Forward editor instance for export + move helpers |
| `packages/editor/src/index.ts` | Export helpers/components consumed by app |
| `apps/web/src/components/workspace/workspace-toolbar.tsx` | Add optional `rightSlot` prop |
| `apps/web/src/components/workspace/page-context-menu.tsx` | Reuse `usePageActions` hook |
| `apps/web/src/components/workspace/move-page-dialog.tsx` | Compose extracted `PageTreePicker` |
| `apps/web/src/app/(protected)/workspaces/[wsId]/pages/[pageId]/page.tsx` | Mount `PageActionsToolbar` and pass to toolbar |
| `apps/web/package.json` | Add `turndown` dep |
| `apps/e2e/editor-extensions.spec.ts` | New E2E specs (end of plan) |

---

## Phase 0 — Excalidraw Dark Theme Fix

### Task 1: Sync Excalidraw canvas background with MUI theme

**Files:**
- Modify: `packages/excalidraw/src/board-inner.tsx`

- [ ] **Step 1: Add theme-aware viewBackgroundColor effect**

Open `packages/excalidraw/src/board-inner.tsx` and add an effect after the existing `onMount`/`setApi` logic (around line 55, after the `onMount` useCallback). Update the file to include:

```tsx
// Sync canvas background with MUI theme. Excalidraw's dark `theme` prop styles
// the chrome, but the canvas background comes from appState.viewBackgroundColor.
// We push the local theme-derived color via updateScene (no history commit) so
// the choice stays per-user and is not written to Yjs.
useEffect(() => {
  if (!api) return
  const viewBackgroundColor = muiTheme.palette.mode === "dark" ? "#121212" : "#ffffff"
  api.updateScene({
    appState: { viewBackgroundColor },
    captureUpdate: "NEVER",
  })
}, [api, muiTheme.palette.mode])
```

The `captureUpdate: "NEVER"` replaces older `commitToHistory: false` in recent Excalidraw versions; if TypeScript complains, fall back to `commitToHistory: false`.

- [ ] **Step 2: Type-check just excalidraw package**

```bash
pnpm --filter @repo/excalidraw check-types
```

Expected: no errors.

- [ ] **Step 3: Manual smoke — start dev, create excalidraw page, toggle theme**

```bash
docker compose up -d
pnpm --filter @repo/yjs-server dev &
pnpm exec turbo run dev --filter=web
```

Open browser at `http://localhost:3000`, sign up, create workspace, create an Excalidraw page. Toggle OS dark mode (or change palette mode in MUI if there's a theme toggle). Canvas background should switch white ↔ dark.

- [ ] **Step 4: Commit**

```bash
git add packages/excalidraw/src/board-inner.tsx
git commit -m "fix(excalidraw): sync canvas background with MUI theme"
```

---

## Phase 1 — Extension Foundations

### Task 2: Block display names map

**Files:**
- Create: `packages/editor/src/lib/block-names.ts`

- [ ] **Step 1: Write the full display-name map**

Content:

```ts
// Human-readable Russian labels for TipTap node types, used by the drag-handle
// menu header. Missing types fall back to the raw type string.

type NodeLike = { type: { name: string }; attrs?: Record<string, unknown> }

const BASE: Record<string, string> = {
  paragraph: "Текст",
  bulletList: "Маркированный список",
  orderedList: "Нумерованный список",
  taskList: "Задачи",
  blockquote: "Цитата",
  codeBlock: "Код",
  resizableImage: "Изображение",
  fileAttachment: "Файл",
  pageLink: "Ссылка на страницу",
  callout: "Подсказка",
  toggle: "Переключатель",
  hiddenText: "Скрытый текст",
}

export function blockDisplayName(node: NodeLike): string {
  const name = node.type.name
  if (name === "heading") {
    const level = Number(node.attrs?.level ?? 1)
    return `Заголовок ${level}`
  }
  return BASE[name] ?? name
}

export const CONVERTIBLE_TYPES = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
])

export function isConvertible(node: NodeLike): boolean {
  return CONVERTIBLE_TYPES.has(node.type.name)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/lib/block-names.ts
git commit -m "feat(editor): block display names + convertibility helper"
```

---

### Task 3: Color palette constants + CSS variables

**Files:**
- Create: `packages/editor/src/lib/color-palette.ts`
- Modify: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Create the palette module**

Content of `packages/editor/src/lib/color-palette.ts`:

```ts
export const TEXT_COLOR_KEYS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const

export type TextColorKey = (typeof TEXT_COLOR_KEYS)[number]

export const TEXT_COLOR_LABELS: Record<TextColorKey, string> = {
  default: "По умолчанию",
  gray: "Серый",
  brown: "Коричневый",
  orange: "Оранжевый",
  yellow: "Жёлтый",
  green: "Зелёный",
  blue: "Голубой",
  purple: "Фиолетовый",
  pink: "Розовый",
  red: "Красный",
}

export const BACKGROUND_COLOR_KEYS = TEXT_COLOR_KEYS
export type BackgroundColorKey = TextColorKey
export const BACKGROUND_COLOR_LABELS: Record<BackgroundColorKey, string> = {
  ...TEXT_COLOR_LABELS,
  blue: "Синий",
}

// CSS-variable-backed preview swatches for menu items.
export function textColorSwatch(key: TextColorKey): string {
  if (key === "default") return "transparent"
  return `var(--anynote-color-${key})`
}

export function backgroundColorSwatch(key: BackgroundColorKey): string {
  if (key === "default") return "transparent"
  return `var(--anynote-bg-${key})`
}
```

- [ ] **Step 2: Extend `content.css` with palette vars and classes**

Open `packages/editor/src/styles/content.css` and append at the end:

```css
/* === Anynote color palette (keyword-driven, theme-aware) === */
:root {
  --anynote-color-gray:   #6b6b6b;
  --anynote-color-brown:  #8a5d3d;
  --anynote-color-orange: #b45309;
  --anynote-color-yellow: #a16207;
  --anynote-color-green:  #347d47;
  --anynote-color-blue:   #1a6bb3;
  --anynote-color-purple: #6b3fa0;
  --anynote-color-pink:   #b5338e;
  --anynote-color-red:    #b42318;

  --anynote-bg-gray:   rgba(107, 107, 107, 0.12);
  --anynote-bg-brown:  rgba(138, 93, 61, 0.14);
  --anynote-bg-orange: rgba(180, 83, 9, 0.14);
  --anynote-bg-yellow: rgba(161, 98, 7, 0.14);
  --anynote-bg-green:  rgba(52, 125, 71, 0.14);
  --anynote-bg-blue:   rgba(26, 107, 179, 0.14);
  --anynote-bg-purple: rgba(107, 63, 160, 0.14);
  --anynote-bg-pink:   rgba(181, 51, 142, 0.14);
  --anynote-bg-red:    rgba(180, 35, 24, 0.14);
}

[data-mui-color-scheme="dark"] {
  --anynote-color-gray:   #b5bac0;
  --anynote-color-brown:  #c9a07a;
  --anynote-color-orange: #e58a2b;
  --anynote-color-yellow: #d7b54c;
  --anynote-color-green:  #6fd389;
  --anynote-color-blue:   #7cbcff;
  --anynote-color-purple: #c395f0;
  --anynote-color-pink:   #f09ad0;
  --anynote-color-red:    #f28a80;

  --anynote-bg-gray:   rgba(181, 186, 192, 0.22);
  --anynote-bg-brown:  rgba(201, 160, 122, 0.22);
  --anynote-bg-orange: rgba(229, 138, 43, 0.22);
  --anynote-bg-yellow: rgba(215, 181, 76, 0.22);
  --anynote-bg-green:  rgba(111, 211, 137, 0.22);
  --anynote-bg-blue:   rgba(124, 188, 255, 0.22);
  --anynote-bg-purple: rgba(195, 149, 240, 0.22);
  --anynote-bg-pink:   rgba(240, 154, 208, 0.22);
  --anynote-bg-red:    rgba(242, 138, 128, 0.22);
}

.anynote-color-gray   { color: var(--anynote-color-gray); }
.anynote-color-brown  { color: var(--anynote-color-brown); }
.anynote-color-orange { color: var(--anynote-color-orange); }
.anynote-color-yellow { color: var(--anynote-color-yellow); }
.anynote-color-green  { color: var(--anynote-color-green); }
.anynote-color-blue   { color: var(--anynote-color-blue); }
.anynote-color-purple { color: var(--anynote-color-purple); }
.anynote-color-pink   { color: var(--anynote-color-pink); }
.anynote-color-red    { color: var(--anynote-color-red); }

.anynote-bg-gray   { background-color: var(--anynote-bg-gray); }
.anynote-bg-brown  { background-color: var(--anynote-bg-brown); }
.anynote-bg-orange { background-color: var(--anynote-bg-orange); }
.anynote-bg-yellow { background-color: var(--anynote-bg-yellow); }
.anynote-bg-green  { background-color: var(--anynote-bg-green); }
.anynote-bg-blue   { background-color: var(--anynote-bg-blue); }
.anynote-bg-purple { background-color: var(--anynote-bg-purple); }
.anynote-bg-pink   { background-color: var(--anynote-bg-pink); }
.anynote-bg-red    { background-color: var(--anynote-bg-red); }

/* Block-level background keeps padding/radius so highlights look intentional */
.anynote-editor [class*="anynote-bg-"] {
  padding: 2px 6px;
  border-radius: 4px;
}
```

- [ ] **Step 3: Check that MUI actually sets `data-mui-color-scheme`**

MUI v6 with CssVarsProvider emits this attribute on `<html>`. Check:

```bash
grep -rn "data-mui-color-scheme\|CssVarsProvider\|experimental_extendTheme" packages/ui apps/web | head -20
```

If the attribute isn't emitted (project uses the non-CSS-vars ThemeProvider), extend the `EditorThemeBridge` to set `data-mui-color-scheme` on its wrapper:

Open `packages/editor/src/theme-bridge.tsx` and add to the rendered root:

```tsx
data-mui-color-scheme={theme.palette.mode}
```

(Only add if the grep confirms `data-mui-color-scheme` is not already present.)

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/lib/color-palette.ts packages/editor/src/styles/content.css packages/editor/src/theme-bridge.tsx
git commit -m "feat(editor): color palette constants and CSS variables"
```

---

### Task 4: TextColor mark extension

**Files:**
- Create: `packages/editor/src/extensions/text-color.ts`

- [ ] **Step 1: Write the mark**

Content:

```ts
import { Mark, mergeAttributes } from "@tiptap/core"

import type { TextColorKey } from "../lib/color-palette"
import { TEXT_COLOR_KEYS } from "../lib/color-palette"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    anynoteTextColor: {
      setAnynoteTextColor: (color: TextColorKey) => ReturnType
      unsetAnynoteTextColor: () => ReturnType
    }
  }
}

function isValidColor(value: unknown): value is TextColorKey {
  return typeof value === "string" && (TEXT_COLOR_KEYS as readonly string[]).includes(value)
}

export const AnynoteTextColor = Mark.create({
  name: "anynoteTextColor",

  addAttributes() {
    return {
      color: {
        default: "default" as TextColorKey,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-anynote-color")
          return isValidColor(raw) ? raw : "default"
        },
        renderHTML: (attrs) => {
          const color = attrs.color as TextColorKey
          if (!color || color === "default") return {}
          return {
            class: `anynote-color-${color}`,
            "data-anynote-color": color,
          }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-anynote-color]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setAnynoteTextColor:
        (color) =>
        ({ chain }) => {
          if (color === "default") {
            return chain().unsetMark(this.name).run()
          }
          return chain().setMark(this.name, { color }).run()
        },
      unsetAnynoteTextColor:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    }
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/extensions/text-color.ts
git commit -m "feat(editor): anynoteTextColor mark"
```

---

### Task 5: BlockBackground global attribute extension

**Files:**
- Create: `packages/editor/src/extensions/block-background.ts`

- [ ] **Step 1: Write the extension**

Content:

```ts
import { Extension } from "@tiptap/core"

import type { BackgroundColorKey } from "../lib/color-palette"
import { BACKGROUND_COLOR_KEYS } from "../lib/color-palette"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockBackground: {
      setBlockBackground: (color: BackgroundColorKey) => ReturnType
    }
  }
}

// Every block node that should support the "Цвет → Фон" menu entry
export const BACKGROUND_SUPPORTED_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "callout",
  "toggle",
  "hiddenText",
  "resizableImage",
  "fileAttachment",
  "pageLink",
]

function isValidBg(value: unknown): value is BackgroundColorKey {
  return typeof value === "string" && (BACKGROUND_COLOR_KEYS as readonly string[]).includes(value)
}

export const BlockBackground = Extension.create({
  name: "blockBackground",

  addGlobalAttributes() {
    return [
      {
        types: BACKGROUND_SUPPORTED_TYPES,
        attributes: {
          backgroundColor: {
            default: null as BackgroundColorKey | null,
            parseHTML: (el) => {
              const raw = el.getAttribute("data-anynote-bg")
              return isValidBg(raw) ? raw : null
            },
            renderHTML: (attrs) => {
              const bg = attrs.backgroundColor as BackgroundColorKey | null
              if (!bg || bg === "default") return {}
              return {
                class: `anynote-bg-${bg}`,
                "data-anynote-bg": bg,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockBackground:
        (color) =>
        ({ state, dispatch, tr }) => {
          const { from, to } = state.selection
          let changed = false
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!BACKGROUND_SUPPORTED_TYPES.includes(node.type.name)) return
            const next = color === "default" ? null : color
            if (node.attrs.backgroundColor === next) return
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: next })
            changed = true
          })
          if (changed && dispatch) dispatch(tr)
          return changed
        },
    }
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/extensions/block-background.ts
git commit -m "feat(editor): blockBackground global attribute extension"
```

---

### Task 6: Register TextColor + BlockBackground in extensions index

**Files:**
- Modify: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Add imports and entries**

Open `packages/editor/src/extensions/index.ts`. Find the `buildExtensions()` function (referenced in the earlier exploration at L38-60). Add the new extensions to the returned array.

Add to imports near the top:

```ts
import { AnynoteTextColor } from "./text-color"
import { BlockBackground } from "./block-background"
```

Add to the extension list returned by `buildExtensions()`, after StarterKit but before custom node views:

```ts
AnynoteTextColor,
BlockBackground,
```

Note: if the file uses `.configure()` style chaining, follow that style. The exact insertion point needs to preserve existing ordering — inspect the function and insert analogously.

- [ ] **Step 2: Type-check editor package**

```bash
pnpm --filter @repo/editor check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/index.ts
git commit -m "feat(editor): register text-color and block-background extensions"
```

---

## Phase 2 — New Block Types

### Task 7: Toggle block extension

**Files:**
- Create: `packages/editor/src/extensions/toggle.tsx`
- Modify: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Write the Toggle node and NodeView**

Content of `packages/editor/src/extensions/toggle.tsx`:

```tsx
import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"

import { ArrowRightOutlinedIcon, IconButton } from "@repo/ui/components"

function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  const open = node.attrs.open !== false

  const handleToggle = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    updateAttributes({ open: !open })
  }

  return (
    <NodeViewWrapper
      className="anynote-toggle"
      data-open={open}
      // Let ProseMirror handle selection inside content, the wrapper itself is passive
    >
      <IconButton
        size="small"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleToggle}
        contentEditable={false}
        className="anynote-toggle-arrow"
        aria-label={open ? "Свернуть" : "Развернуть"}
        sx={{
          width: 20,
          height: 20,
          p: 0,
          mt: "2px",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 120ms",
          color: "text.secondary",
        }}
      >
        <ArrowRightOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <NodeViewContent className="anynote-toggle-content" as="div" />
    </NodeViewWrapper>
  )
}

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-open") !== "false",
        renderHTML: (attrs) => ({ "data-open": String(Boolean(attrs.open)) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle" }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addKeyboardShortcuts() {
    return {
      // If user presses Enter at the end of the first-child paragraph while the
      // toggle is collapsed, expand it so the new paragraph is visible.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== "toggle") continue
          if (node.attrs.open) return false
          const pos = $from.before(depth)
          editor.chain().command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true })
            return true
          }).run()
          return false
        }
        return false
      },
    }
  },
})
```

- [ ] **Step 2: Add Toggle CSS**

Append to `packages/editor/src/styles/content.css`:

```css
/* === Toggle block === */
.anynote-toggle {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 4px;
  align-items: start;
}
.anynote-toggle[data-open="false"] > .anynote-toggle-content > *:not(:first-child) {
  display: none;
}
.anynote-toggle-content > * {
  margin: 0;
}
.anynote-toggle-content > * + * {
  margin-top: 6px;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/toggle.tsx packages/editor/src/styles/content.css
git commit -m "feat(editor): toggle block extension"
```

---

### Task 8: HiddenText block extension

**Files:**
- Create: `packages/editor/src/extensions/hidden-text.tsx`
- Modify: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Write the HiddenText node and NodeView**

Content of `packages/editor/src/extensions/hidden-text.tsx`:

```tsx
import { useState } from "react"
import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"

import { IconButton, VisibilityIcon, VisibilityOffIcon } from "@repo/ui/components"

// `visible` is a LOCAL view-state only — we do not persist it. Every client
// starts with the content masked and reveals on their own click.
function HiddenTextView() {
  const [visible, setVisible] = useState(false)

  return (
    <NodeViewWrapper className="anynote-hidden-text" data-visible={visible}>
      <IconButton
        size="small"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setVisible((v) => !v)}
        contentEditable={false}
        aria-label={visible ? "Скрыть" : "Показать"}
        sx={{
          width: 20,
          height: 20,
          p: 0,
          mt: "2px",
          color: "text.secondary",
        }}
      >
        {visible ? (
          <VisibilityIcon sx={{ fontSize: 18 }} />
        ) : (
          <VisibilityOffIcon sx={{ fontSize: 18 }} />
        )}
      </IconButton>
      <NodeViewContent className="anynote-hidden-text-content" as="div" />
    </NodeViewWrapper>
  )
}

export const HiddenText = Node.create({
  name: "hiddenText",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="hidden-text"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "hidden-text" }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HiddenTextView)
  },
})
```

Note: `IconButton`, `VisibilityIcon`, `VisibilityOffIcon` are re-exported by `@repo/ui/components` — confirm this (both icons are standard MUI icons). If either is missing from the package barrel, add them to `packages/ui/src/components/index.ts` as part of this task.

- [ ] **Step 2: Verify `@repo/ui/components` re-exports both icons**

```bash
grep -n "VisibilityIcon\|VisibilityOffIcon\|ArrowRightOutlinedIcon" packages/ui/src/components/index.ts
```

If any icon is missing, add it to the index file (follow the existing pattern for re-exports).

- [ ] **Step 3: Add HiddenText CSS**

Append to `packages/editor/src/styles/content.css`:

```css
/* === Hidden text block === */
.anynote-hidden-text {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 4px;
  align-items: start;
}
.anynote-hidden-text[data-visible="false"] > .anynote-hidden-text-content {
  -webkit-text-security: disc;
  text-security: disc;
}
@supports not ((-webkit-text-security: disc) or (text-security: disc)) {
  .anynote-hidden-text[data-visible="false"] > .anynote-hidden-text-content {
    filter: blur(5px);
  }
}
.anynote-hidden-text-content > * + * {
  margin-top: 6px;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/hidden-text.tsx packages/editor/src/styles/content.css packages/ui/src/components/index.ts
git commit -m "feat(editor): hidden-text block extension"
```

---

### Task 9: Register Toggle + HiddenText, add slash-menu items

**Files:**
- Modify: `packages/editor/src/extensions/index.ts`
- Modify: `packages/editor/src/slash-items.ts`

- [ ] **Step 1: Register extensions**

Add imports to `packages/editor/src/extensions/index.ts`:

```ts
import { Toggle } from "./toggle"
import { HiddenText } from "./hidden-text"
```

Add to the extensions list returned by `buildExtensions()`, after `Callout` and other custom nodes:

```ts
Toggle,
HiddenText,
```

- [ ] **Step 2: Add slash items**

Open `packages/editor/src/slash-items.ts`. Find the `buildItems()` helper (referenced in exploration at L30) and add two items to the `base` group, ordered near other block commands:

```ts
{
  id: "toggle",
  label: "Переключатель",
  description: "Скрываемое содержимое",
  icon: ArrowRightOutlinedIcon,
  group: "base",
  command: ({ editor, range }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: "toggle",
        attrs: { open: true },
        content: [{ type: "paragraph" }],
      })
      .run(),
},
{
  id: "hidden",
  label: "Скрытый текст",
  description: "Скрывает содержимое под маской",
  icon: VisibilityOffIcon,
  group: "base",
  command: ({ editor, range }) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: "hiddenText",
        content: [{ type: "paragraph" }],
      })
      .run(),
},
```

Add the icon imports at the top of `slash-items.ts` if they are not already imported:

```ts
import { ArrowRightOutlinedIcon, VisibilityOffIcon } from "@repo/ui/components"
```

- [ ] **Step 3: Type-check editor package**

```bash
pnpm --filter @repo/editor check-types
```

Expected: no errors.

- [ ] **Step 4: Smoke-test in browser**

With dev servers running, open a text page. Open slash menu (`/`), scroll to see "Переключатель" and "Скрытый текст". Click each:
- Toggle: expect a collapsible block with an arrow on the left.
- HiddenText: expect a block with an eye icon and masked content when typed.

Type into both. Expand/collapse toggle. Show/hide hidden.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/index.ts packages/editor/src/slash-items.ts
git commit -m "feat(editor): toggle and hidden-text slash menu items"
```

---

## Phase 3 — Drag-Handle Menu

### Task 10: Block duplicate + block conversion libs

**Files:**
- Create: `packages/editor/src/lib/block-duplicate.ts`
- Create: `packages/editor/src/lib/block-conversion.ts`

- [ ] **Step 1: Write duplicate helper**

Content of `packages/editor/src/lib/block-duplicate.ts`:

```ts
import type { Editor } from "@tiptap/core"

// Duplicates the block at `pos` by serializing it to JSON and inserting a copy
// immediately after. Works for any node type since it uses the raw JSON form.
export function duplicateBlock(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return false
  const json = node.toJSON()
  const insertAt = pos + node.nodeSize
  return editor.chain().focus().insertContentAt(insertAt, json).run()
}
```

- [ ] **Step 2: Write conversion helper**

Content of `packages/editor/src/lib/block-conversion.ts`:

```ts
import type { Editor } from "@tiptap/core"

export type ConversionTarget =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"

export const CONVERSION_LABELS: Record<ConversionTarget, string> = {
  paragraph: "Текст",
  "heading-1": "Заголовок 1",
  "heading-2": "Заголовок 2",
  "heading-3": "Заголовок 3",
  "heading-4": "Заголовок 4",
  bulletList: "Маркированный список",
  orderedList: "Нумерованный список",
  blockquote: "Цитата",
  codeBlock: "Код",
}

export function convertBlock(editor: Editor, target: ConversionTarget): boolean {
  const chain = editor.chain().focus()
  switch (target) {
    case "paragraph":
      return chain.setParagraph().run()
    case "heading-1":
      return chain.setHeading({ level: 1 }).run()
    case "heading-2":
      return chain.setHeading({ level: 2 }).run()
    case "heading-3":
      return chain.setHeading({ level: 3 }).run()
    case "heading-4":
      return chain.setHeading({ level: 4 }).run()
    case "bulletList":
      return chain.toggleBulletList().run()
    case "orderedList":
      return chain.toggleOrderedList().run()
    case "blockquote":
      return chain.setBlockquote().run()
    case "codeBlock":
      return chain.toggleCodeBlock().run()
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/lib/block-duplicate.ts packages/editor/src/lib/block-conversion.ts
git commit -m "feat(editor): block duplicate and conversion helpers"
```

---

### Task 11: DragHandleMenu component (without move)

**Files:**
- Create: `packages/editor/src/components/drag-handle-menu.tsx`

- [ ] **Step 1: Write the menu component**

Content of `packages/editor/src/components/drag-handle-menu.tsx`:

```tsx
"use client"

import { useMemo, useState, type MouseEvent } from "react"
import type { Editor } from "@tiptap/core"

import {
  Box,
  ContentCopyIcon,
  DeleteIcon,
  Divider,
  FormatPaintOutlinedIcon,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  ShortcutIcon,
  Stack,
  SyncAltOutlinedIcon,
  Typography,
} from "@repo/ui/components"

import { blockDisplayName, isConvertible } from "../lib/block-names"
import { convertBlock, CONVERSION_LABELS, type ConversionTarget } from "../lib/block-conversion"
import { duplicateBlock } from "../lib/block-duplicate"
import {
  BACKGROUND_COLOR_KEYS,
  BACKGROUND_COLOR_LABELS,
  TEXT_COLOR_KEYS,
  TEXT_COLOR_LABELS,
  backgroundColorSwatch,
  textColorSwatch,
  type BackgroundColorKey,
  type TextColorKey,
} from "../lib/color-palette"

type Props = {
  editor: Editor
  anchorEl: HTMLElement | null
  pos: number | null
  onClose: () => void
  onRequestMove: (pos: number) => void
}

type Submenu = "convert" | "color" | null

export function DragHandleMenu({ editor, anchorEl, pos, onClose, onRequestMove }: Props) {
  const [submenu, setSubmenu] = useState<Submenu>(null)
  const [submenuAnchor, setSubmenuAnchor] = useState<HTMLElement | null>(null)

  const node = useMemo(() => (pos == null ? null : editor.state.doc.nodeAt(pos)), [editor, pos])
  const displayName = node ? blockDisplayName(node) : ""
  const convertible = node ? isConvertible(node) : false

  const handleClose = () => {
    setSubmenu(null)
    setSubmenuAnchor(null)
    onClose()
  }

  const handleOpenSubmenu = (kind: "convert" | "color") => (e: MouseEvent<HTMLElement>) => {
    setSubmenu(kind)
    setSubmenuAnchor(e.currentTarget)
  }

  const handleConvert = (target: ConversionTarget) => {
    if (pos == null) return
    editor.chain().focus().setTextSelection(pos + 1).run()
    convertBlock(editor, target)
    handleClose()
  }

  const handleTextColor = (color: TextColorKey) => {
    if (pos == null || !node) return
    editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 }).run()
    editor.chain().focus().setAnynoteTextColor(color).run()
    handleClose()
  }

  const handleBackground = (color: BackgroundColorKey) => {
    if (pos == null || !node) return
    editor.chain().focus().setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 }).run()
    editor.chain().focus().setBlockBackground(color).run()
    handleClose()
  }

  const handleDuplicate = () => {
    if (pos == null) return
    duplicateBlock(editor, pos)
    handleClose()
  }

  const handleDelete = () => {
    if (pos == null || !node) return
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
    handleClose()
  }

  const handleMove = () => {
    if (pos == null) return
    onRequestMove(pos)
    handleClose()
  }

  return (
    <>
      <Menu
        open={Boolean(anchorEl && pos != null)}
        anchorEl={anchorEl}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        <MenuItem disabled dense>
          <Typography variant="caption" color="text.secondary">
            {displayName}
          </Typography>
        </MenuItem>

        {convertible && (
          <MenuItem onClick={handleOpenSubmenu("convert")}>
            <ListItemIcon>
              <SyncAltOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Превратить в</ListItemText>
            <Typography variant="caption" color="text.secondary">▸</Typography>
          </MenuItem>
        )}

        <MenuItem onClick={handleOpenSubmenu("color")}>
          <ListItemIcon>
            <FormatPaintOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Цвет</ListItemText>
          <Typography variant="caption" color="text.secondary">▸</Typography>
        </MenuItem>

        <Divider />

        <MenuItem onClick={handleDuplicate}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Дубликат</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleMove}>
          <ListItemIcon>
            <ShortcutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Переместить</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" sx={{ color: "error.main" }} />
          </ListItemIcon>
          <ListItemText>Удалить</ListItemText>
        </MenuItem>
      </Menu>

      <Menu
        open={submenu === "convert" && Boolean(submenuAnchor)}
        anchorEl={submenuAnchor}
        onClose={() => setSubmenu(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        {(Object.keys(CONVERSION_LABELS) as ConversionTarget[]).map((target) => (
          <MenuItem key={target} onClick={() => handleConvert(target)}>
            {CONVERSION_LABELS[target]}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={submenu === "color" && Boolean(submenuAnchor)}
        anchorEl={submenuAnchor}
        onClose={() => setSubmenu(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
      >
        <MenuItem disabled dense>
          <Typography variant="caption" color="text.secondary">Цвет текста</Typography>
        </MenuItem>
        {TEXT_COLOR_KEYS.map((key) => (
          <MenuItem key={`t-${key}`} onClick={() => handleTextColor(key)}>
            <ListItemIcon>
              <Swatch color={textColorSwatch(key)} />
            </ListItemIcon>
            <ListItemText>{TEXT_COLOR_LABELS[key]}</ListItemText>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem disabled dense>
          <Typography variant="caption" color="text.secondary">Фон</Typography>
        </MenuItem>
        {BACKGROUND_COLOR_KEYS.map((key) => (
          <MenuItem key={`b-${key}`} onClick={() => handleBackground(key)}>
            <ListItemIcon>
              <Swatch color={backgroundColorSwatch(key)} />
            </ListItemIcon>
            <ListItemText>{BACKGROUND_COLOR_LABELS[key]}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

function Swatch({ color }: { color: string }) {
  return (
    <Box
      sx={{
        width: 14,
        height: 14,
        borderRadius: 0.5,
        border: "1px solid",
        borderColor: "divider",
        backgroundColor: color === "transparent" ? "transparent" : color,
      }}
    />
  )
}
```

Verify `@repo/ui/components` exports all used icons (`SyncAltOutlinedIcon`, `FormatPaintOutlinedIcon`, `ContentCopyIcon`, `DeleteIcon`, `ShortcutIcon`, `Divider`, `ListItemIcon`, `ListItemText`, `Menu`, `MenuItem`, `Stack`). Add missing re-exports in `packages/ui/src/components/index.ts`.

- [ ] **Step 2: Commit**

```bash
git add packages/editor/src/components/drag-handle-menu.tsx packages/ui/src/components/index.ts
git commit -m "feat(editor): drag handle menu component (without move)"
```

---

### Task 12: Wire menu into drag handle

**Files:**
- Modify: `packages/editor/src/components/drag-handle.tsx`
- Modify: `packages/editor/src/anynote-editor.tsx`

- [ ] **Step 1: Update drag handle to open menu on click**

Open `packages/editor/src/components/drag-handle.tsx` (113 lines). Keep existing drag functionality. Add local menu state and trigger on click of the `DragIndicatorIcon`:

Before the return, add:

```tsx
const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
const [menuPos, setMenuPos] = useState<number | null>(null)

const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) => {
  e.stopPropagation()
  const pos = /* however the component gets current hovered-block pos */
  setMenuAnchor(e.currentTarget)
  setMenuPos(pos)
}
```

Read the existing component first to see how it computes the hovered block position. `@tiptap/extension-drag-handle-react` exposes the node/pos through its render prop. Adapt this based on the actual API:

```tsx
<DragHandle editor={editor} render={({ node, pos }) => (
  <div className="tiptap-drag-handle">
    {/* existing drag icon + plus button */}
    <IconButton onClick={(e) => { setMenuAnchor(e.currentTarget); setMenuPos(pos) }}>
      <DragIndicatorIcon />
    </IconButton>
    ...
  </div>
)} />
<DragHandleMenu
  editor={editor}
  anchorEl={menuAnchor}
  pos={menuPos}
  onClose={() => { setMenuAnchor(null); setMenuPos(null) }}
  onRequestMove={(pos) => onRequestBlockMove?.(pos)}
/>
```

- [ ] **Step 2: Forward `onRequestBlockMove` from AnyNoteEditor**

Open `packages/editor/src/anynote-editor.tsx`. Add optional prop:

```ts
type AnyNoteEditorProps = {
  // ... existing
  onRequestBlockMove?: (pos: number) => void
}
```

Pass it through to the drag handle component.

- [ ] **Step 3: Temporary pass-through — no-op in host**

In `apps/web/src/components/page/page-renderer.tsx`, when rendering `<AnyNoteEditor>`, don't pass `onRequestBlockMove` yet — the menu's "Переместить" will silently no-op. That's fine; we wire it in Task 14.

- [ ] **Step 4: Smoke test**

Run dev. Open a text page. Hover a paragraph; drag-handle appears. Click the drag indicator icon; menu opens showing block name + all actions. Try "Превратить в → Заголовок 1" on a paragraph. Try "Цвет → текст → Красный". Try "Дубликат". Try "Удалить". All should work; "Переместить" opens a not-yet-wired callback (no-op).

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/components/drag-handle.tsx packages/editor/src/anynote-editor.tsx
git commit -m "feat(editor): drag handle click opens block menu"
```

---

## Phase 4 — Block Move Across Pages

### Task 13: Extract PageTreePicker from MovePageDialog

**Files:**
- Create: `apps/web/src/components/workspace/page-tree-picker.tsx`
- Modify: `apps/web/src/components/workspace/move-page-dialog.tsx`

- [ ] **Step 1: Read the existing MovePageDialog**

```bash
cat apps/web/src/components/workspace/move-page-dialog.tsx
```

Identify the recursive `MoveTreeItem` component and the tree rendering section.

- [ ] **Step 2: Create `page-tree-picker.tsx`**

Extract the tree rendering (root + recursive items) into a reusable component. Example shape:

```tsx
"use client"

import { useState } from "react"
import {
  Box,
  FolderIcon,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"

type Props = {
  workspaceId: string
  // Optional set of page IDs to hide (e.g., to exclude the page being moved and its descendants)
  excludePageIds?: Set<string>
  // null = root
  onSelect: (pageId: string | null) => void
  selectedId?: string | null
}

export function PageTreePicker({ workspaceId, excludePageIds, onSelect, selectedId }: Props) {
  const list = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const pages = list.data ?? []
  const tree = buildTree(pages, excludePageIds)

  return (
    <List dense>
      <ListItemButton selected={selectedId === null} onClick={() => onSelect(null)}>
        <ListItemIcon><FolderIcon fontSize="small" /></ListItemIcon>
        <ListItemText>Корень пространства</ListItemText>
      </ListItemButton>
      {tree.map((node) => (
        <TreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </List>
  )
}

type TreeNode = { id: string; title: string | null; icon: string | null; children: TreeNode[] }

function buildTree(
  pages: Array<{ id: string; title: string | null; icon: string | null; parentId: string | null }>,
  exclude?: Set<string>,
): TreeNode[] {
  const byParent = new Map<string | null, TreeNode[]>()
  for (const p of pages) {
    if (exclude?.has(p.id)) continue
    const node: TreeNode = { id: p.id, title: p.title, icon: p.icon, children: [] }
    const list = byParent.get(p.parentId) ?? []
    list.push(node)
    byParent.set(p.parentId, list)
  }
  for (const nodes of byParent.values()) {
    for (const n of nodes) n.children = byParent.get(n.id) ?? []
  }
  return byParent.get(null) ?? []
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: TreeNode
  depth: number
  selectedId?: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ListItemButton
        selected={selectedId === node.id}
        onClick={() => onSelect(node.id)}
        sx={{ pl: 2 + depth * 2 }}
      >
        {node.children.length > 0 ? (
          <Box
            component="span"
            sx={{ mr: 1, cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((v) => !v)
            }}
          >
            {open ? "▾" : "▸"}
          </Box>
        ) : (
          <Box component="span" sx={{ mr: 1, width: 12 }} />
        )}
        <ListItemIcon sx={{ minWidth: 28 }}>
          {node.icon ? <Typography>{node.icon}</Typography> : <FolderIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText primary={node.title?.trim() || "Новая страница"} />
      </ListItemButton>
      {open &&
        node.children.map((c) => (
          <TreeRow
            key={c.id}
            node={c}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </>
  )
}
```

Adapt to follow any existing patterns observed in the original `move-page-dialog.tsx` (e.g., if the original uses a specific icon set for pages, use the same).

- [ ] **Step 3: Update `MovePageDialog` to compose `PageTreePicker`**

Modify `move-page-dialog.tsx` to replace the inline tree with `<PageTreePicker ... />`. Keep the dialog's Submit button and move-page mutation logic.

- [ ] **Step 4: Type-check and smoke test**

```bash
pnpm run check-types
```

Expected: no errors.

Open the sidebar page context menu on a nested page, pick "Переместить". The dialog should render the tree the same as before. Confirm move still works.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-picker.tsx apps/web/src/components/workspace/move-page-dialog.tsx
git commit -m "refactor(web): extract PageTreePicker from MovePageDialog"
```

---

### Task 14: Block move logic (headless Yjs insert)

**Files:**
- Create: `packages/editor/src/lib/block-move.ts`
- Create: `packages/editor/src/components/block-move-dialog.tsx`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Write `block-move.ts`**

Content:

```ts
import type { Editor } from "@tiptap/core"
import { HocuspocusProvider } from "@hocuspocus/provider"
import * as Y from "yjs"
import { prosemirrorJSONToYDoc } from "y-prosemirror"

type MoveBlockParams = {
  editor: Editor
  sourcePos: number
  targetPageId: string
  yjsUrl: string
  token: string
  fragmentField?: string  // defaults to "prosemirror"
}

export type MoveBlockResult = { ok: true } | { ok: false; error: string }

// 1. Serialize block at sourcePos to JSON.
// 2. Open a background HocuspocusProvider for targetPageId and wait for sync.
// 3. Build a transient Y.Doc from a synthetic { type: "doc", content: [blockJson] }
//    using prosemirrorJSONToYDoc, then clone its XML children into the target
//    Y.Doc's prosemirror fragment.
// 4. Remove block from source editor (local change; Yjs syncs out).
// 5. Disconnect background provider.
export async function moveBlockToPage({
  editor,
  sourcePos,
  targetPageId,
  yjsUrl,
  token,
  fragmentField = "prosemirror",
}: MoveBlockParams): Promise<MoveBlockResult> {
  const node = editor.state.doc.nodeAt(sourcePos)
  if (!node) return { ok: false, error: "Block not found at source position" }
  const json = node.toJSON()
  const nodeSize = node.nodeSize

  const yDoc = new Y.Doc()
  const provider = new HocuspocusProvider({
    url: yjsUrl,
    name: targetPageId,
    document: yDoc,
    token,
    connect: true,
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Sync timeout")), 10_000)
      provider.on("synced", () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    // Wrap the single block in a synthetic doc so y-prosemirror can materialize
    // its XML representation end-to-end (prosemirrorJSONToYDoc expects a doc-level
    // prosemirror JSON tree as input).
    const syntheticDoc = { type: "doc", content: [json] }
    const tempYDoc = prosemirrorJSONToYDoc(editor.schema, syntheticDoc, fragmentField)
    const tempFragment = tempYDoc.getXmlFragment(fragmentField)

    // Clone each top-level child (our moved block) and push into the target doc.
    const targetFragment = yDoc.getXmlFragment(fragmentField)
    yDoc.transact(() => {
      for (const child of tempFragment.toArray()) {
        if (child instanceof Y.XmlElement) {
          targetFragment.push([child.clone()])
        } else if (child instanceof Y.XmlText) {
          targetFragment.push([child.clone()])
        }
      }
    })

    tempYDoc.destroy()

    // Wait a tick for the update to propagate through Hocuspocus to the server.
    await new Promise<void>((resolve) => setTimeout(resolve, 150))

    editor.chain().focus().deleteRange({ from: sourcePos, to: sourcePos + nodeSize }).run()

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    provider.destroy()
    yDoc.destroy()
  }
}
```

Note: `y-prosemirror`'s exact export shape for `prosemirrorJSONToYXmlFragment` may differ. If needed, use `prosemirrorToYXmlFragment` with a ProseMirror `Node` built via `schema.nodeFromJSON(json)`. Adapt at implementation time based on the installed version.

- [ ] **Step 2: Write `BlockMoveDialog`**

Content of `packages/editor/src/components/block-move-dialog.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { ReactNode } from "react"

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@repo/ui/components"

type Props = {
  open: boolean
  onClose: () => void
  onConfirm: (targetPageId: string) => void
  busy?: boolean
  treePicker: ReactNode  // consumer supplies a <PageTreePicker onSelect={setSelected} selectedId={selected}/>
  selectedId: string | null
}

export function BlockMoveDialog({
  open,
  onClose,
  onConfirm,
  busy,
  treePicker,
  selectedId,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Переместить блок на страницу</DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 480, overflow: "auto" }}>
        {treePicker}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={() => selectedId && onConfirm(selectedId)}
          disabled={!selectedId || busy}
          variant="contained"
        >
          {busy ? "Перемещение…" : "Переместить"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

This is deliberately decoupled from tRPC / trpc clients (so the editor package stays framework-free). The host (page-renderer) passes the `<PageTreePicker>` as a child.

- [ ] **Step 3: Export from package**

Edit `packages/editor/src/index.ts` and add:

```ts
export { BlockMoveDialog } from "./components/block-move-dialog"
export { moveBlockToPage } from "./lib/block-move"
export type { MoveBlockResult } from "./lib/block-move"
```

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/lib/block-move.ts packages/editor/src/components/block-move-dialog.tsx packages/editor/src/index.ts
git commit -m "feat(editor): block move dialog + headless Yjs insert logic"
```

---

### Task 15: Wire block move into page-renderer

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Add state + dialog mount**

Open `apps/web/src/components/page/page-renderer.tsx`. Inside the component that mounts `<AnyNoteEditor>`, add:

```tsx
const [movePos, setMovePos] = useState<number | null>(null)
const [moveTargetId, setMoveTargetId] = useState<string | null>(null)
const [moveBusy, setMoveBusy] = useState(false)

const editorRef = useRef<Editor | null>(null)

const tokenQuery = trpc.yjs.issueToken.useMutation()  // or wherever the token endpoint lives
const router = useRouter()
const { workspaceId } = useParams()

const handleMoveConfirm = async () => {
  if (movePos == null || !moveTargetId || !editorRef.current) return
  setMoveBusy(true)
  try {
    const { token } = await tokenQuery.mutateAsync({})
    const result = await moveBlockToPage({
      editor: editorRef.current,
      sourcePos: movePos,
      targetPageId: moveTargetId,
      yjsUrl: process.env.NEXT_PUBLIC_YJS_URL!,
      token,
    })
    if (result.ok) {
      router.push(`/workspaces/${workspaceId}/pages/${moveTargetId}`)
    } else {
      // Surface via snackbar; project's snackbar pattern should be reused.
      console.error("moveBlockToPage failed:", result.error)
    }
  } finally {
    setMoveBusy(false)
    setMovePos(null)
    setMoveTargetId(null)
  }
}
```

Ensure `editorRef` is captured by forwarding `onCreate={(e) => (editorRef.current = e.editor)}` (or the project's equivalent editor-instance callback) on `<AnyNoteEditor>`. The exact hook depends on `AnyNoteEditor`'s API — add a new prop `onReady?: (editor: Editor) => void` if needed and call it internally once the editor mounts.

Pass to `<AnyNoteEditor>`:

```tsx
<AnyNoteEditor
  ...
  onRequestBlockMove={(pos) => setMovePos(pos)}
  onReady={(ed) => (editorRef.current = ed)}
/>
```

Mount the dialog:

```tsx
<BlockMoveDialog
  open={movePos != null}
  onClose={() => setMovePos(null)}
  onConfirm={handleMoveConfirm}
  busy={moveBusy}
  selectedId={moveTargetId}
  treePicker={
    <PageTreePicker
      workspaceId={workspaceId as string}
      onSelect={setMoveTargetId}
      selectedId={moveTargetId}
      excludePageIds={new Set([pageId])}
    />
  }
/>
```

- [ ] **Step 2: Locate the yjs token endpoint**

Find how `apps/web` currently fetches the Yjs JWT. Search:

```bash
grep -rn "yjs/token\|issueToken\|BETTER_AUTH_JWT_AUDIENCE" apps/web/src | head -20
```

Use the same call pattern. It's commonly an API route or a tRPC mutation.

- [ ] **Step 3: Add `onReady` prop to AnyNoteEditor if missing**

Open `packages/editor/src/anynote-editor.tsx`. Find where the `useEditor` hook runs. Add:

```ts
onCreate: ({ editor }) => {
  props.onReady?.(editor)
},
```

(Merging with existing onCreate if present.)

And add `onReady?: (editor: Editor) => void` to props.

- [ ] **Step 4: Smoke test block move**

Create two text pages. On page A, type something. Open drag-handle menu on that paragraph, click "Переместить". Pick page B in the tree. Confirm. Page A should lose the paragraph, navigate to page B, which now has the paragraph at the end.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx packages/editor/src/anynote-editor.tsx
git commit -m "feat(editor): wire block move across pages in page-renderer"
```

---

## Phase 5 — Page Actions in Breadcrumbs

### Task 16: Extract `usePageActions` hook

**Files:**
- Create: `apps/web/src/hooks/use-page-actions.tsx`
- Modify: `apps/web/src/components/workspace/page-context-menu.tsx`

- [ ] **Step 1: Read existing context-menu logic**

```bash
cat apps/web/src/components/workspace/page-context-menu.tsx
```

Identify: how favorites are toggled, how duplicate/move/delete run, where snackbars come from, how the page list is invalidated.

- [ ] **Step 2: Write the hook**

Content of `apps/web/src/hooks/use-page-actions.tsx`:

```tsx
"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@repo/ui/components"

import { MovePageDialog } from "@/components/workspace/move-page-dialog"
import { trpc } from "@/trpc/client"

export type UsePageActionsResult = {
  isFavorite: boolean
  toggleFavorite: () => void
  copyLink: () => Promise<void>
  duplicate: () => void
  openMoveDialog: () => void
  openDeleteDialog: () => void
  dialogs: ReactNode
}

export function usePageActions(pageId: string, workspaceId: string): UsePageActionsResult {
  const router = useRouter()
  const utils = trpc.useUtils()
  const query = trpc.page.getById.useQuery({ id: pageId })
  const isFavorite = Boolean(query.data?.isFavorite)

  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const addFavorite = trpc.page.addFavorite.useMutation({
    onMutate: async () => {
      await utils.page.getById.cancel({ id: pageId })
      const prev = utils.page.getById.getData({ id: pageId })
      utils.page.getById.setData({ id: pageId }, (data) =>
        data ? { ...data, isFavorite: true } : data,
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.page.getById.setData({ id: pageId }, ctx.prev)
    },
    onSettled: () => {
      void utils.page.getById.invalidate({ id: pageId })
      void utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const removeFavorite = trpc.page.removeFavorite.useMutation({
    onMutate: async () => {
      await utils.page.getById.cancel({ id: pageId })
      const prev = utils.page.getById.getData({ id: pageId })
      utils.page.getById.setData({ id: pageId }, (data) =>
        data ? { ...data, isFavorite: false } : data,
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) utils.page.getById.setData({ id: pageId }, ctx.prev)
    },
    onSettled: () => {
      void utils.page.getById.invalidate({ id: pageId })
      void utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const duplicate = trpc.page.duplicate.useMutation({
    onSuccess: (newPage) => {
      void utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${newPage.id}`)
    },
  })

  const softDelete = trpc.page.softDelete.useMutation({
    onSuccess: () => {
      void utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/app`)
    },
  })

  const toggleFavorite = () => {
    if (isFavorite) removeFavorite.mutate({ id: pageId })
    else addFavorite.mutate({ id: pageId })
  }

  const copyLink = async () => {
    const url = `${window.location.origin}/workspaces/${workspaceId}/pages/${pageId}`
    await navigator.clipboard.writeText(url)
  }

  const dialogs = (
    <>
      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        pageId={pageId}
        workspaceId={workspaceId}
      />
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogTitle>Удалить страницу?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Страница будет перемещена в корзину. Вы сможете восстановить её оттуда.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Отмена</Button>
          <Button
            color="error"
            onClick={() => {
              softDelete.mutate({ id: pageId })
              setDeleteOpen(false)
            }}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )

  return {
    isFavorite,
    toggleFavorite,
    copyLink,
    duplicate: () => duplicate.mutate({ id: pageId }),
    openMoveDialog: () => setMoveOpen(true),
    openDeleteDialog: () => setDeleteOpen(true),
    dialogs,
  }
}
```

Adjust mutation input shapes to match actual tRPC procedures (e.g., `duplicate.mutate({ id: pageId })` vs `{ pageId }`).

- [ ] **Step 3: Refactor page-context-menu.tsx to use the hook**

Open `apps/web/src/components/workspace/page-context-menu.tsx`. Replace the inline mutations with hook calls:

```tsx
const actions = usePageActions(pageId, workspaceId)
// In menu items, call actions.toggleFavorite(), actions.duplicate(), etc.
// Render {actions.dialogs} next to the <Menu>.
```

- [ ] **Step 4: Type-check**

```bash
pnpm run check-types
```

Expected: no errors.

- [ ] **Step 5: Smoke test sidebar context menu**

Open the sidebar, right-click (or click three-dot) on a page, verify all existing actions still work (favorite toggle, copy link, duplicate, move, delete).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/use-page-actions.tsx apps/web/src/components/workspace/page-context-menu.tsx
git commit -m "refactor(web): extract usePageActions shared hook"
```

---

### Task 17: FavoriteStar + useFullWidth + PageActionsMenu (without export)

**Files:**
- Create: `apps/web/src/components/page/favorite-star.tsx`
- Create: `apps/web/src/hooks/use-full-width.ts`
- Create: `apps/web/src/components/page/page-actions-menu.tsx`

- [ ] **Step 1: Write FavoriteStar**

```tsx
"use client"

import { IconButton, StarBorderIcon, StarIcon } from "@repo/ui/components"
import { usePageActions } from "@/hooks/use-page-actions"

export function FavoriteStar({
  pageId,
  workspaceId,
}: {
  pageId: string
  workspaceId: string
}) {
  const { isFavorite, toggleFavorite } = usePageActions(pageId, workspaceId)
  return (
    <IconButton
      size="small"
      onClick={toggleFavorite}
      aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
    >
      {isFavorite ? (
        <StarIcon sx={{ color: "warning.main", fontSize: 20 }} />
      ) : (
        <StarBorderIcon sx={{ fontSize: 20 }} />
      )}
    </IconButton>
  )
}
```

Confirm `StarIcon` and `StarBorderIcon` are re-exported from `@repo/ui/components`. Add to the barrel if missing.

- [ ] **Step 2: Write `useFullWidth`**

```ts
"use client"

import { useCallback, useEffect, useState } from "react"

const KEY = (pageId: string) => `anynote.page-full-width.${pageId}`

export function useFullWidth(pageId: string) {
  const [fullWidth, setFullWidthState] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY(pageId))
      setFullWidthState(raw === "true")
    } catch {
      // SSR or localStorage blocked — stay with default
    }
  }, [pageId])

  const setFullWidth = useCallback(
    (next: boolean) => {
      setFullWidthState(next)
      try {
        localStorage.setItem(KEY(pageId), String(next))
      } catch {
        /* ignore */
      }
    },
    [pageId],
  )

  return [fullWidth, setFullWidth] as const
}
```

- [ ] **Step 3: Write PageActionsMenu (without export)**

```tsx
"use client"

import { useState, type MouseEvent } from "react"
import {
  ContentCopyIcon,
  DeleteIcon,
  Divider,
  HeightIcon,
  IconButton,
  LinkIcon,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  PublishIcon,
  ShortcutIcon,
  Switch,
} from "@repo/ui/components"

import { usePageActions } from "@/hooks/use-page-actions"
import { useFullWidth } from "@/hooks/use-full-width"
import { PageExportDialog } from "./page-export-dialog"

type Props = {
  pageId: string
  workspaceId: string
  pageType: "TEXT" | "EXCALIDRAW"
}

export function PageActionsMenu({ pageId, workspaceId, pageType }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const actions = usePageActions(pageId, workspaceId)
  const [fullWidth, setFullWidth] = useFullWidth(pageId)

  const openMenu = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget)
  const closeMenu = () => setAnchor(null)

  return (
    <>
      <IconButton size="small" onClick={openMenu} aria-label="Действия страницы">
        <MoreHorizIcon fontSize="small" />
      </IconButton>

      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={closeMenu}>
        <MenuItem onClick={() => { void actions.copyLink(); closeMenu() }}>
          <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Копировать ссылку</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { actions.duplicate(); closeMenu() }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Копия</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { actions.openMoveDialog(); closeMenu() }}>
          <ListItemIcon><ShortcutIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Переместить</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { actions.openDeleteDialog(); closeMenu() }} sx={{ color: "error.main" }}>
          <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: "error.main" }} /></ListItemIcon>
          <ListItemText>Удалить</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => setFullWidth(!fullWidth)}>
          <ListItemIcon>
            <HeightIcon fontSize="small" sx={{ transform: "rotate(90deg)" }} />
          </ListItemIcon>
          <ListItemText>Полноэкранный</ListItemText>
          <Switch checked={fullWidth} edge="end" size="small" />
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => { setExportOpen(true); closeMenu() }}
          disabled={pageType !== "TEXT"}
        >
          <ListItemIcon><PublishIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Экспортировать</ListItemText>
        </MenuItem>
      </Menu>

      {actions.dialogs}

      <PageExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        pageId={pageId}
        workspaceId={workspaceId}
      />
    </>
  )
}
```

Note: `PageExportDialog` is created in Task 18. Until then, either create an empty stub or inline-skip the component.

- [ ] **Step 4: Stub PageExportDialog**

Create `apps/web/src/components/page/page-export-dialog.tsx` as a stub:

```tsx
"use client"

export function PageExportDialog(props: {
  open: boolean
  onClose: () => void
  pageId: string
  workspaceId: string
}) {
  if (!props.open) return null
  return null // TODO implemented in Task 18
}
```

We replace it in Task 18.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/favorite-star.tsx apps/web/src/hooks/use-full-width.ts apps/web/src/components/page/page-actions-menu.tsx apps/web/src/components/page/page-export-dialog.tsx
git commit -m "feat(web): favorite star, full-width hook, page actions menu"
```

---

### Task 18: PageExportDialog with PDF / HTML / Markdown

**Files:**
- Create: `apps/web/src/lib/editor-to-markdown.ts`
- Modify: `apps/web/src/components/page/page-export-dialog.tsx`
- Modify: `apps/web/package.json` (new `turndown` dep)
- Modify: `packages/editor/src/anynote-editor.tsx` (expose editor via ref)

- [ ] **Step 1: Install turndown**

```bash
pnpm --filter web add turndown
pnpm --filter web add -D @types/turndown
```

Expected: packages added to `apps/web/package.json`.

- [ ] **Step 2: Write turndown config**

Content of `apps/web/src/lib/editor-to-markdown.ts`:

```ts
import TurndownService from "turndown"

export function editorHtmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  })

  // Callout: blockquote with emoji prefix
  td.addRule("callout", {
    filter: (n) => n.nodeName === "DIV" && (n as HTMLElement).dataset?.type === "callout",
    replacement: (content, node) => {
      const icon = (node as HTMLElement).dataset?.icon ?? "💡"
      return `\n\n> ${icon} ${content.trim()}\n\n`
    },
  })

  // Toggle: <details><summary>...</summary>...</details>
  td.addRule("toggle", {
    filter: (n) => n.nodeName === "DIV" && (n as HTMLElement).dataset?.type === "toggle",
    replacement: (content) => {
      const lines = content.trim().split("\n")
      const summary = lines[0] ?? ""
      const body = lines.slice(1).join("\n")
      return `\n\n<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`
    },
  })

  // HiddenText: wrap in a span with class="hidden" (best-effort)
  td.addRule("hiddenText", {
    filter: (n) => n.nodeName === "DIV" && (n as HTMLElement).dataset?.type === "hidden-text",
    replacement: (content) => `<span class="hidden">${content.trim()}</span>`,
  })

  // FileAttachment: [filename](url)
  td.addRule("fileAttachment", {
    filter: (n) => n.nodeName === "DIV" && (n as HTMLElement).dataset?.type === "file-attachment",
    replacement: (_content, node) => {
      const el = node as HTMLElement
      const name = el.dataset?.name ?? "file"
      const url = el.dataset?.url ?? "#"
      return `[${name}](${url})`
    },
  })

  // PageLink: rely on existing <a> which should be emitted by renderHTML.
  // No special rule needed if renderHTML produces an anchor.

  return td.turndown(html)
}
```

- [ ] **Step 3: Expose editor HTML via ref/registry**

The export dialog needs access to the editor instance for the current page. Simplest approach: reuse `editorRef` created in Task 15. Add a second callback to `AnyNoteEditor`'s `onReady` that export dialog can call through a context.

Create a minimal React context in `apps/web/src/components/page/editor-context.tsx`:

```tsx
"use client"

import { createContext, useContext, useRef, type ReactNode } from "react"
import type { Editor } from "@tiptap/core"

const Ctx = createContext<{ editor: Editor | null; setEditor: (e: Editor | null) => void } | null>(
  null,
)

export function PageEditorProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Editor | null>(null)
  const setEditor = (e: Editor | null) => { ref.current = e }
  return (
    <Ctx.Provider value={{ editor: ref.current, setEditor }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCurrentEditor(): Editor | null {
  const v = useContext(Ctx)
  return v?.editor ?? null
}
```

Register in page-renderer: wrap rendering of the text editor with `<PageEditorProvider>`. Pass `setEditor` as `onReady` to `AnyNoteEditor`.

- [ ] **Step 4: Implement the dialog**

Replace stub in `apps/web/src/components/page/page-export-dialog.tsx`:

```tsx
"use client"

import { useCallback } from "react"
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { editorHtmlToMarkdown } from "@/lib/editor-to-markdown"
import { useCurrentEditor } from "./editor-context"

type Props = {
  open: boolean
  onClose: () => void
  pageId: string
  workspaceId: string
}

export function PageExportDialog({ open, onClose, pageId }: Props) {
  const editor = useCurrentEditor()
  const pageQ = trpc.page.getById.useQuery({ id: pageId }, { enabled: open })
  const title = (pageQ.data?.title?.trim() || "Без названия") + ""

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportMarkdown = useCallback(() => {
    if (!editor) return
    const html = editor.getHTML()
    const md = editorHtmlToMarkdown(html)
    downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${title}.md`)
    onClose()
  }, [editor, title, onClose])

  const exportHtml = useCallback(() => {
    if (!editor) return
    const body = editor.getHTML()
    const doc = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 32px auto; padding: 0 16px; line-height: 1.6; }
pre { background: #f4f4f5; padding: 12px; border-radius: 6px; overflow: auto; }
blockquote { border-left: 3px solid #d4d4d8; padding-left: 12px; color: #555; }
img { max-width: 100%; height: auto; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`
    downloadBlob(new Blob([doc], { type: "text/html;charset=utf-8" }), `${title}.html`)
    onClose()
  }, [editor, title, onClose])

  const exportPdf = useCallback(() => {
    const style = document.createElement("style")
    style.setAttribute("data-print-override", "true")
    style.textContent = `
      @media print {
        nav, aside, .workspace-sidebar, .workspace-toolbar, .tiptap-drag-handle,
        .slash-menu-popover, .page-actions-toolbar { display: none !important; }
        body { padding: 0; margin: 0; }
        .anynote-editor { max-width: none !important; padding: 24px !important; }
        @page { margin: 18mm; }
      }
    `
    document.head.appendChild(style)
    const cleanup = () => {
      style.remove()
      window.removeEventListener("afterprint", cleanup)
    }
    window.addEventListener("afterprint", cleanup)
    window.print()
    onClose()
  }, [onClose])

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Экспортировать страницу</DialogTitle>
      <DialogContent>
        <DialogContentText>Выберите формат для экспорта.</DialogContentText>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" onClick={exportPdf}>PDF</Button>
          <Button variant="contained" onClick={exportMarkdown}>Markdown</Button>
          <Button variant="contained" onClick={exportHtml}>HTML</Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
```

Add CSS classes `.workspace-sidebar`, `.workspace-toolbar`, `.slash-menu-popover`, `.page-actions-toolbar` to the relevant components so the print media query targets them. If the current layout uses MUI Box without these class names, add `className="workspace-sidebar"` etc.

- [ ] **Step 5: Smoke test each export**

- Create a text page with a paragraph, a heading, a list, and an image.
- Open actions menu → Экспортировать → PDF — browser print dialog opens showing clean page.
- Export → Markdown — downloaded `.md` contains converted content.
- Export → HTML — downloaded `.html` renders correctly.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/editor-to-markdown.ts apps/web/src/components/page/page-export-dialog.tsx apps/web/src/components/page/editor-context.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): page export dialog — PDF (print), Markdown (turndown), HTML"
```

---

### Task 19: PageActionsToolbar + rightSlot wiring

**Files:**
- Create: `apps/web/src/components/page/page-actions-toolbar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-toolbar.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[wsId]/pages/[pageId]/page.tsx`

- [ ] **Step 1: Write PageActionsToolbar**

```tsx
"use client"

import { Stack } from "@repo/ui/components"

import { FavoriteStar } from "./favorite-star"
import { PageActionsMenu } from "./page-actions-menu"

export function PageActionsToolbar({
  pageId,
  workspaceId,
  pageType,
}: {
  pageId: string
  workspaceId: string
  pageType: "TEXT" | "EXCALIDRAW"
}) {
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      className="page-actions-toolbar"
    >
      <FavoriteStar pageId={pageId} workspaceId={workspaceId} />
      <PageActionsMenu pageId={pageId} workspaceId={workspaceId} pageType={pageType} />
    </Stack>
  )
}
```

- [ ] **Step 2: Add `rightSlot` to WorkspaceToolbar**

Open `apps/web/src/components/workspace/workspace-toolbar.tsx`. Add prop:

```ts
type Props = {
  breadcrumbs: Breadcrumb[]
  sidebarHidden: boolean
  onOpenSidebar: () => void
  sidebarContent: ReactNode
  rightSlot?: ReactNode
}
```

In the render, replace `<Box sx={{ flex: 1 }} />` with:

```tsx
<Box sx={{ flex: 1 }} />
{rightSlot}
```

Add `className="workspace-toolbar"` to the outer `Stack`.

- [ ] **Step 3: Pass `rightSlot` from page route**

Find the file that mounts `<WorkspaceToolbar>` for a page. Likely one of:
- `apps/web/src/app/(protected)/workspaces/[wsId]/pages/[pageId]/page.tsx`
- or a layout like `apps/web/src/app/(protected)/workspaces/[wsId]/layout.tsx`

Pass:

```tsx
<WorkspaceToolbar
  breadcrumbs={breadcrumbs}
  sidebarHidden={...}
  onOpenSidebar={...}
  sidebarContent={...}
  rightSlot={<PageActionsToolbar pageId={pageId} workspaceId={wsId} pageType={page.type} />}
/>
```

Locate using:

```bash
grep -rn "WorkspaceToolbar" apps/web/src
```

- [ ] **Step 4: Add class for sidebar so print CSS can hide it**

In the sidebar container component (probably `apps/web/src/components/workspace/workspace-sidebar.tsx` or similar), add `className="workspace-sidebar"` to its root element.

- [ ] **Step 5: Wire full-width CSS on page container**

Locate the page content wrapper that applies `max-width: 713px`. Add a `data-full-width` attribute driven by `useFullWidth(pageId)` state and a CSS rule:

```css
.page-content[data-full-width="true"] {
  max-width: none;
  padding-left: 32px;
  padding-right: 32px;
}
```

Add the class `.page-content` to the wrapper and thread the data attribute from `useFullWidth`.

- [ ] **Step 6: Smoke test**

Open a text page. Verify breadcrumbs now show: breadcrumbs ... spacer ... star + more-horiz.
- Click star → favorite toggles (sidebar "Избранное" list should pick up change).
- Click more-horiz → menu opens with all 7 items.
- Copy link → clipboard has URL.
- Duplicate → navigates to new page.
- Full-width switch → content expands.
- Export PDF → opens print dialog.
- Export MD / HTML → files download.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/page/page-actions-toolbar.tsx apps/web/src/components/workspace/workspace-toolbar.tsx apps/web/src/app/\(protected\)/workspaces/\[wsId\]/pages/\[pageId\]/page.tsx apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): page actions toolbar in breadcrumbs (star + more menu)"
```

---

## Phase 6 — Verification & Tests

### Task 20: Lint, format, typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run lint**

```bash
pnpm run lint
```

Expected: zero errors, zero warnings. Fix any issues surfacing in the new files.

- [ ] **Step 2: Run format**

```bash
pnpm run format
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm run check-types
```

Expected: no errors.

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: prettier + lint fixes after editor extensions" || true
```

(`|| true` — if there's nothing to commit, that's fine.)

---

### Task 21: Playwright E2E regression + new specs

**Files:**
- Create: `apps/e2e/editor-extensions.spec.ts`
- Possibly modify: existing specs if upload flow changes behavior due to registration

- [ ] **Step 1: Run existing E2E suite first**

Start dev server:

```bash
docker compose up -d
pnpm --filter @repo/yjs-server dev &
pnpm exec turbo run dev --filter=web &
```

Wait ~20s for server. Then:

```bash
pnpm exec playwright test apps/e2e/editor-slash-media.spec.ts apps/e2e/files.spec.ts
```

Expected: all green. If any test fails, investigate regression and fix before moving on.

- [ ] **Step 2: Write a new E2E spec covering key new flows**

Content of `apps/e2e/editor-extensions.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

const password = "SuperSecure123!"

async function signUp(page: import("@playwright/test").Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await page.goto("/sign-up")
  await page.getByRole("textbox", { name: "Email" }).fill(email)
  await page.getByRole("textbox", { name: "Фамилия" }).fill("Тестов")
  await page.getByRole("textbox", { name: "Имя" }).fill("Экст")
  await page.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await page.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await page.getByRole("button", { name: "Зарегистрироваться" }).click()
  await page.waitForURL(/\/workspaces\/new/)
  await page.getByRole("textbox", { name: "Название" }).fill("Ext Test")
  await page.getByRole("button", { name: "Создать пространство" }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)
}

async function createTextPage(page: import("@playwright/test").Page) {
  const previousUrl = page.url()
  const pagesSection = page
    .getByText("Страницы", { exact: true })
    .locator('xpath=ancestor::*[.//*[@data-testid="AddIcon"]][1]')
  await pagesSection.locator('button:has([data-testid="AddIcon"])').first().click()
  await page.getByRole("menuitem", { name: "Текст" }).click()
  await page.waitForURL(
    (url) =>
      /\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  return page.locator(".anynote-editor .ProseMirror")
}

test("slash menu inserts toggle and hidden blocks", async ({ page }) => {
  await signUp(page, "ext-slash")
  const editor = await createTextPage(page)
  await editor.click()

  await editor.press("/")
  await page.getByRole("menuitem", { name: "Переключатель" }).click()
  await expect(page.locator(".anynote-toggle")).toBeVisible()

  await editor.press("End")
  await editor.press("Enter")
  await editor.press("/")
  await page.getByRole("menuitem", { name: "Скрытый текст" }).click()
  await expect(page.locator(".anynote-hidden-text")).toBeVisible()
})

test("favorite star in breadcrumbs toggles favorite state", async ({ page }) => {
  await signUp(page, "ext-fav")
  await createTextPage(page)

  const star = page.getByRole("button", { name: "Добавить в избранное" })
  await expect(star).toBeVisible()
  await star.click()
  await expect(page.getByRole("button", { name: "Убрать из избранного" })).toBeVisible()
  // Favorites section in sidebar should now list this page
  await expect(page.getByText("Избранное")).toBeVisible()
})

test("page actions menu opens with all items", async ({ page }) => {
  await signUp(page, "ext-menu")
  await createTextPage(page)

  await page.getByRole("button", { name: "Действия страницы" }).click()
  await expect(page.getByRole("menuitem", { name: "Копировать ссылку" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Копия" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Переместить" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Удалить" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Полноэкранный" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Экспортировать" })).toBeVisible()
})

test("drag handle click opens block menu with convert submenu", async ({ page }) => {
  await signUp(page, "ext-dh")
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type("Привет мир")

  // Hover the paragraph to reveal the drag handle
  await editor.hover()
  const dragIcon = page.locator(".tiptap-drag-handle [data-testid='DragIndicatorIcon']").first()
  await dragIcon.click()

  await expect(page.getByRole("menuitem", { name: "Превратить в" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Цвет" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Дубликат" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Переместить" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Удалить" })).toBeVisible()
})
```

- [ ] **Step 3: Run new spec**

```bash
pnpm exec playwright test apps/e2e/editor-extensions.spec.ts
```

Fix any issues surfacing (selector mismatches, timing). Selectors like `data-testid="DragIndicatorIcon"` rely on MUI's `data-testid` convention — verify with the real DOM.

- [ ] **Step 4: Run full suite**

```bash
pnpm exec playwright test
```

Expected: all specs green (existing + new). Particular attention to `editor-slash-media.spec.ts` and `files.spec.ts` per the user's request.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/editor-extensions.spec.ts
git commit -m "test(e2e): editor extensions regressions and happy paths"
```

---

### Task 22: Final manual smoke

**Files:** none (manual QA)

- [ ] **Step 1: Toggle dark mode on Excalidraw page**

Create an Excalidraw page, draw a shape, toggle OS dark mode. Canvas background should match (white in light, dark in dark). Images/shapes retain their true colors.

- [ ] **Step 2: Drag-handle menu full walkthrough**

On a text page, exercise every menu item:
- Превратить: paragraph → H1 → H2 → H3 → H4 → bullet → numbered → quote → code → text (chain)
- Цвет: text-red, bg-blue, text-default, bg-default
- Дубликат: paragraph dups; image dups (with same src)
- Переместить: target another page; verify it moves; verify navigation happens
- Удалить: block disappears

- [ ] **Step 3: Toggle block behavior**

Insert toggle → collapsed → Enter on empty title opens; backspace on empty title unwraps.

- [ ] **Step 4: HiddenText**

Insert hidden-text → type; content is masked; click eye; content revealed; click eye again; masked again. Reload page — starts masked again (local state).

- [ ] **Step 5: Page actions in breadcrumbs**

Every menu item:
- Copy link → paste in URL bar → same page.
- Копия → new page with "(копия)" in title.
- Переместить → moves page.
- Удалить → confirmation → soft-deletes (check Корзина).
- Полноэкранный → content widens; persists on reload.
- Экспортировать → PDF / MD / HTML (PDF via browser print; MD/HTML download).

- [ ] **Step 6: Star toggle**

Click star → becomes filled; sidebar "Избранное" contains page. Click again → unfilled; page leaves favorites.

- [ ] **Step 7: No regressions on image/file upload**

Upload an image via `/image` slash command. Upload a file via `/file`. Both work as before.

- [ ] **Step 8: Final commit (if anything formatted)**

```bash
git status
git commit -am "chore: final polish after smoke test" || true
```

---

## Success Criteria

- [ ] All six spec features implemented.
- [ ] `pnpm run lint` — zero errors, zero warnings.
- [ ] `pnpm run format` — no diff.
- [ ] `pnpm run check-types` — zero errors.
- [ ] `pnpm exec playwright test` — all specs pass (existing + new).
- [ ] Manual smoke tests pass.
