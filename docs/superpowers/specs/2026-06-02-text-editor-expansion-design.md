# Text Editor Expansion — Design

Date: 2026-06-02
Scope: `@repo/editor` (TEXT page editor) + two `apps/web` touch points.

Seven independent improvements to the TEXT-type page editor. Each is small and
self-contained; they share the editor package but touch mostly distinct files,
so they can be implemented and reviewed independently.

## Background

The TEXT editor is a Tiptap/ProseMirror editor in `packages/editor`, rendered
collaboratively through Hocuspocus. Key files:

- `extensions/index.ts` — `buildExtensions(opts)`, the client extension registry.
- `slash-items.ts` — slash-menu command list (`base` / `code` / `media` /
  `embedding` groups).
- `components/slash-menu-popover.tsx` — renders grouped slash items.
- `anynote-editor.tsx` — orchestrates slash-triggered popovers via a
  `PopoverKind` union (`date` | `file` | `markdown` | `pageLink`).
- `extensions/server.ts` + `apps/web/src/server/page-export/server-extensions.ts`
  — schema-only extensions for server-side HTML/MD/PDF export.
- Inline-node template: `extensions/page-link.{schema.ts,tsx}` — inline atom node
  with a `.schema.ts` (server-renderable) and a `.tsx` (React node view).

Markdown export is server-side: `GET /api/workspaces/{ws}/pages/{id}/export/md`
renders `page.content` (JSON snapshot) → HTML via `buildServerExtensions()` →
markdown via `htmlToMarkdown`.

---

## Feature 1 — Clipboard image paste flows through the `image` node

**Today:** `@tiptap-codeless/extension-file-upload` (`buildFileUpload`,
`handlePaste: true`) intercepts pasted images and inserts them into its own
internal node, bypassing `ResizableImage`. No placeholder UX.

**Target:** pasting an image behaves like `/image` then auto-upload — the
`ResizableImage` empty placeholder appears, the clipboard blob uploads as if it
were a file selection, and the image renders in place.

**Approach:**
- Add a small ProseMirror plugin (a thin Tiptap extension, e.g.
  `extensions/image-paste.ts`) with `editorProps.handlePaste` that:
  1. inspects `clipboardData.files` / `items` for `image/*`;
  2. for an image: `preventDefault`, inserts an `image` node with `src: null` at
     the selection (same placeholder node `/image` produces), records its pos;
  3. calls the editor's `uploadHandler`, then sets `src` on that node via
     `view.dispatch` (`setNodeMarkup` / a `setImageSrc` command) by position.
  4. returns `false` for non-image pastes so FileUpload / default paste still run.
- Register this extension **before** `buildFileUpload(...)` in `buildExtensions`
  so it wins for images; FileUpload keeps handling video/files unchanged.
- The upload itself is driven from the plugin (not the node view), so there is no
  double-upload: the node view only renders placeholder → image based on `src`.

**Files:** `extensions/image-paste.ts` (new), `extensions/index.ts` (register +
pass `uploadHandler`).

**Edge cases:** multiple images in one paste → insert each sequentially; upload
failure → leave the placeholder with its error (reuse `ResizableImage` error UX
by setting an `uploadError` attr, or simplest: leave placeholder empty so the
user can retry by clicking). Decision: on failure, delete the placeholder node
and surface nothing extra (matches current silent FileUpload behavior); revisit
if noisy.

---

## Feature 2 — Hide drag-handle controls on the first child of container nodes

**Today:** a single floating `DragHandle` (`components/drag-handle.tsx`) follows
the hovered node via `onNodeChange`, using `nested.rules` scoring (see
`excludeColumnNodes`, which returns a large score to disqualify a node).

**Target:** for container nodes that hold children — **callout, выноска**;
**details/toggle, переключатель**; **hiddenText, скрытый текст**; **blockquote,
цитата** — do not show the `+` / `⋮⋮` controls on the **first** direct child
block. (Subsequent children keep their handle.)

**Approach:** add a `DragHandleRule` `excludeFirstContainerChild` to
`nestedOptions.rules`:

```ts
evaluate: ({ node, pos, editor }) => {
  const $pos = editor.state.doc.resolve(pos)
  const parent = $pos.parent
  const CONTAINERS = new Set(['callout', 'detailsContent', 'hiddenText', 'blockquote'])
  if (CONTAINERS.has(parent.type.name) && $pos.index() === 0) return 10000
  return 0
}
```

Returning `10000` pushes the score below the library's candidate threshold (same
trick as `excludeColumnNodes`), so the handle simply does not appear when
hovering that first child.

**Note:** `details` content lives in `detailsContent`; the user-visible "first
child" is the first block inside `detailsContent`, so we match `detailsContent`,
not `details`. Verify the resolved `pos` is the child block position (Tiptap
passes the node + its pos to `evaluate`).

**Files:** `components/drag-handle.tsx`.

---

## Feature 3 — New "Встроенные" (inline) slash group

**Target:** a new slash group titled **«Встроенные»** containing Дата, Дата и
время, Ссылка на страницу, Напоминание (currently all in `base`). The existing
`embedding`="Встраиваемые" (Draw.io) group is unchanged.

**Approach:**
- `types.ts`: extend `SlashCommandGroup` to `'base' | 'inline' | 'code' | 'media' | 'embedding'`.
- `slash-items.ts`: set `group: 'inline'` on `date`, `datetime`, `pageLink`,
  `reminder`.
- `slash-menu-popover.tsx`: `GROUP_ORDER = ['base','inline','code','media','embedding']`;
  `GROUP_TITLES.inline = 'Встроенные'`.

**Files:** `types.ts`, `slash-items.ts`, `components/slash-menu-popover.tsx`,
`slash-items.test.ts` (group assertions).

---

## Feature 4 — Structural `date` / `datetime` inline nodes with calendar tag

**Today:** `/date` and `/datetime` insert plain formatted text (`formatDateText`
/ `formatDateTimeText`) — no structure, not re-editable.

**Target:** Дата and Дата-и-время become inline atom nodes rendered as a chip/tag
with a calendar icon (date) or clock icon (datetime), making it obvious a date
was inserted. Clicking the chip opens a DatePicker / DateTimePicker to change it.

**Storage:** ISO `value` + `kind`. The node formats for display via
`formatDateText`/`formatDateTimeText`; `renderHTML` emits readable text so MD/HTML
export and "copy text" produce human-readable dates.

**Approach (mirrors PageLink):**
- `extensions/date.schema.ts` — `Node.create({ name: 'date', group: 'inline',
  inline: true, atom: true })` with attrs `{ value: ISO string, kind: 'date' | 'datetime' }`.
  `parseHTML`: `span[data-type="date"]` reading `data-value` / `data-kind`.
  `renderHTML`: `<span data-type="date" data-value=… data-kind=…>{formatted}</span>`.
  One schema/node handles both kinds via the `kind` attr (simpler than two nodes).
- `extensions/date.tsx` — node view: a `PageLink`-style chip (icon + formatted
  text). `CalendarTodayIcon` for `kind='date'`, `AccessTimeIcon` for `datetime`.
  Click (when `editor.isEditable`) opens a `Popover` with `StaticDatePicker` /
  `StaticDateTimePicker`; `onAccept` → `updateAttributes({ value: iso })`. Read-only
  → no popover.
- `extensions/index.ts`: register `DateNode` (client) in `buildExtensions`.
- `extensions/server.ts`: `export { DateSchema as DateNode } from './date.schema'`.
- `apps/web/src/server/page-export/server-extensions.ts`: register `DateNode` so
  export/copy serialize the readable date.
- Slash wiring:
  - `/date` keeps using `DateInsertPopover`, but it now inserts
    `{ type: 'date', attrs: { value: iso, kind: 'date' } }` instead of text.
  - `/datetime`: extend `DateInsertPopover` with a `mode: 'date' | 'datetime'`
    prop — `'date'` renders `StaticDatePicker`, `'datetime'` renders
    `StaticDateTimePicker` — and inserts `{ type: 'date', attrs: { value: iso,
    kind: mode } }`.
  - `anynote-editor.tsx`: `PopoverKind` gains `'datetime'`; both `date` and
    `datetime` kinds render the same `DateInsertPopover` with the matching `mode`.
    Add an `openDatetimePopover` handler to `SlashMediaHandlers`.

**Files:** `extensions/date.schema.ts` (new), `extensions/date.tsx` (new),
`extensions/index.ts`, `extensions/server.ts`, `slash-items.ts`,
`components/date-insert-popover.tsx`, `anynote-editor.tsx`,
`apps/web/src/server/page-export/server-extensions.ts`, plus
`@repo/ui/components` re-export of `StaticDateTimePicker` if not already exported.

**Migration note:** previously-inserted plain-text dates remain plain text — no
back-migration. New inserts are structured nodes.

---

## Feature 5 — Placeholder on every empty line

**Today:** `buildPlaceholder` + CSS show the placeholder only on
`p.is-editor-empty:first-child` — i.e. only the first line of an empty doc.

**Target:** show the placeholder whenever the current line (paragraph) is empty,
not just the first.

**Approach:**
- `extensions/placeholder.ts`: configure `Placeholder` with `emptyNodeClass:
  'is-empty'` (in addition to `emptyEditorClass: 'is-editor-empty'`). The
  Placeholder extension applies `is-empty` to every empty top-level node.
- `styles/content.css`: add
  `.anynote-editor .ProseMirror p.is-empty::before { content: attr(data-placeholder); ... }`
  matching the existing `:first-child` rule's styling. Keep the `:first-child`
  rule for the editor-empty case.

**Edge cases:** restrict the new selector so the placeholder does not appear on
empty paragraphs inside table cells / nested containers if that looks noisy —
verify visually and scope the selector (e.g. direct-child only) if needed.

**Files:** `extensions/placeholder.ts`, `styles/content.css`.

---

## Feature 6 — "Копировать текст" (copy page as Markdown to clipboard)

**Target:** in the page "⋯" menu, after «Копировать ссылку», add **«Копировать
текст»** (TEXT pages only). Clicking copies the page in Markdown format (same as
.md export) to the clipboard.

**Approach:**
- Add `copyText()` to `use-page-actions.tsx` next to `copyLink()`:
  `fetch('/api/workspaces/{ws}/pages/{id}/export/md', { credentials: 'same-origin' })`
  → `res.text()` → `navigator.clipboard.writeText(md)` → success/error toast
  (reuse the existing toast pattern from `copyLink`).
- `page-actions-menu.tsx`: add a `MenuItem` «Копировать текст» with a copy/text
  icon, after «Копировать ссылку», gated to `pageType === 'TEXT'`.

**Files:** `apps/web/src/hooks/use-page-actions.tsx`,
`apps/web/src/components/page/page-actions-menu.tsx`.

---

## Feature 7 — "Вставить содержимое" command (tabbed modal)

**Today:** the `markdown` slash item opens a file-only popover
(`markdown-upload-popover.tsx`).

**Target:** rename to **«Вставить содержимое»** (description «Вставить
содержимое»). Clicking opens a **modal with three tabs**:
1. **Из файла** — current `.md` upload.
2. **Markdown** — a multiline `TextField` for raw markdown + «Вставить».
3. **Из буфера** — a button reading `navigator.clipboard.readText()`.

All three parse via the existing `parseMarkdown` (`marked`) and
`insertContent(html)` at the slash `range`.

**Approach:**
- Convert `markdown-upload-popover.tsx` from `Popover` to `Dialog` with MUI
  `Tabs` (or create `content-insert-dialog.tsx` and keep the file logic). Keep
  the `parseMarkdown` helper and the insert-at-range flow shared across tabs.
- `slash-items.ts`: `markdown` item `label: 'Вставить содержимое'`,
  `description: 'Вставить содержимое'`, keywords include existing + «вставить».
- `anynote-editor.tsx`: the `markdown` `PopoverKind` now drives the dialog
  (anchor positioning no longer needed for a centered Dialog — pass `range` only).

**Files:** `components/markdown-upload-popover.tsx` (→ tabbed dialog, possibly
renamed), `slash-items.ts`, `anynote-editor.tsx`.

---

## Testing

- Unit (vitest, `packages/editor`): `slash-items.test.ts` — `inline` group
  membership and labels; new test for the `date` node schema round-trip
  (`renderHTML` emits readable text, `parseHTML` restores attrs); drag-handle rule
  unit if feasible.
- Server export: extend an existing export test (or add one) asserting a `date`
  node serializes to its readable text in MD.
- Manual verification (per CLAUDE.md RSC/editor guidance): run `pnpm dev`, on a
  TEXT page verify each feature end-to-end (paste image, container child handle,
  inline group, date chip edit, multi-line placeholder, copy text, content
  insert dialog). E2E has no yjs server, so editor-content assertions are limited
  to in-session behavior.

## Out of scope

- Back-migrating existing plain-text dates to nodes.
- Changing video/file paste behavior (still via FileUpload).
- Markdown round-trip fidelity beyond what `marked` + `htmlToMarkdown` already do.
