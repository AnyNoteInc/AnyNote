# Block "Copy as Markdown" — design

## Goal

On TEXT pages, the block hover controls (the `+` button and the ⋮⋮ drag handle)
already open a block-actions menu (`DragHandleMenu`) with _Превратить в_, _Цвет_,
_Дубликат_, _Переместить_, _Удалить_. Add a **"Копировать текст"** item that copies
_that specific block_ to the clipboard as **Markdown** plain text.

Matches the request: "когда я навожу на элемент… добавь Копировать текст и туда
вставляй в формате md текст конкретного выделенного блока".

## Scope

- Single hovered block only (the node already resolved by the menu from `pos`).
  No multi-block selection handling.
- Clipboard payload is Markdown **plain text** (`text/plain` via
  `navigator.clipboard.writeText`). No rich `text/html`.
- TEXT pages only — this menu already only exists in `@repo/editor`, which renders
  `Page.type === 'TEXT'`.

## Components

### 1. `packages/editor/src/lib/html-to-markdown.ts` (new — shared leaf)

Move the turndown configuration currently living in
`apps/web/src/server/page-export/html-to-markdown.ts` into `@repo/editor` as a pure,
server-safe leaf (no React, no client-only APIs). Exports `htmlToMarkdown(html: string): string`
with the existing custom rules (callout, details, hidden-text, file-attachment) and the
blank-line collapse — behaviour unchanged.

`apps/web/src/server/page-export/html-to-markdown.ts` becomes a one-line re-export:

```ts
export { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
```

This mirrors the existing deep-import pattern `@repo/editor/extensions/server` used by
the export pipeline, and keeps the export test
(`apps/web/test/server/page-export/html-to-markdown.test.ts`) green unchanged.

`turndown` + `@types/turndown` move to `@repo/editor`'s dependencies. Turndown is
browser-safe: its `browser` field maps `@mixmark-io/domino → false` and swaps in a
DOM-based build, so no domino ships in the client bundle.

### 2. `packages/editor/src/lib/block-to-markdown.ts` (new)

```ts
export function blockToMarkdown(editor: Editor, node: PMNode): string
```

- `DOMSerializer.fromSchema(editor.schema).serializeNode(node)` → DOM node,
  appended to a detached container; read `.innerHTML` for the block's HTML.
- Feed that HTML to `htmlToMarkdown()`.

This reuses the same `renderHTML`/`toDOM` path the export pipeline uses, so headings →
`## …`, lists → `- …`, code → fenced block, callout/details/file-attachment via their
turndown rules — consistent with page export.

### 3. `DragHandleMenu` — new menu item

Add **"Копировать текст"** with `ContentCopyIcon`, placed directly **above _Дубликат_**
(so both copy-ish actions sit together), before the existing `<Divider />` boundary or
just after it — grouped with Дубликат.

Handler:

```ts
const [copied, setCopied] = useState(false)

const handleCopyMarkdown = () => {
  if (!node) return
  const md = blockToMarkdown(editor, node)
  void navigator.clipboard.writeText(md).then(() => {
    setCopied(true)
    setTimeout(() => handleClose(), 900) // flash then close
  })
}
```

While `copied` is true the item renders a `CheckIcon` + "Скопировано" instead of the copy
icon + "Копировать текст" (same affordance as the code-block copy button). `handleClose`
already resets submenu state; reset `copied` there too so a re-open starts clean.

Guard: if `navigator.clipboard` is unavailable (insecure context), fall back to closing
the menu without flashing — no crash.

## Data flow

```
hover block → ⋮⋮ → DragHandleMenu (editor, pos, node)
  click "Копировать текст"
    → blockToMarkdown(editor, node)
        → DOMSerializer.serializeNode(node) → block HTML
        → htmlToMarkdown(html) → markdown
    → navigator.clipboard.writeText(markdown)
    → flash "Скопировано ✓" ~0.9s → close
```

## Testing

- `packages/editor/src/lib/block-to-markdown.test.ts` (vitest, node env via happy-dom
  where needed): build a small doc (heading, bullet list, paragraph with bold), resolve a
  node, assert `blockToMarkdown` returns the expected markdown (`## Heading`, `- item`,
  `**bold**`). Uses a real Tiptap schema from the editor's extension set.
- Existing `apps/web/test/server/page-export/html-to-markdown.test.ts` must still pass
  after the move (imports the same behaviour through the re-export).
- Manual: hover a heading/list/paragraph on a TEXT page, "Копировать текст", paste into a
  plain-text target, confirm markdown.

## Out of scope

- Multi-block / range copy.
- Rich `text/html` clipboard flavour.
- Copying non-TEXT page types.
```
