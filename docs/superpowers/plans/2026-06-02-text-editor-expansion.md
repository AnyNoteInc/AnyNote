# Text Editor Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven self-contained improvements to the TEXT-type page editor: clipboard-image paste through the image node, drag-handle suppression on first container child, a new "Встроенные" slash group, structural date/datetime nodes, multi-line placeholder, "copy text as Markdown", and a tabbed "Вставить содержимое" dialog.

**Architecture:** Most work lives in `packages/editor` (Tiptap extensions, slash items, node views, popovers). Two web touch points: the page actions menu / `usePageActions` hook (copy text) and `server-extensions.ts` (date node export). New inline nodes follow the existing `PageLink` schema+nodeview pattern; the drag-handle change reuses the `DragHandleRule` scoring mechanism.

**Tech Stack:** Tiptap v3 / ProseMirror, React 19, MUI v6 + `@mui/x-date-pickers`, Yjs/Hocuspocus, vitest. The editor package imports `@mui/material` / `@mui/icons-material` directly (it is not app code subject to the `@repo/ui`-only rule); app code (`apps/web`) imports through `@repo/ui/components`.

**Conventions:** Prettier with `semi: false`, single quotes, 100-char width. Run `pnpm --filter @repo/editor test` for editor unit tests. After editor changes that affect rendering, manually verify on a TEXT page with `pnpm dev`.

---

## File Structure

**New files:**
- `packages/editor/src/extensions/image-paste.ts` — Tiptap extension; `handlePaste` for `image/*` → insert `image` node + upload.
- `packages/editor/src/extensions/date.schema.ts` — server-renderable date/datetime inline atom node.
- `packages/editor/src/extensions/date.tsx` — React node view (chip + picker popover).
- `packages/editor/src/extensions/date.schema.test.ts` — schema round-trip test.

**Modified files:**
- `packages/editor/src/types.ts` — extend `SlashCommandGroup` with `'inline'`; add `openDatetimePopover` to handlers type (in slash-items.ts actually).
- `packages/editor/src/slash-items.ts` — move date/datetime/pageLink/reminder to `'inline'`; date/datetime insert nodes; rename markdown item; add `openDatetimePopover` handler.
- `packages/editor/src/slash-items.test.ts` — group assertions + new handler in fixture.
- `packages/editor/src/components/slash-menu-popover.tsx` — `inline` group order + title.
- `packages/editor/src/components/drag-handle.tsx` — `excludeFirstContainerChild` rule.
- `packages/editor/src/extensions/index.ts` — register `ImagePaste`, `DateNode`.
- `packages/editor/src/extensions/server.ts` — re-export `DateSchema`.
- `packages/editor/src/extensions/placeholder.ts` — `emptyNodeClass`.
- `packages/editor/src/styles/content.css` — `.is-empty::before` rule.
- `packages/editor/src/components/date-insert-popover.tsx` — `mode` + node insertion.
- `packages/editor/src/components/markdown-upload-popover.tsx` — tabbed dialog.
- `packages/editor/src/anynote-editor.tsx` — `datetime` PopoverKind, wire handlers.
- `packages/ui/src/components/index.ts` — export `StaticDateTimePicker`.
- `apps/web/src/server/page-export/server-extensions.ts` — register `DateNode`.
- `apps/web/src/hooks/use-page-actions.tsx` — `copyText()`.
- `apps/web/src/components/page/page-actions-menu.tsx` — "Копировать текст" item.

---

## Task 1: New "Встроенные" slash group (Feature 3)

This lands first because Feature 4 (date nodes) and Feature 7 (markdown rename) edit the same `slash-items.ts` and reference the `inline` group.

**Files:**
- Modify: `packages/editor/src/types.ts`
- Modify: `packages/editor/src/components/slash-menu-popover.tsx`
- Modify: `packages/editor/src/slash-items.ts`
- Test: `packages/editor/src/slash-items.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/editor/src/slash-items.test.ts` inside the `describe('createSlashItems')` block:

```ts
it('groups date, datetime, pageLink and reminder under the inline group', () => {
  const slashItems = createSlashItems(handlers)
  const items = slashItems('')
  const groupOf = (id: string) => items.find((it) => it.id === id)?.group
  expect(groupOf('date')).toBe('inline')
  expect(groupOf('datetime')).toBe('inline')
  expect(groupOf('pageLink')).toBe('inline')
  expect(groupOf('reminder')).toBe('inline')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor test -- slash-items`
Expected: FAIL — `groupOf('date')` is `'base'`, not `'inline'`.

- [x] **Step 3: Extend the group type**

In `packages/editor/src/types.ts`, line 30, change:

```ts
export type SlashCommandGroup = 'base' | 'inline' | 'code' | 'media' | 'embedding'
```

- [x] **Step 4: Update the popover group order and titles**

In `packages/editor/src/components/slash-menu-popover.tsx`:

```ts
const GROUP_ORDER: SlashCommandGroup[] = ['base', 'inline', 'code', 'media', 'embedding']

const GROUP_TITLES: Record<SlashCommandGroup, string> = {
  base: 'Базовые блоки',
  inline: 'Встроенные',
  code: 'Код',
  media: 'Медиа',
  embedding: 'Встраиваемые',
}
```

- [x] **Step 5: Move the four items to the inline group**

In `packages/editor/src/slash-items.ts`, change `group: 'base'` to `group: 'inline'` on the `date` (line 43), `datetime` (line 244), `reminder` (line 258), and `pageLink` (line 289) items. Leave `callout`, `details`, `hidden`, etc. in `base`.

- [x] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @repo/editor test -- slash-items`
Expected: PASS (all tests in file).

- [x] **Step 7: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/components/slash-menu-popover.tsx packages/editor/src/slash-items.ts packages/editor/src/slash-items.test.ts
git commit -m "feat(editor): add Встроенные slash group for inline items"
```

---

## Task 2: Multi-line placeholder (Feature 5)

**Files:**
- Modify: `packages/editor/src/extensions/placeholder.ts`
- Modify: `packages/editor/src/styles/content.css`

No unit test (CSS + extension config, verified manually). The existing
`styles/content.test.ts` asserts CSS invariants — check it still passes.

- [x] **Step 1: Configure the empty-node class**

Replace the body of `packages/editor/src/extensions/placeholder.ts`:

```ts
import Placeholder from '@tiptap/extension-placeholder'

export const buildPlaceholder = (text: string) =>
  Placeholder.configure({
    placeholder: text,
    showOnlyWhenEditable: true,
    emptyEditorClass: 'is-editor-empty',
    // Tag every empty top-level node (not just the first) so the placeholder
    // shows on any empty line where the cursor sits.
    emptyNodeClass: 'is-empty',
  })
```

- [x] **Step 2: Add the CSS rule for empty paragraphs**

In `packages/editor/src/styles/content.css`, immediately after the existing
`p.is-editor-empty:first-child::before` rule (ends at line 38), add:

```css
.anynote-editor .ProseMirror p.is-empty::before {
  color: var(--editor-text-muted, rgba(0, 0, 0, 0.4));
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
```

- [x] **Step 3: Run the CSS invariant test**

Run: `pnpm --filter @repo/editor test -- content`
Expected: PASS (no regressions).

- [x] **Step 4: Manually verify**

Run: `pnpm dev`, open a TEXT page. Confirm: (a) empty doc shows the placeholder
on the first line; (b) pressing Enter to a new empty line shows the placeholder
there too; (c) typing text hides it on that line. If the placeholder appears on
empty table cells / nested empty paragraphs and that looks noisy, scope the
selector to direct children of `.ProseMirror`:
`.anynote-editor > .ProseMirror > p.is-empty::before`. Otherwise leave as-is.

- [x] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/placeholder.ts packages/editor/src/styles/content.css
git commit -m "feat(editor): show placeholder on every empty line"
```

---

## Task 3: Hide drag-handle on first container child (Feature 2)

**Files:**
- Modify: `packages/editor/src/components/drag-handle.tsx`

No unit test (the drag handle is integration-tested manually; the rule is a pure
scoring function but the library wiring is hard to unit test without a live
editor). Verify manually.

- [x] **Step 1: Add the rule**

In `packages/editor/src/components/drag-handle.tsx`, after the
`excludeColumnNodes` rule definition (ends line 23), add:

`RuleContext` (from `@tiptap/extension-drag-handle`) exposes `parent` and
`isFirst` directly — no manual position resolution needed. The library's own
docstring shows this exact "exclude first child" pattern.

```ts
// Container nodes own children; their FIRST child block should not show the
// + / drag controls (they belong to the container, not a standalone block).
// detailsContent is the wrapper around the toggle body; blockquote is "цитата".
const CONTAINER_PARENTS = new Set(['callout', 'detailsContent', 'hiddenText', 'blockquote'])

const excludeFirstContainerChild: DragHandleRule = {
  id: 'excludeFirstContainerChild',
  evaluate: ({ parent, isFirst }) => {
    if (isFirst && parent && CONTAINER_PARENTS.has(parent.type.name)) return 10000
    return 0
  },
}
```

- [x] **Step 2: Register the rule**

In the same file, add it to `nestedOptions.rules` (line 31):

```ts
const nestedOptions = {
  rules: [excludeColumnNodes, excludeFirstContainerChild],
  edgeDetection: 'none' as const,
}
```

- [x] **Step 3: Type-check**

Run: `pnpm check-types` (from root).
Expected: PASS. `RuleContext.evaluate` receives `{ node, pos, depth, parent, index, isFirst, isLast, $pos, view }` — `parent` and `isFirst` are used here.

- [x] **Step 4: Manually verify**

Run: `pnpm dev`. Insert a Выноска (callout), Переключатель (details), Скрытый
текст (hidden), and a Цитата (blockquote). Hover the FIRST line inside each:
the `+`/`⋮⋮` handle must NOT appear. Hover a SECOND line inside the same
container: the handle MUST appear. Hover normal top-level paragraphs: handle
appears as before.

- [x] **Step 5: Commit**

```bash
git add packages/editor/src/components/drag-handle.tsx
git commit -m "feat(editor): hide drag handle on first child of container blocks"
```

---

## Task 4: Export StaticDateTimePicker from @repo/ui (prep for Feature 4)

**Files:**
- Modify: `packages/ui/src/components/index.ts`

- [x] **Step 1: Add the export**

In `packages/ui/src/components/index.ts`, near the existing `StaticDatePicker`
export (line 194), add:

```ts
export {
  StaticDateTimePicker,
  type StaticDateTimePickerProps,
} from '@mui/x-date-pickers/StaticDateTimePicker'
```

- [x] **Step 2: Type-check the ui package**

Run: `pnpm --filter @repo/ui check-types` (or `pnpm check-types` from root).
Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export StaticDateTimePicker"
```

---

## Task 5: Structural date/datetime inline node — schema (Feature 4)

**Files:**
- Create: `packages/editor/src/extensions/date.schema.ts`
- Create: `packages/editor/src/extensions/date.schema.test.ts`
- Modify: `packages/editor/src/lib/date-format.ts` (add ISO-aware formatter helper)

- [x] **Step 1: Add an ISO-aware display formatter**

In `packages/editor/src/lib/date-format.ts`, append:

```ts
// Render a stored ISO value as ru-RU display text for a date node. Falls back
// to the raw value if it isn't a parseable date so export never emits "Invalid".
export const formatIsoForDisplay = (iso: string, kind: 'date' | 'datetime'): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return kind === 'datetime' ? formatDateTimeText(d) : formatDateText(d)
}
```

- [x] **Step 2: Write the failing schema round-trip test**

Create `packages/editor/src/extensions/date.schema.test.ts`:

```ts
import { getSchema } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'

import { DateSchema } from './date.schema'

describe('DateSchema', () => {
  it('renders a date node to a span with readable text and data attrs', () => {
    const schema = getSchema([DateSchema])
    const node = schema.nodes.date.create({ value: '2026-06-02', kind: 'date' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.getAttribute('data-type')).toBe('date')
    expect(dom.getAttribute('data-value')).toBe('2026-06-02')
    expect(dom.getAttribute('data-kind')).toBe('date')
    expect(dom.textContent).toBe('02.06.2026')
  })

  it('renders a datetime node with date and time', () => {
    const schema = getSchema([DateSchema])
    const node = schema.nodes.date.create({ value: '2026-06-02T08:30:00', kind: 'datetime' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.getAttribute('data-kind')).toBe('datetime')
    expect(dom.textContent).toContain('02.06.2026')
    expect(dom.textContent).toContain('08:30')
  })
})
```

- [x] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @repo/editor test -- date.schema`
Expected: FAIL — `./date.schema` module not found.

- [x] **Step 4: Implement the schema**

Create `packages/editor/src/extensions/date.schema.ts`:

```ts
import { Node, mergeAttributes } from '@tiptap/core'

import { formatIsoForDisplay } from '../lib/date-format'

export type DateKind = 'date' | 'datetime'

export type DateNodeAttrs = {
  value: string
  kind: DateKind
}

// Inline atom node holding an ISO `value` + `kind`. Display text is derived from
// the value so the locale/format can change later; renderHTML emits the readable
// text so MD/HTML export and "copy text" produce human-readable dates.
export const DateSchema = Node.create({
  name: 'date',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      value: { default: '' },
      kind: { default: 'date' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="date"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          const kind = el.getAttribute('data-kind') === 'datetime' ? 'datetime' : 'date'
          return { value: el.getAttribute('data-value') ?? '', kind }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as DateNodeAttrs
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'date',
        'data-value': attrs.value,
        'data-kind': attrs.kind,
      }),
      formatIsoForDisplay(attrs.value, attrs.kind),
    ]
  },
})
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @repo/editor test -- date.schema`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/editor/src/extensions/date.schema.ts packages/editor/src/extensions/date.schema.test.ts packages/editor/src/lib/date-format.ts
git commit -m "feat(editor): add date/datetime inline node schema"
```

---

## Task 6: Date node view (Feature 4)

**Files:**
- Create: `packages/editor/src/extensions/date.tsx`

No unit test (React node view with a date picker; verified manually). Mirrors
`page-link.tsx` + `date-insert-popover.tsx`.

- [x] **Step 1: Implement the node view**

Create `packages/editor/src/extensions/date.tsx`:

```tsx
'use client'

import {
  AdapterDateFns,
  Box,
  Button,
  LocalizationProvider,
  Popover,
  Stack,
  StaticDatePicker,
  StaticDateTimePicker,
  dateFnsRu,
  datePickerRuRU,
} from '@repo/ui/components'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useState } from 'react'

import { formatIsoForDisplay } from '../lib/date-format'
import { DateSchema, type DateKind, type DateNodeAttrs } from './date.schema'

function DateView({ node, updateAttributes, editor }: NodeViewProps) {
  const attrs = node.attrs as DateNodeAttrs
  const kind: DateKind = attrs.kind === 'datetime' ? 'datetime' : 'date'
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<Date | null>(null)

  const parsed = attrs.value ? new Date(attrs.value) : null
  const current = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()

  const open = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!editor.isEditable) return
    setDraft(current)
    setAnchor(event.currentTarget)
  }

  const close = () => setAnchor(null)

  const accept = (value: Date | null) => {
    const next = value ?? current
    updateAttributes({ value: next.toISOString() })
    close()
  }

  const label = attrs.value ? formatIsoForDisplay(attrs.value, kind) : 'Выбрать дату'

  return (
    <NodeViewWrapper as="span" className="anynote-date-wrapper" contentEditable={false}>
      <Box
        component="span"
        onClick={open}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.5,
          mx: 0.25,
          borderRadius: 0.75,
          color: 'primary.main',
          cursor: editor.isEditable ? 'pointer' : 'default',
          backgroundColor: 'action.hover',
          transition: 'background-color .15s',
          '&:hover': { backgroundColor: editor.isEditable ? 'action.selected' : 'action.hover' },
        }}
      >
        {kind === 'datetime' ? (
          <AccessTimeIcon sx={{ fontSize: 14 }} />
        ) : (
          <CalendarTodayIcon sx={{ fontSize: 14 }} />
        )}
        <span>{label}</span>
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 332, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        <LocalizationProvider
          dateAdapter={AdapterDateFns}
          adapterLocale={dateFnsRu}
          localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
        >
          {kind === 'datetime' ? (
            <StaticDateTimePicker
              value={draft}
              onChange={(v) => setDraft(v)}
              onAccept={(v) => accept(v)}
              onClose={close}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          ) : (
            <StaticDatePicker
              value={draft}
              onChange={(v) => setDraft(v)}
              onAccept={(v) => accept(v)}
              onClose={close}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          )}
        </LocalizationProvider>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, pb: 2 }}>
          <Button size="small" onClick={close}>
            Отмена
          </Button>
          <Button size="small" variant="contained" onClick={() => accept(draft)}>
            Сохранить
          </Button>
        </Stack>
      </Popover>
    </NodeViewWrapper>
  )
}

export const DateNode = DateSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DateView)
  },
})
```

- [x] **Step 2: Type-check**

Run: `pnpm check-types` (from root) — or build the editor package. Expected: PASS.

- [x] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/date.tsx
git commit -m "feat(editor): add date/datetime node view with picker"
```

---

## Task 7: Register date node (client + server) and wire slash insertion (Feature 4)

**Files:**
- Modify: `packages/editor/src/extensions/index.ts`
- Modify: `packages/editor/src/extensions/server.ts`
- Modify: `apps/web/src/server/page-export/server-extensions.ts`
- Modify: `packages/editor/src/slash-items.ts`
- Modify: `packages/editor/src/components/date-insert-popover.tsx`
- Modify: `packages/editor/src/anynote-editor.tsx`
- Modify: `packages/editor/src/slash-items.test.ts`

- [x] **Step 1: Register the client extension**

In `packages/editor/src/extensions/index.ts`, add the import after the `Reminder`
import (line 34):

```ts
import { DateNode } from './date'
```

Add `DateNode` to the returned extensions array (after `Reminder,` on line 115):

```ts
  Reminder,
  DateNode,
```

- [x] **Step 2: Re-export the schema from server.ts**

In `packages/editor/src/extensions/server.ts`, after the `ReminderSchema`
export (line 12):

```ts
export { DateSchema as DateNode } from './date.schema'
```

- [x] **Step 3: Register in server export extensions**

In `apps/web/src/server/page-export/server-extensions.ts`, add `DateNode` to the
import list (line 14-29):

```ts
import {
  AnynoteTextColor,
  BlockBackground,
  Callout,
  Code,
  DateNode,
  Details,
  DetailsContent,
  DetailsSummary,
  FileAttachment,
  Highlight,
  HiddenText,
  Mention,
  PageLink,
  TextStyleKit,
  Underline,
} from '@repo/editor/extensions/server'
```

Add `DateNode` to the returned array (after `PageLink,` on line 84):

```ts
    PageLink,
    DateNode,
```

- [x] **Step 4: Update slash-items to insert nodes + add datetime handler**

In `packages/editor/src/slash-items.ts`:

(a) Add `openDatetimePopover` to the handler type (after `openDatePopover` line 32):

```ts
export type SlashMediaHandlers = {
  openDatePopover: (range: SlashRange) => void
  openDatetimePopover: (range: SlashRange) => void
  openFilePopover: (range: SlashRange) => void
  openMarkdownPopover: (range: SlashRange) => void
  openPageLinkPopover: (range: SlashRange) => void
  openReminderCreate?: (reminderId: string) => void
  openDrawioCreate?: (range: SlashRange) => void
}
```

(b) The `date` item already calls `handlers.openDatePopover(range)` — leave its
`run` as is (the popover now inserts a node, see Step 5).

(c) Replace the `datetime` item's `run` (lines 248-254) to open the datetime
popover instead of inserting text:

```ts
    run: ({ range }) => handlers.openDatetimePopover(range),
```

The `formatDateTimeText` import (line 28) is no longer used by slash-items after
this — remove it from the import to satisfy lint (`--max-warnings 0`).

- [x] **Step 5: Make DateInsertPopover insert a node, with a mode**

Replace `packages/editor/src/components/date-insert-popover.tsx` body so it takes
a `mode` and inserts a `date` node:

```tsx
'use client'

import {
  AdapterDateFns,
  Box,
  Button,
  LocalizationProvider,
  Popover,
  Stack,
  StaticDatePicker,
  StaticDateTimePicker,
  dateFnsRu,
  datePickerRuRU,
} from '@repo/ui/components'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import type { SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  mode: 'date' | 'datetime'
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

export function DateInsertPopover({ open, mode, anchorEl, range, editor, onClose }: Props) {
  const [value, setValue] = useState<Date | null>(() => new Date())

  useEffect(() => {
    if (open) setValue(new Date())
  }, [open])

  const insert = useCallback(
    (date: Date | null) => {
      if (!range) return
      const selected = date ?? new Date()
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'date',
          attrs: { value: selected.toISOString(), kind: mode },
        })
        .insertContent(' ')
        .run()
      onClose()
    },
    [editor, mode, onClose, range],
  )

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 332, maxWidth: 'calc(100vw - 32px)' } } }}
    >
      <Box>
        <LocalizationProvider
          dateAdapter={AdapterDateFns}
          adapterLocale={dateFnsRu}
          localeText={datePickerRuRU.components.MuiLocalizationProvider.defaultProps.localeText}
        >
          {mode === 'datetime' ? (
            <StaticDateTimePicker
              value={value}
              onChange={(next) => setValue(next)}
              onAccept={(accepted) => insert(accepted)}
              onClose={onClose}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          ) : (
            <StaticDatePicker
              value={value}
              onChange={(next) => setValue(next)}
              onAccept={(accepted) => insert(accepted)}
              onClose={onClose}
              displayStaticWrapperAs="desktop"
              slotProps={{ actionBar: { actions: [] } }}
            />
          )}
        </LocalizationProvider>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, pb: 2 }}>
          <Button size="small" onClick={onClose}>
            Отмена
          </Button>
          <Button size="small" variant="contained" onClick={() => insert(value)}>
            Вставить
          </Button>
        </Stack>
      </Box>
    </Popover>
  )
}
```

- [x] **Step 6: Wire the datetime PopoverKind in anynote-editor**

In `packages/editor/src/anynote-editor.tsx`:

(a) Extend `PopoverKind` (line 39):

```ts
type PopoverKind = 'date' | 'datetime' | 'file' | 'markdown' | 'pageLink'
```

(b) Add the handler in the `createSlashItems` call (line 154-162):

```ts
      createSlashItems({
        openDatePopover: (range) => openKind('date', range),
        openDatetimePopover: (range) => openKind('datetime', range),
        openFilePopover: (range) => openKind('file', range),
        openMarkdownPopover: (range) => openKind('markdown', range),
        openPageLinkPopover: (range) => openKind('pageLink', range),
        openReminderCreate: props.onReminderCreate,
        openDrawioCreate,
      }),
```

(c) Replace the single `DateInsertPopover` render (lines 351-357) so both kinds
render it with the right `mode`:

```tsx
          <DateInsertPopover
            open={popover?.kind === 'date'}
            mode="date"
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            onClose={closePopover}
          />
          <DateInsertPopover
            open={popover?.kind === 'datetime'}
            mode="datetime"
            anchorEl={anchorEl}
            range={range}
            editor={editor}
            onClose={closePopover}
          />
```

- [x] **Step 7: Update the slash-items test fixture**

In `packages/editor/src/slash-items.test.ts`, add the new handler to the
`handlers` fixture (lines 5-10):

```ts
const handlers: SlashMediaHandlers = {
  openDatePopover: vi.fn(),
  openDatetimePopover: vi.fn(),
  openFilePopover: vi.fn(),
  openMarkdownPopover: vi.fn(),
  openPageLinkPopover: vi.fn(),
}
```

- [x] **Step 8: Run editor tests + type-check**

Run: `pnpm --filter @repo/editor test`
Expected: PASS (slash-items + date.schema).
Run: `pnpm check-types`
Expected: PASS.

- [x] **Step 9: Manually verify**

Run: `pnpm dev`. On a TEXT page: `/` → Встроенные → Дата → pick a date →
a calendar-icon chip appears with the formatted date. Click the chip → picker
reopens → change date → chip updates. Repeat for Дата и время (clock icon +
time). Export the page to Markdown (⋯ → Экспортировать → Markdown) and confirm
the date appears as readable text in the .md.

- [x] **Step 10: Commit**

```bash
git add packages/editor/src/extensions/index.ts packages/editor/src/extensions/server.ts apps/web/src/server/page-export/server-extensions.ts packages/editor/src/slash-items.ts packages/editor/src/components/date-insert-popover.tsx packages/editor/src/anynote-editor.tsx packages/editor/src/slash-items.test.ts
git commit -m "feat(editor): wire date/datetime nodes into slash menu and export"
```

---

## Task 8: Clipboard image paste through the image node (Feature 1)

**Files:**
- Create: `packages/editor/src/extensions/image-paste.ts`
- Modify: `packages/editor/src/extensions/index.ts`

No unit test (clipboard/ProseMirror paste handler; verified manually — the JSDOM
test env does not model `ClipboardEvent.clipboardData.files` reliably).

- [x] **Step 1: Implement the paste extension**

Create `packages/editor/src/extensions/image-paste.ts`:

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

import type { UploadHandler } from '../types'

// Intercept pasted images so they flow through the `image` node (ResizableImage):
// insert the empty placeholder immediately (same UX as /image), upload the blob,
// then set `src` by position. Non-image pastes are left untouched so FileUpload
// and the default paste behavior still run.
export const buildImagePaste = (uploadHandler: UploadHandler) =>
  Extension.create({
    name: 'imagePaste',
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: new PluginKey('imagePaste'),
          props: {
            handlePaste: (view, event) => {
              const files = Array.from(event.clipboardData?.files ?? [])
              const images = files.filter((f) => f.type.startsWith('image/'))
              if (images.length === 0) return false
              event.preventDefault()

              for (const file of images) {
                // Insert an empty image node at the current selection and capture
                // its position from the resulting doc.
                const insertPos = view.state.selection.from
                editor
                  .chain()
                  .insertContentAt(insertPos, { type: 'image', attrs: { src: null } })
                  .run()

                void uploadHandler({ blob: file, filename: file.name || 'pasted-image' })
                  .then((result) => {
                    // Find the placeholder image node at/after insertPos and set src.
                    const { doc } = editor.state
                    let target: number | null = null
                    doc.nodesBetween(
                      insertPos,
                      Math.min(insertPos + 2, doc.content.size),
                      (node, pos) => {
                        if (target === null && node.type.name === 'image' && node.attrs.src === null) {
                          target = pos
                          return false
                        }
                        return undefined
                      },
                    )
                    if (target !== null) {
                      editor.chain().command(({ tr }) => {
                        tr.setNodeAttribute(target as number, 'src', result.src)
                        return true
                      }).run()
                    }
                  })
                  .catch(() => {
                    // On failure, remove the placeholder we inserted.
                    const { doc } = editor.state
                    let target: number | null = null
                    let size = 0
                    doc.nodesBetween(
                      insertPos,
                      Math.min(insertPos + 2, doc.content.size),
                      (node, pos) => {
                        if (target === null && node.type.name === 'image' && node.attrs.src === null) {
                          target = pos
                          size = node.nodeSize
                          return false
                        }
                        return undefined
                      },
                    )
                    if (target !== null) {
                      editor.chain().command(({ tr }) => {
                        tr.delete(target as number, (target as number) + size)
                        return true
                      }).run()
                    }
                  })
              }
              return true
            },
          },
        }),
      ]
    },
  })
```

- [x] **Step 2: Register it before FileUpload**

In `packages/editor/src/extensions/index.ts`, add the import (after
`buildFileUpload` import, line 31):

```ts
import { buildImagePaste } from './image-paste'
```

Add it to the extensions array **before** `buildFileUpload(opts.uploadHandler)`
(currently line 117):

```ts
  buildImagePaste(opts.uploadHandler),
  buildFileUpload(opts.uploadHandler),
```

- [x] **Step 3: Type-check**

Run: `pnpm check-types`
Expected: PASS.

- [x] **Step 4: Manually verify**

Run: `pnpm dev`. Copy an image to the OS clipboard (e.g. screenshot). On a TEXT
page, paste (Cmd/Ctrl+V): the ResizableImage placeholder should appear briefly,
then the uploaded image renders in place. Confirm pasting plain text and pasting
a non-image file still behave as before (text inserts; files go through
FileUpload). Confirm the image is the ResizableImage node (it has the
align/caption/replace toolbar when selected), not the FileUpload node.

- [x] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/image-paste.ts packages/editor/src/extensions/index.ts
git commit -m "feat(editor): paste images through the resizable image node"
```

---

## Task 9: "Копировать текст" — copy page as Markdown (Feature 6)

**Files:**
- Modify: `apps/web/src/hooks/use-page-actions.tsx`
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`

- [x] **Step 1: Add copyText to the hook**

In `apps/web/src/hooks/use-page-actions.tsx`:

(a) Add `copyText` to the result type (lines 19-25):

```ts
export type UsePageActionsResult = {
  toggleFavorite: () => void
  copyLink: () => Promise<void>
  copyText: () => Promise<void>
  duplicate: () => void
  openDeleteConfirm: () => void
  dialogs: ReactNode
}
```

(b) Add the implementation after `copyLink` (line 65):

```ts
  // Copy the page rendered as Markdown (same output as the .md export route).
  const copyText = async () => {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/pages/${page.id}/export/md`,
      { credentials: 'same-origin' },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()
    await navigator.clipboard.writeText(md)
  }
```

(c) Add `copyText` to the returned object (lines 95-101):

```ts
  return {
    toggleFavorite,
    copyLink,
    copyText,
    duplicate,
    openDeleteConfirm,
    dialogs,
  }
```

- [x] **Step 2: Add the menu item**

In `apps/web/src/components/page/page-actions-menu.tsx`:

(a) Import a text/copy icon. Add to the `@repo/ui/components` import block
(near `ContentCopyIcon`, line 9) — use `ArticleIcon` (already a common page-text
icon); if it is not exported from `@repo/ui/components`, add an export for it in
`packages/ui/src/components/index.ts` first:

```ts
  ArticleIcon,
```

(b) Add a handler after `handleCopyLink` (line 82):

```ts
  const handleCopyText = () => {
    void actions.copyText()
    closeMenu()
  }
```

(c) Add the `MenuItem` immediately after the «Копировать ссылку» item (line 120),
gated to TEXT pages:

```tsx
        {pageType === 'TEXT' ? (
          <MenuItem onClick={handleCopyText} sx={menuItemSx}>
            <ListItemIcon>
              <ArticleIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Копировать текст</ListItemText>
          </MenuItem>
        ) : null}
```

- [x] **Step 3: Verify ArticleIcon export**

Run: `grep -n "ArticleIcon" packages/ui/src/components/index.ts`
If absent, add to `packages/ui/src/components/index.ts`:

```ts
export { default as ArticleIcon } from '@mui/icons-material/Article'
```

- [x] **Step 4: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS. (If stale `.next/types` errors about deleted routes appear, run
`rm -rf apps/web/.next/types` and retry — known artifact.)

- [x] **Step 5: Manually verify**

Run: `pnpm dev`. On a TEXT page, ⋯ menu → «Копировать текст» appears right after
«Копировать ссылку». Click it, then paste into a text editor — the page content
should appear as Markdown (starting with `# <title>`). Confirm the item is hidden
on non-TEXT pages (e.g. a Kanban/Excalidraw page).

- [x] **Step 6: Commit**

```bash
git add apps/web/src/hooks/use-page-actions.tsx apps/web/src/components/page/page-actions-menu.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): copy page text as Markdown from page actions menu"
```

---

## Task 10: "Вставить содержимое" tabbed dialog (Feature 7)

**Files:**
- Modify: `packages/editor/src/components/markdown-upload-popover.tsx`
- Modify: `packages/editor/src/slash-items.ts`

The component keeps its filename/export (`MarkdownUploadPopover`) and props so
`anynote-editor.tsx` needs no change beyond what already exists. It becomes a
centered `Dialog` with tabs; the `anchorEl` prop stays in the signature (unused
for a centered dialog) to avoid churn at the call site.

- [x] **Step 1: Convert the popover to a tabbed dialog**

Replace `packages/editor/src/components/markdown-upload-popover.tsx`:

```tsx
'use client'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import type { Editor } from '@tiptap/core'
import { marked } from 'marked'
import { useCallback, useId, useRef, useState } from 'react'

import type { SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

// Keep markdown parsing predictable and synchronous.
const parseMarkdown = (source: string): string => {
  const out = marked.parse(source, { async: false, gfm: true })
  return typeof out === 'string' ? out : ''
}

type TabKey = 'file' | 'raw' | 'clipboard'

export function MarkdownUploadPopover({ open, range, editor, onClose }: Props) {
  const [tab, setTab] = useState<TabKey>('file')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputId = useId()

  const reset = useCallback(() => {
    setBusy(false)
    setError(null)
    setRaw('')
    setTab('file')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleClose = useCallback(() => {
    if (busy) return
    reset()
    onClose()
  }, [busy, onClose, reset])

  const insert = useCallback(
    (text: string) => {
      if (!range) return false
      if (!text.trim()) {
        setError('Пусто')
        return false
      }
      editor.chain().focus().deleteRange(range).insertContent(parseMarkdown(text)).run()
      reset()
      onClose()
      return true
    },
    [editor, onClose, range, reset],
  )

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        const text = await file.text()
        if (!insert(text)) setBusy(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось разобрать Markdown')
        setBusy(false)
      }
    },
    [insert],
  )

  const handlePasteFromClipboard = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const text = await navigator.clipboard.readText()
      if (!insert(text)) setBusy(false)
    } catch {
      setError('Не удалось прочитать буфер обмена')
      setBusy(false)
    }
  }, [insert])

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Вставить содержимое</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="file" label="Из файла" />
          <Tab value="raw" label="Markdown" />
          <Tab value="clipboard" label="Из буфера" />
        </Tabs>

        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {tab === 'file' ? (
          <Stack spacing={1.5}>
            <Button
              variant="contained"
              component="label"
              htmlFor={fileInputId}
              disabled={busy}
              fullWidth
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {busy ? 'Разбор...' : 'Выбрать .md файл'}
              <input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                hidden
                accept=".md,.markdown,text/markdown"
                onChange={handleFileSelected}
              />
            </Button>
            <Typography variant="caption" color="text.secondary">
              Файл разбирается на клиенте и вставляется как текст.
            </Typography>
          </Stack>
        ) : null}

        {tab === 'raw' ? (
          <Box>
            <TextField
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="# Заголовок&#10;&#10;Текст в формате Markdown..."
              multiline
              minRows={6}
              maxRows={16}
              fullWidth
            />
          </Box>
        ) : null}

        {tab === 'clipboard' ? (
          <Stack spacing={1.5}>
            <Button
              variant="contained"
              onClick={handlePasteFromClipboard}
              disabled={busy}
              fullWidth
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {busy ? 'Вставка...' : 'Вставить из буфера обмена'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              Содержимое буфера разбирается как Markdown.
            </Typography>
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Отмена
        </Button>
        {tab === 'raw' ? (
          <Button variant="contained" onClick={() => insert(raw)} disabled={busy}>
            Вставить
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
```

- [x] **Step 2: Rename the slash item label/description**

In `packages/editor/src/slash-items.ts`, update the `markdown` item (lines 320-328):

```ts
  {
    id: 'markdown',
    group: 'media',
    label: 'Вставить содержимое',
    description: 'Вставить содержимое',
    keywords: ['markdown', 'md', 'импорт', 'вставить', 'содержимое'],
    icon: createElement(MarkdownIcon),
    run: ({ range }) => handlers.openMarkdownPopover(range),
  },
```

- [x] **Step 3: Type-check + lint**

Run: `pnpm check-types`
Expected: PASS.
Run: `pnpm --filter web lint` (lints the editor package via the web build graph) or `pnpm lint`.
Expected: PASS (no unused imports — confirm `Typography`, `Box` are used; they are).

- [x] **Step 4: Manually verify**

Run: `pnpm dev`. On a TEXT page: `/` → Медиа → «Вставить содержимое». A dialog
with three tabs opens. (a) Из файла: choose a `.md` file → content inserts. (b)
Markdown: type `# Hi\n\n- a\n- b`, click «Вставить» → renders as heading + list.
(c) Из буфера: copy markdown to clipboard, click the button → it inserts. Confirm
«Отмена» closes without inserting.

- [x] **Step 5: Commit**

```bash
git add packages/editor/src/components/markdown-upload-popover.tsx packages/editor/src/slash-items.ts
git commit -m "feat(editor): tabbed Вставить содержимое dialog (file/raw/clipboard)"
```

---

## Task 11: Full gate run

**Files:** none (verification only).

- [x] **Step 1: Run the editor test suite**

Run: `pnpm --filter @repo/editor test`
Expected: PASS.

- [x] **Step 2: Run the merge gate**

Run: `pnpm gates`
Expected: PASS (check-types + lint + build + test). If `apps/web` build fails on
stale `.next/types`, `rm -rf apps/web/.next/types` and retry.

- [x] **Step 3: Final manual smoke on a TEXT page**

Run: `pnpm dev`. Quickly re-confirm all seven features in one session:
1. Paste an image → renders via ResizableImage.
2. First child of callout/details/hidden/quote has no drag handle.
3. Slash menu shows «Встроенные» group with Дата/Дата-и-время/Ссылка/Напоминание.
4. Date chip with calendar icon, re-editable; datetime chip with clock icon.
5. Placeholder shows on every empty line.
6. ⋯ → «Копировать текст» copies Markdown.
7. «Вставить содержимое» dialog with three tabs works.

- [x] **Step 4: Commit any gate fixups** (only if gates required changes)

```bash
git add -A
git commit -m "chore(editor): gate fixups for text editor expansion"
```

---

## Notes for the implementer

- **Editor imports MUI directly.** Unlike `apps/web`, `packages/editor` imports
  from `@mui/material` / `@mui/icons-material` directly (see existing files). The
  date picker components (`StaticDatePicker`, etc.) come from `@repo/ui/components`
  because that is where the locale-configured re-exports live and `date-insert-popover.tsx`
  already imports them there.
- **`insertContent(' ')` after the date node** gives the cursor a text position to
  land on after an inline atom (otherwise the selection sticks to the atom). Mirror
  the mention command which also appends a space.
- **DragHandleRule signature (verified):** `@tiptap/extension-drag-handle@3.22.3`
  `RuleContext` exposes `{ node, pos, depth, parent, index, isFirst, isLast, $pos,
  view }`. Use `parent` + `isFirst` directly — the library docstring shows this
  exact "exclude first child" example.
- **`marked` types:** `parseMarkdown` already exists; reuse it verbatim (do not add
  a second markdown parser).
```
