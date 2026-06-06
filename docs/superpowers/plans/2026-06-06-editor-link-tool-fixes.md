# Editor Link Tool Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hyperlinks in task descriptions (and page content) clickable in view mode, and stop pre-filling the URL field with `https://`.

**Architecture:** Both editors — the lightweight `AnyNotePlainEditor` (used by Kanban task descriptions) and the full page editor (`FloatingToolbar`) — share two pure helpers: a click-decision/handler module (`link-click-handler.ts`) and a href-normalizer (`link-href.ts`). View mode opens links on a plain left click; edit mode opens on Cmd/Ctrl/Alt+click. The URL input opens empty; on save, bare domains get an `https://` prefix while schemes/relative paths/anchors are left alone. Links get `target="_blank"` + `rel`, and CSS gives them a link color, underline, and pointer cursor.

**Tech Stack:** TypeScript, Tiptap v3 (`@tiptap/extension-link`, `@tiptap/react`, `@tiptap/core`), MUI v6, Vitest, React 19.

---

## File Structure

- **Create** `packages/editor/src/link-href.ts` — `normalizeLinkHref(raw): string`. One responsibility: turn a raw user-entered URL into a safe href.
- **Create** `packages/editor/src/link-href.test.ts` — unit tests for the above.
- **Modify** `packages/editor/src/extensions/link-click-handler.ts` — add `editable` param to `shouldOpenLink`, add `ctrlKey`, add reusable `attachLinkClickHandler(editor)`.
- **Create** `packages/editor/src/extensions/link-click-handler.test.ts` — unit tests for `shouldOpenLink` and `findClickedLink`.
- **Modify** `packages/editor/src/plain-editor.tsx` — empty prompt + normalize, `HTMLAttributes`, attach click handler.
- **Modify** `packages/editor/src/components/floating-toolbar.tsx` — empty dialog field + normalize, use `shouldOpenLink(event, editable)`.
- **Modify** `packages/editor/src/extensions/index.ts` — add link `HTMLAttributes`.
- **Modify** `apps/web/src/server/page-export/server-extensions.ts` — add link `HTMLAttributes`.
- **Modify** `packages/editor/src/styles/content.css` — `.anynote-editor a` rule.
- **Modify** `packages/editor/src/styles/content.test.ts` — assert the new `a` rule.

The plan is on branch `fix/editor-link-tool` (spec already committed there).

---

## Task 1: `normalizeLinkHref` pure function

**Files:**
- Create: `packages/editor/src/link-href.ts`
- Test: `packages/editor/src/link-href.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/link-href.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { normalizeLinkHref } from './link-href'

describe('normalizeLinkHref', () => {
  it('leaves an explicit https/http scheme unchanged', () => {
    expect(normalizeLinkHref('https://example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('http://example.com/path?q=1')).toBe('http://example.com/path?q=1')
  })

  it('prefixes https:// for a bare domain', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('www.example.com/path')).toBe('https://www.example.com/path')
  })

  it('leaves other known schemes unchanged', () => {
    expect(normalizeLinkHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(normalizeLinkHref('tel:+1234567890')).toBe('tel:+1234567890')
    expect(normalizeLinkHref('ftp://host/file')).toBe('ftp://host/file')
  })

  it('leaves relative paths and in-page anchors unchanged', () => {
    expect(normalizeLinkHref('/absolute/path')).toBe('/absolute/path')
    expect(normalizeLinkHref('./relative')).toBe('./relative')
    expect(normalizeLinkHref('../up')).toBe('../up')
    expect(normalizeLinkHref('#section')).toBe('#section')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkHref('  https://example.com  ')).toBe('https://example.com')
    expect(normalizeLinkHref('  example.com ')).toBe('https://example.com')
  })

  it('returns empty string for empty or whitespace-only input', () => {
    expect(normalizeLinkHref('')).toBe('')
    expect(normalizeLinkHref('   ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor exec vitest run src/link-href.test.ts`
Expected: FAIL — `Failed to resolve import "./link-href"` / `normalizeLinkHref is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/editor/src/link-href.ts`:

```ts
// Matches a leading URI scheme like `https:`, `mailto:`, `tel:`, `ftp:`.
// Per RFC 3986: scheme = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * Normalizes a raw, user-entered link target into a safe href.
 *
 * - Empty / whitespace-only -> '' (caller removes the link).
 * - Already has a scheme (https:, mailto:, tel:, ...) -> left as-is.
 * - Root / relative path (/, ./, ../) or in-page anchor (#) -> left as-is.
 * - Anything else (a bare domain like `example.com`) -> prefixed with `https://`.
 */
export function normalizeLinkHref(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (SCHEME_RE.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') || trimmed.startsWith('#') || trimmed.startsWith('.')) {
    return trimmed
  }
  return `https://${trimmed}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/editor exec vitest run src/link-href.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/link-href.ts packages/editor/src/link-href.test.ts
git commit -m "feat(editor): add normalizeLinkHref for smart link prefixing"
```

---

## Task 2: Extend `link-click-handler` for view mode + reusable handler

**Files:**
- Modify: `packages/editor/src/extensions/link-click-handler.ts`
- Test: `packages/editor/src/extensions/link-click-handler.test.ts` (create)

Current file contents (for reference — `shouldOpenLink` takes only `event` and checks `metaKey || altKey`; there is no `attachLinkClickHandler`):

```ts
export function findClickedLink(target: EventTarget | null, root: HTMLElement) {
  if (target instanceof HTMLAnchorElement) return target
  if (!(target instanceof HTMLElement)) return null
  const link = target.closest<HTMLAnchorElement>('a')
  if (!link || !root.contains(link)) return null
  return link
}

export function shouldOpenLink(event: MouseEvent) {
  return event.metaKey || event.altKey
}

export function openLinkInNewWindow(link: HTMLAnchorElement) {
  window.open(link.href, '_blank', 'noopener,noreferrer')
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/editor/src/extensions/link-click-handler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findClickedLink, shouldOpenLink } from './link-click-handler'

function mouseEvent(props: Partial<MouseEvent>): MouseEvent {
  return { button: 0, metaKey: false, ctrlKey: false, altKey: false, ...props } as MouseEvent
}

describe('shouldOpenLink', () => {
  it('opens on a plain left click in view mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 0 }), false)).toBe(true)
  })

  it('does not open on a non-left click in view mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 2 }), false)).toBe(false)
    expect(shouldOpenLink(mouseEvent({ button: 1 }), false)).toBe(false)
  })

  it('does not open on a plain left click in edit mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 0 }), true)).toBe(false)
  })

  it('opens on a modified click in edit mode', () => {
    expect(shouldOpenLink(mouseEvent({ metaKey: true }), true)).toBe(true)
    expect(shouldOpenLink(mouseEvent({ ctrlKey: true }), true)).toBe(true)
    expect(shouldOpenLink(mouseEvent({ altKey: true }), true)).toBe(true)
  })
})

describe('findClickedLink', () => {
  it('returns the anchor when the target is an anchor inside the root', () => {
    const root = document.createElement('div')
    const anchor = document.createElement('a')
    root.appendChild(anchor)
    expect(findClickedLink(anchor, root)).toBe(anchor)
  })

  it('returns the closest anchor when the target is nested inside one', () => {
    const root = document.createElement('div')
    const anchor = document.createElement('a')
    const inner = document.createElement('span')
    anchor.appendChild(inner)
    root.appendChild(anchor)
    expect(findClickedLink(inner, root)).toBe(anchor)
  })

  it('returns null when the anchor is outside the root', () => {
    const root = document.createElement('div')
    const orphan = document.createElement('a')
    expect(findClickedLink(orphan, root)).toBeNull()
  })

  it('returns null when there is no anchor', () => {
    const root = document.createElement('div')
    const plain = document.createElement('span')
    root.appendChild(plain)
    expect(findClickedLink(plain, root)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor exec vitest run src/extensions/link-click-handler.test.ts`
Expected: FAIL — `shouldOpenLink` ignores the second arg, so `shouldOpenLink(left-click, false)` returns `false` instead of `true`; edit-mode `ctrlKey` case returns `false`.

Note: this test uses `document`, so it needs the jsdom/happy-dom environment. Confirm the editor vitest config uses a DOM environment (other tests here, e.g. `paste-precedence.test.tsx`, render React, so it does). If a test errors with `document is not defined`, add `// @vitest-environment jsdom` as the first line of the test file.

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `packages/editor/src/extensions/link-click-handler.ts` with:

```ts
import type { Editor } from '@tiptap/core'

export function findClickedLink(target: EventTarget | null, root: HTMLElement) {
  if (target instanceof HTMLAnchorElement) return target
  if (!(target instanceof HTMLElement)) return null

  const link = target.closest<HTMLAnchorElement>('a')
  if (!link || !root.contains(link)) return null

  return link
}

/**
 * View mode: a plain left click opens the link.
 * Edit mode: a left click only opens with a modifier, so a plain click can
 * still place the caret for editing the link text.
 */
export function shouldOpenLink(event: MouseEvent, editable: boolean) {
  if (!editable) return event.button === 0
  return event.metaKey || event.ctrlKey || event.altKey
}

export function openLinkInNewWindow(link: HTMLAnchorElement) {
  window.open(link.href, '_blank', 'noopener,noreferrer')
}

/**
 * Attaches a capture-phase click listener that opens links per shouldOpenLink.
 * Reads editor.isEditable at click time so the same handler works whether the
 * editor is mounted editable or read-only. Returns a cleanup function.
 */
export function attachLinkClickHandler(editor: Editor) {
  const dom = editor.view.dom

  const handleClick = (event: MouseEvent) => {
    const link = findClickedLink(event.target, dom)
    if (!link) return
    if (!shouldOpenLink(event, editor.isEditable)) return

    event.preventDefault()
    event.stopPropagation()
    openLinkInNewWindow(link)
  }

  dom.addEventListener('click', handleClick, { capture: true })
  return () => dom.removeEventListener('click', handleClick, { capture: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/editor exec vitest run src/extensions/link-click-handler.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/link-click-handler.ts packages/editor/src/extensions/link-click-handler.test.ts
git commit -m "feat(editor): view-mode link clicks + reusable attachLinkClickHandler"
```

---

## Task 3: Wire plain editor — handler, HTMLAttributes, empty prompt + normalize

**Files:**
- Modify: `packages/editor/src/plain-editor.tsx`

This is DOM/React wiring not reproducible in the unit harness; verified in the running app at the end (Task 7). No new unit test here.

- [ ] **Step 1: Update imports**

In `packages/editor/src/plain-editor.tsx`, the React import on line 16 currently is:

```ts
import { EditorContent, useEditor } from '@tiptap/react'
```

Add a React effect import at the top of the React-hooks usage. Add this import line after the existing `@tiptap/react` import (line 16):

```ts
import { useEffect } from 'react'
```

And add, near the other local imports (after the `buildPlaceholder` import, line 22):

```ts
import { attachLinkClickHandler } from './extensions/link-click-handler'
import { normalizeLinkHref } from './link-href'
```

- [ ] **Step 2: Empty prompt + normalize in the link toolbar action**

Replace the link toolbar button's `run` body (currently lines 107-117):

```ts
    run: (ed) => {
      const prev = ed.getAttributes('link').href as string | undefined
      const next =
        globalThis.window === undefined ? null : globalThis.window.prompt('URL', prev ?? 'https://')
      if (next === null) return
      if (next === '') {
        ed.chain().focus().extendMarkRange('link').unsetLink().run()
        return
      }
      ed.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
    },
```

with:

```ts
    run: (ed) => {
      const prev = ed.getAttributes('link').href as string | undefined
      const raw =
        globalThis.window === undefined ? null : globalThis.window.prompt('URL', prev ?? '')
      if (raw === null) return
      const next = normalizeLinkHref(raw)
      if (next === '') {
        ed.chain().focus().extendMarkRange('link').unsetLink().run()
        return
      }
      ed.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
    },
```

- [ ] **Step 3: Add HTMLAttributes to Link.configure**

Replace line 181:

```ts
      Link.configure({ openOnClick: false }),
```

with:

```ts
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
```

- [ ] **Step 4: Attach the click handler via an effect**

In `AnyNotePlainEditor`, after the `useEditor(...)` call (which ends at line 188 with `})`) and before the `return (`, insert:

```ts
  useEffect(() => {
    if (!editor) return
    return attachLinkClickHandler(editor)
  }, [editor])
```

- [ ] **Step 5: Type-check the package**

Run: `pnpm --filter @repo/editor exec tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors). If `@repo/editor` has no standalone typecheck script, run the repo gate later in Task 8; for now ensure the file has no obvious type errors by running:
Run: `pnpm --filter @repo/editor exec vitest run src/link-href.test.ts src/extensions/link-click-handler.test.ts`
Expected: PASS (sanity that imports still resolve).

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/plain-editor.tsx
git commit -m "fix(editor): clickable links + no https:// prefill in plain editor"
```

---

## Task 4: Wire full editor toolbar — view-mode clicks, empty dialog, normalize

**Files:**
- Modify: `packages/editor/src/components/floating-toolbar.tsx`

- [ ] **Step 1: Import the normalizer**

In `packages/editor/src/components/floating-toolbar.tsx`, line 32 currently is:

```ts
import { findClickedLink, openLinkInNewWindow, shouldOpenLink } from '../extensions/link-click-handler'
```

Add `normalizeLinkHref` import after the existing imports block (after line 34):

```ts
import { normalizeLinkHref } from '../link-href'
```

- [ ] **Step 2: Empty the dialog field**

Replace line 156:

```ts
    setLinkValue(current ?? 'https://')
```

with:

```ts
    setLinkValue(current ?? '')
```

- [ ] **Step 3: Use view-mode-aware click logic**

Replace the click effect body (currently lines 159-178):

```ts
  useEffect(() => {
    const handleEditorClick = (event: MouseEvent) => {
      if (event.button !== 0 || !editor.isEditable) return

      const link = findClickedLink(event.target, editor.view.dom)
      if (!link) return

      if (shouldOpenLink(event)) {
        event.preventDefault()
        event.stopPropagation()
        openLinkInNewWindow(link)
      }
    }

    editor.view.dom.addEventListener('click', handleEditorClick, { capture: true })

    return () => {
      editor.view.dom.removeEventListener('click', handleEditorClick, { capture: true })
    }
  }, [editor])
```

with:

```ts
  useEffect(() => {
    const handleEditorClick = (event: MouseEvent) => {
      const link = findClickedLink(event.target, editor.view.dom)
      if (!link) return

      if (shouldOpenLink(event, editor.isEditable)) {
        event.preventDefault()
        event.stopPropagation()
        openLinkInNewWindow(link)
      }
    }

    editor.view.dom.addEventListener('click', handleEditorClick, { capture: true })

    return () => {
      editor.view.dom.removeEventListener('click', handleEditorClick, { capture: true })
    }
  }, [editor])
```

- [ ] **Step 4: Normalize on save**

Replace the `saveLink` body (currently lines 192-203):

```ts
  const saveLink = () => {
    const next = linkValue.trim()
    const chain = editor.chain().focus()
    if (!next) {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.unsetLink().run()
    } else {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.setLink({ href: next }).run()
    }
    setLinkDialogOpen(false)
  }
```

with:

```ts
  const saveLink = () => {
    const next = normalizeLinkHref(linkValue)
    const chain = editor.chain().focus()
    if (!next) {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.unsetLink().run()
    } else {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.setLink({ href: next }).run()
    }
    setLinkDialogOpen(false)
  }
```

- [ ] **Step 5: Verify the unused-import lint stays clean**

`findClickedLink` and `openLinkInNewWindow` are still used by the effect; `shouldOpenLink` is still used. No import becomes unused.

Run: `pnpm --filter @repo/editor exec vitest run src/components/floating-toolbar.test.ts`
Expected: PASS — existing `shouldShowTextToolbar` tests still pass (we didn't touch that function).

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/components/floating-toolbar.tsx
git commit -m "fix(editor): view-mode link clicks + no https:// prefill in toolbar dialog"
```

---

## Task 5: Add link HTMLAttributes to the page editor and server export

**Files:**
- Modify: `packages/editor/src/extensions/index.ts:79`
- Modify: `apps/web/src/server/page-export/server-extensions.ts:43`

- [ ] **Step 1: Page editor extensions**

In `packages/editor/src/extensions/index.ts`, line 79 currently is:

```ts
  Link.configure({ openOnClick: false, enableClickSelection: true }),
```

Replace with:

```ts
  Link.configure({
    openOnClick: false,
    enableClickSelection: true,
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
  }),
```

- [ ] **Step 2: Server export extensions**

In `apps/web/src/server/page-export/server-extensions.ts`, line 43 currently is:

```ts
    Link.configure({ openOnClick: false }),
```

Replace with:

```ts
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
    }),
```

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/index.ts apps/web/src/server/page-export/server-extensions.ts
git commit -m "fix(editor): open links in new tab in page editor and HTML export"
```

---

## Task 6: Link CSS (color, underline, pointer cursor)

**Files:**
- Modify: `packages/editor/src/styles/content.css`
- Test: `packages/editor/src/styles/content.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/editor/src/styles/content.test.ts`, add this block at the end of the file (after the `editor inline formatting styles` describe block, line 64):

```ts
describe('editor link styles', () => {
  it('styles anchors with a link color, underline, and pointer cursor', () => {
    const css = readFileSync(contentCssPath, 'utf8')

    expect(css).toMatch(/\.anynote-editor a\s*{[\s\S]*cursor:\s*pointer/)
    expect(css).toMatch(/\.anynote-editor a\s*{[\s\S]*text-decoration:\s*underline/)
    expect(css).toMatch(/\.anynote-editor a\s*{[\s\S]*color:\s*var\(--editor-link/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/editor exec vitest run src/styles/content.test.ts`
Expected: FAIL — the three new assertions fail (no `.anynote-editor a` rule exists).

- [ ] **Step 3: Add the CSS rule**

In `packages/editor/src/styles/content.css`, add this rule immediately after the mention rule block. That block is:

```css
.anynote-editor .mention {
  border-radius: 999px;
  background: rgba(25, 118, 210, 0.12);
  color: #1565c0;
  padding: 0 6px;
  white-space: nowrap;
}
```

Insert the new rule right after its closing `}` (before the `/* Code block: ... */` comment). Place it on its own lines:

```css
/* Links: clickable in view mode (handled in JS); give them visible affordances. */
.anynote-editor a {
  color: var(--editor-link, #2563eb);
  text-decoration: underline;
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/editor exec vitest run src/styles/content.test.ts`
Expected: PASS — all `content.test.ts` tests pass including the 3 new assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/styles/content.css packages/editor/src/styles/content.test.ts
git commit -m "fix(editor): give links color, underline, and pointer cursor"
```

---

## Task 7: Manual verification in the running app

**Files:** none (verification only)

This covers the DOM/prompt behaviour the unit tests cannot reach. Requires `docker compose up -d` and the dev server.

- [ ] **Step 1: Start infra and dev server**

Run: `docker compose up -d`
Run (background): `pnpm --filter web dev`
Wait for `Ready` / port 3000.

- [ ] **Step 2: Verify Bug 2 fix (no prefill) in a Kanban task**

- Open a Kanban board page, open a task, focus the description editor.
- Type `Задача в Jira`, select it, click the link (chain) toolbar button.
- Expected: the `window.prompt` URL field is **empty** (no `https://`).
- Paste a full URL `https://example.com/issues/ABC-1` and confirm.
- Expected: no `https://https://` duplication; the link text shows styled (blue, underlined).

- [ ] **Step 3: Verify smart-prefix**

- Add another link, enter a bare domain `example.com`, confirm.
- Inspect the anchor (devtools) — `href` is `https://example.com`.

- [ ] **Step 4: Verify Bug 1 fix (clickable) in view mode**

- Open the task in a read-only / commenter context (editable=false), or reload and view the description.
- Hover the link — cursor is a pointer.
- Left-click the link — it opens the URL in a **new tab**.

- [ ] **Step 5: Verify edit-mode click behaviour**

- In editable mode, plain left-click on the link text — caret is placed (link does NOT open), so the text is editable.
- Cmd/Ctrl/Alt + left-click — the link opens in a new tab.

- [ ] **Step 6: (Optional) Verify the full page editor**

- Create/open a TEXT page, select text, add a link via the floating toolbar dialog — field is empty; save; Cmd/Ctrl/Alt+click opens it.

No commit (verification only). If any check fails, return to the relevant task.

---

## Task 8: Gates

**Files:** none

- [ ] **Step 1: Run editor tests**

Run: `pnpm --filter @repo/editor test`
Expected: PASS — all editor vitest suites, including the 3 new/extended files.

- [ ] **Step 2: Type-check + lint the touched workspaces**

Run: `pnpm check-types`
Expected: PASS.
Run: `pnpm lint`
Expected: PASS (`--max-warnings 0`).

- [ ] **Step 3: Full gate (optional but recommended before merge)**

Run: `pnpm gates`
Expected: check-types + lint + build + test all green.

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide merge/PR. (Working on branch `fix/editor-link-tool`.)

---

## Notes for the implementer

- The `--editor-link` CSS variable has no global definition yet; the fallback `#2563eb` is intentional and sufficient. Do not add a theme variable unless the design system already exposes a link token (it does not — don't invent one).
- `enableClickSelection: true` exists only on the page editor's Link config (line 79); the plain editor does not use it — keep that difference.
- Don't remove `findClickedLink` or `openLinkInNewWindow` from `floating-toolbar.tsx`'s imports — both are still referenced after Task 4.
