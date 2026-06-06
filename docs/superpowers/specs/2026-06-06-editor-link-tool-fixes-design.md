# Editor link tool fixes — design

Date: 2026-06-06

## Problem

Two defects in the hyperlink tool used when editing/viewing task descriptions (and,
by the same code paths, page content).

**Bug 1 — links are not clickable.** A link mark is saved, but in view mode it has no
pointer cursor and clicking it does nothing. The URL never opens.

**Bug 2 — `https://` prefill.** The URL input opens pre-filled with `https://`.
Pasting a URL that already carries the protocol yields `https://https://…`, or forces
the user to manually clear the prefix.

## Where the code lives

Task descriptions render through **`AnyNotePlainEditor`**
(`packages/editor/src/plain-editor.tsx`) — a lightweight Tiptap editor, **not** the
full page editor (`packages/editor/src/extensions/index.ts` +
`packages/editor/src/components/floating-toolbar.tsx`). Both editors share the same
two defects, so both are fixed for consistency. The server HTML export
(`apps/web/src/server/page-export/server-extensions.ts`) gets the matching
`HTMLAttributes` so exported links open in a new tab too.

### Root causes

Bug 1:
- Both editors configure `Link.configure({ openOnClick: false })`, so Tiptap never
  opens links itself.
- The only click handler lives in `floating-toolbar.tsx` and is attached **inside an
  effect that runs regardless of `editable`, but the toolbar component itself is only
  mounted when the page editor mounts**. The plain editor mounts no such handler at
  all. In view mode (`editable: false`) the plain editor renders only
  `<EditorContent>` — nothing handles link clicks.
- Even the page editor's handler requires `metaKey || altKey`, so a plain left click
  never opens (no `ctrlKey` for Windows/Linux either).
- `content.css` has **no** `a` rule — links get no link color, no underline, no
  `cursor: pointer`.
- Links carry no `target`/`rel`, so they cannot open in a new tab.

Bug 2:
- `plain-editor.tsx:110` — `window.prompt('URL', prev ?? 'https://')`.
- `floating-toolbar.tsx:156` — `setLinkValue(current ?? 'https://')`.

## Design

### Click behaviour (confirmed with user)

- **View mode (`editable: false`):** a normal left click opens the link in a new tab.
- **Edit mode (`editable: true`):** `Cmd`/`Ctrl`/`Alt` + left click opens; a plain left
  click keeps its default behaviour (placing the caret) so link text stays editable.

### Files changed

1. **`packages/editor/src/extensions/link-click-handler.ts`** — the shared, pure-ish
   click logic.
   - `shouldOpenLink(event, editable)`: view mode → `event.button === 0`; edit mode →
     `event.metaKey || event.ctrlKey || event.altKey` (adds `ctrlKey`).
   - `attachLinkClickHandler(editor)`: registers a capture-phase `click` listener on
     `editor.view.dom`, reads `editor.isEditable` at click time, and returns a cleanup
     function. Both editors call this so the logic is defined once.
   - `findClickedLink` / `openLinkInNewWindow` unchanged.

2. **`packages/editor/src/link-href.ts`** (new) — `normalizeLinkHref(raw): string`.
   - Trims; returns `''` for empty.
   - Leaves these untouched: an existing scheme (`https:`, `http:`, `mailto:`,
     `tel:`, etc. — matched by `/^[a-z][a-z0-9+.-]*:/i`), root/relative paths
     (`/`, `./`, `../`), and in-page anchors (`#`).
   - Otherwise prefixes `https://` (covers smart-paste of bare domains like
     `example.com`).

3. **`packages/editor/src/plain-editor.tsx`**
   - `Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' } })`.
   - Link toolbar action: `window.prompt('URL', prev ?? '')` (no prefix); pass the
     result through `normalizeLinkHref` before `setLink`.
   - An effect that calls `attachLinkClickHandler(editor)` and cleans up on unmount.

4. **`packages/editor/src/components/floating-toolbar.tsx`**
   - `setLinkValue(current ?? '')` (no prefix).
   - `saveLink` runs the value through `normalizeLinkHref`.
   - Replace the inline click effect's `shouldOpenLink(event)` call with the new
     `shouldOpenLink(event, editor.isEditable)` (drop the `!editor.isEditable` early
     return so view mode is handled).

5. **`packages/editor/src/extensions/index.ts`** — add the same `HTMLAttributes` to
   the page editor's `Link.configure`. The page editor mounts `FloatingToolbar` for the
   click handler; in read-only contexts where the toolbar is not mounted, this design
   does not change behaviour (out of scope — task descriptions are the reported
   surface, and they use the plain editor).

6. **`apps/web/src/server/page-export/server-extensions.ts`** — add the same
   `HTMLAttributes` so exported HTML links open in a new tab.

7. **`packages/editor/src/styles/content.css`** — add:
   ```css
   .anynote-editor a {
     color: var(--editor-link, #2563eb);
     text-decoration: underline;
     cursor: pointer;
   }
   ```

## Testing (TDD)

Pure functions are unit-tested first (red → green):

- **`link-href.test.ts`** — `normalizeLinkHref`:
  - `'https://x.com'` → unchanged; `'http://x.com'` → unchanged.
  - `'example.com'` → `'https://example.com'`; `'www.example.com'` →
    `'https://www.example.com'`.
  - `'mailto:a@b.c'`, `'tel:+1'`, `'/path'`, `'./rel'`, `'../up'`, `'#anchor'` →
    unchanged.
  - `'  https://x.com  '` → trimmed; `''` and `'   '` → `''`.
- **`link-click-handler.test.ts`** — `shouldOpenLink`:
  - view mode (`editable=false`): left click (`button 0`) → true; right click
    (`button 2`) → false.
  - edit mode (`editable=true`): plain left click → false; `metaKey`/`ctrlKey`/`altKey`
    → true.
  - `findClickedLink`: anchor target, nested element inside an anchor, element outside
    the root → null.
- **`content.test.ts`** — extend the existing rule-presence test to assert the
  `.anynote-editor a` rule with `cursor: pointer`.

The DOM click wiring (`attachLinkClickHandler`) and the prompt/dialog flow are verified
manually in the running app (Playwright/browser), since `window.prompt` and live DOM
clicks aren't reproducible in the unit harness — consistent with this repo's existing
editor testing notes.

## Out of scope

- Changing the page editor's read-only click wiring beyond what the shared handler
  already provides (task descriptions are the reported surface and use the plain
  editor).
- A full link-edit popover/UI redesign — only the prefill and normalization change.
