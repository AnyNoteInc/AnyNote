# Slash Menu Media & Page Link — Design

**Status:** Draft
**Date:** 2026-04-18
**Scope:** `packages/editor`, `packages/ui`, `apps/web/src/components/page/page-renderer.tsx`, `apps/e2e`

## Goal

Extend the Tiptap slash menu in `@repo/editor` with three new commands:

1. **Картинка** — popover with two tabs: upload from computer (via `/api/files/upload`) / insert URL.
2. **Файл** — popover with file input + upload button; inserts a file attachment block that shows an icon based on file extension, file name, and file size.
3. **Ссылка на страницу** — popover with a search field and filtered list of active workspace pages; inserts an inline page link that routes inside the same window.

Group the slash menu entries under two section headings: **Базовые блоки** (all existing + page link) and **Медиа** (image + file).

## Non-goals

- No search service integration (page search stays client-side filtering of existing `page.listByWorkspace` data).
- No cross-workspace page links (current workspace only).
- No editing of already-inserted file/image/page-link attributes (insert-only for now).
- No thumbnail generation for files.

## Constraints inherited from the codebase

- `@repo/editor` is a workspace package compiled from source by Next.js Turbopack (`transpilePackages`). No build step required.
- MUI v6 must be imported through `@repo/ui/components`, never `@mui/material` directly from apps.
- Tiptap v3 extension API; existing extensions live in `packages/editor/src/extensions/`.
- React 19, Next.js 16 App Router. All editor UI is client-only (`"use client"`).
- Page navigation from inside the editor must go through Next.js router to avoid full page reloads.

## Architecture

### New / changed types (packages/editor/src/types.ts)

```ts
export type SlashCommandGroup = "base" | "media"

export type SlashCommandItem = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon?: ReactNode
  group: SlashCommandGroup // NEW
  run: (args: {
    editor: Editor
    range: { from: number; to: number }
    context: SlashCommandContext // NEW
  }) => void
}

export type PageLookupItem = {
  id: string
  title: string
  icon: string | null
}

export type SlashCommandContext = {
  openImagePopover: (range: { from: number; to: number }) => void
  openFilePopover: (range: { from: number; to: number }) => void
  openPageLinkPopover: (range: { from: number; to: number }) => void
}

export type AnyNoteEditorProps = {
  // existing:
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
  placeholder?: string
  // NEW:
  workspaceId: string
  pageSearch: (query: string) => Promise<PageLookupItem[]>
  onNavigateToPage: (pageId: string) => void
}
```

Rationale for `pageSearch` and `onNavigateToPage` as props: editor package stays transport-agnostic (no tRPC import). Consumer (`page-renderer.tsx`) wires these to tRPC and the Next.js router.

### New Tiptap extensions (packages/editor/src/extensions/)

#### `file-attachment.ts` — block node `fileAttachment`

Atom block node with attrs:

- `url: string` — `/api/files/{fileId}` URL from upload handler
- `name: string` — original filename
- `size: number` — bytes
- `mimeType: string`
- `ext: string` — lowercased extension without dot (for icon lookup)

ReactNodeView renders a clickable row:

```
[icon] filename.ext      12.3 KB    [download →]
```

Clicking the row (or the download affordance) opens `url` in a new tab via `<a href={url} target="_blank" rel="noopener noreferrer" download={name}>`.

Serialization: custom HTML `<div data-type="file-attachment" data-url data-name data-size data-mime data-ext />` so yjs + prosemirror parse it back.

#### `page-link.ts` — inline node `pageLink`

Atom inline node with attrs:

- `pageId: string`
- `workspaceId: string`
- `title: string`

ReactNodeView renders an inline element: icon + title, styled as a link. Click calls `props.onNavigateToPage(pageId)` (threaded via extension options) so the editor stays transport-agnostic and the app uses `router.push(/workspaces/{workspaceId}/pages/{pageId})`.

Serialization: `<span data-type="page-link" data-page-id data-workspace-id data-title />`.

### New popover components (packages/editor/src/components/)

All popovers are rendered inside `AnyNoteEditorInner` using MUI `<Popover>` with an anchor element computed from the current selection's client rect (mirroring the pattern already used for the slash menu via `tippy.js`, but with MUI for these richer UIs).

#### `image-upload-popover.tsx`

Props: `{ open, anchorEl, range, onClose, uploadHandler, editor }`.
Two MUI tabs:

- **Tab 1 "Загрузить"**: file input (`accept="image/*"`), preview, "Загрузить" button → calls `uploadHandler`, on success replaces `range` with an `<img>` node (`editor.chain().focus().deleteRange(range).setImage({ src })`).
- **Tab 2 "Ссылка"**: URL TextField + "Вставить" button → replaces `range` with `<img src={url}>`.

Note: Tiptap's `StarterKit` does not include `Image`. We add `@tiptap/extension-image` dependency + register it.

#### `file-upload-popover.tsx`

Props: same as image popover.
Single panel: file input + "Загрузить" button → calls `uploadHandler`, on success inserts `fileAttachment` node with the returned metadata.

#### `page-link-popover.tsx`

Props: `{ open, anchorEl, range, onClose, pageSearch, workspaceId, editor }`.
TextField (autoFocus) + results list rendered with MUI `<List>`. Debounces search by 200ms. Click on a result inserts `pageLink` node.

### Slash menu grouping (packages/editor/src/components/slash-menu-popover.tsx)

Update popover to render items partitioned by `group`, with MUI `<ListSubheader>` section titles. Keyboard navigation (arrow keys) must continue to work linearly across groups. Current file is 73 lines — this is a small refactor, not a rewrite.

### Default slash items (packages/editor/src/slash-items.ts)

Add `group` to every existing item (all `"base"`). Append:

- `{ id: "pageLink", group: "base", label: "Ссылка на страницу", run: (ctx) => ctx.context.openPageLinkPopover(ctx.range) }`
- `{ id: "image", group: "media", label: "Картинка", run: (ctx) => ctx.context.openImagePopover(ctx.range) }`
- `{ id: "file", group: "media", label: "Файл", run: (ctx) => ctx.context.openFilePopover(ctx.range) }`

### AnyNoteEditor changes

`AnyNoteEditorInner` owns three popover states: `imagePopover`, `filePopover`, `pageLinkPopover` — each has `{ open, anchorEl, range }`. The `context` passed to slash items opens the right popover and closes the tippy slash menu.

Anchor element: create a virtual anchor using `getBoundingClientRect` from the editor view's current selection, wrapped in MUI's `PopoverReference="anchorPosition"` or a ref to a zero-size div positioned absolutely.

### Assets (packages/editor/src/assets/files/)

Create 18 SVG icons (one per extension listed below) + `default.svg`:

`txt.svg, pdf.svg, doc.svg, docx.svg, xls.svg, xlsx.svg, ppt.svg, pptx.svg, jpg.svg, png.svg, gif.svg, mp3.svg, wav.svg, mp4.svg, zip.svg, rar.svg, html.svg, csv.svg, default.svg`

Plus three new command-level icons in `packages/editor/src/assets/`:
`image.svg, file.svg, page-link.svg`

Export helper `getFileIcon(ext: string): ComponentType` in `assets/files/index.ts` that falls back to `default.svg`.

### UI package additions (packages/ui/src/components/index.ts)

Add:

```ts
export { default as Tabs, type TabsProps } from "@mui/material/Tabs"
export { default as Tab, type TabProps } from "@mui/material/Tab"
export { default as ListSubheader, type ListSubheaderProps } from "@mui/material/ListSubheader"
```

(These MUI components are already a transitive dep via `@mui/material`, no new install needed.)

### page-renderer.tsx wiring

- Add `workspaceId` already passed as prop — forward to editor.
- Create `pageSearch` callback using `trpc.page.listByWorkspace.useQuery` data, filtered client-side by query against `title`.
- Create `onNavigateToPage` via `useRouter().push(/workspaces/${workspaceId}/pages/${pageId})`.

Since `listByWorkspace` already returns all active non-archived pages, we reuse it directly (memoized by `workspaceId`).

### Tiptap Image extension

Add `@tiptap/extension-image` to `@repo/editor` dependencies. Register in `buildExtensions`.

## Data flow

### Image upload (Tab 1)

```
slash "/" → user selects "Картинка" → openImagePopover(range)
  → tab Upload → file picker → click "Загрузить"
  → uploadHandler({ blob, filename }) → POST /api/files/upload
  → returns { id, src }
  → editor.chain().deleteRange(range).setImage({ src }).run()
  → popover closes
```

### Image URL (Tab 2)

```
slash "/" → "Картинка" → openImagePopover(range)
  → tab URL → user pastes URL → click "Вставить"
  → editor.chain().deleteRange(range).setImage({ src: url }).run()
```

### File upload

```
slash "/" → "Файл" → openFilePopover(range)
  → file picker → click "Загрузить"
  → uploadHandler → { id, src }
  → editor.chain().deleteRange(range).insertContent({
       type: "fileAttachment",
       attrs: { url: src, name, size, mimeType, ext }
     }).run()
```

### Page link

```
slash "/" → "Ссылка на страницу" → openPageLinkPopover(range)
  → user types → pageSearch(query) → returns filtered list
  → click result → editor.chain().deleteRange(range).insertContent({
       type: "pageLink",
       attrs: { pageId, workspaceId, title }
     }).run()
```

## Error handling

- Upload failure in image/file popover: show inline MUI `Alert` with the error message, keep popover open so the user can retry.
- Invalid image URL: light validation only (must start with `http://` or `https://` or `/`). No HEAD probe.
- Page search failure: show "Ошибка поиска" text in the list area.
- Missing page icon: fall back to a generic document icon.

## Testing

### Unit / type-check

- `pnpm run check-types` must pass.
- `pnpm run lint` must pass with `--max-warnings 0`.

### Playwright E2E (apps/e2e/)

Add new spec `apps/e2e/editor-slash-media.spec.ts` covering:

1. Open a text page, type `/`, verify the menu renders two group headings and all items.
2. Select "Картинка" → Upload tab → attach a small PNG → verify image appears in the editor.
3. Select "Картинка" → URL tab → paste URL → verify image appears.
4. Select "Файл" → upload a `.pdf` fixture → verify attachment block with correct name/size and pdf icon.
5. Select "Ссылка на страницу" → type → click a result → verify link appears; click the link → verify navigation to the target page.

Playwright fixtures go in `apps/e2e/fixtures/` (PNG + PDF).

## Rollout & risks

- Breaking change to `AnyNoteEditorProps` (new required props). Only consumer is `page-renderer.tsx`, which we update in the same change.
- Breaking change to `SlashCommandItem` (new required `group` field). Only internal consumer is `defaultSlashItems`.
- yjs compatibility: new node types (`fileAttachment`, `pageLink`) will round-trip through prosemirror ↔ yjs as long as their attrs are plain JSON. Existing documents are not affected because they don't contain these nodes.

## Open items (post-implementation)

- Drag-to-reorder file attachments via the existing drag handle — should "just work" since they're block nodes, but worth verifying in e2e.
- Consider adding a "paste an image URL" shortcut inline (low priority).
- File attachment thumbnails for images (future — `ext` is enough today).
