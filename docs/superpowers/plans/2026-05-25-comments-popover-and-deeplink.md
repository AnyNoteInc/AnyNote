# Comments Popover + Deep-link + Resolve-icon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-text comment popover the primary per-thread surface (click highlight → popover; select text → composer popover), keep the right sidebar as the "all discussions" view via the toolbar icon, add a `#comment-<id>` deep-link that opens+highlights a thread in the sidebar, and move Resolve to a top-right corner icon.

**Architecture:** State stays in `PageCommentsProvider`. The editor renders one extra `.comment-highlight-active` decoration over the active anchor; a non-modal MUI `Popper` anchors to that decoration via a live `getBoundingClientRect` virtual element (follows scroll, survives ProseMirror re-renders). No screen coordinates are threaded through React. Builds on the committed `mergeRanges` flat-highlight fix.

**Tech Stack:** Next.js/React 19, MUI v6 (`Popper`, `ClickAwayListener`), Tiptap/ProseMirror decorations, Yjs `RelativePosition` anchors, vitest.

**Spec:** `docs/superpowers/specs/2026-05-25-comments-popover-and-deeplink-design.md`

**Branch:** `feat/comments-popover`. Run `pnpm --filter @repo/editor test`, `pnpm --filter web test`, `pnpm --filter web check-types`, `pnpm --filter @repo/editor check-types`, `pnpm lint` as gates.

---

## Task 1: Resolve/Reopen as a top-right corner icon (task 2)

**Files:**
- Modify: `apps/web/src/components/page/comments/thread-card.tsx`
- Test: `apps/web/test/thread-card.test.tsx` (create)

Reuse the already-imported `CheckRoundedIcon`. No new icon: the ✓ is outlined when active (→ `onResolve`, tooltip «Решить»); filled/`success.main` when resolved (→ `onReopen`, tooltip «Открыть заново»). Remove the bottom Resolve/Reopen button.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/thread-card.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThreadCard } from '@/components/page/comments/thread-card'

const base = {
  id: 't1',
  quotedText: 'quoted',
  resolvedAt: null as string | null,
  comments: [{ id: 'c1', authorId: 'u1', authorName: 'Alice', content: { text: 'hi' }, createdAt: new Date().toISOString() }],
}

describe('ThreadCard resolve icon', () => {
  it('calls onResolve from the top-right ✓ when active', () => {
    const onResolve = vi.fn()
    render(<ThreadCard thread={base} onReply={vi.fn()} onResolve={onResolve} onReopen={vi.fn()} onDeleteComment={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Решить' }))
    expect(onResolve).toHaveBeenCalledOnce()
  })

  it('calls onReopen from the corner icon when resolved', () => {
    const onReopen = vi.fn()
    render(<ThreadCard thread={{ ...base, resolvedAt: new Date().toISOString() }} onReply={vi.fn()} onResolve={vi.fn()} onReopen={onReopen} onDeleteComment={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть заново' }))
    expect(onReopen).toHaveBeenCalledOnce()
  })

  it('no longer renders a bottom "Решить" text button', () => {
    render(<ThreadCard thread={base} onReply={vi.fn()} onResolve={vi.fn()} onReopen={vi.fn()} onDeleteComment={vi.fn()} />)
    // the only "Решить" affordance is the icon button (aria-label), not a text button
    expect(screen.queryByText('Решить')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter web exec vitest run test/thread-card.test.tsx`
Expected: FAIL (no button named «Открыть заново» as icon; bottom text button «Решить» still present).

- [ ] **Step 3: Implement — header row with the corner icon, drop the bottom button**

In `thread-card.tsx`, replace the quoted-text `Typography` block and the trailing resolve `Box` with a header `Stack` carrying the icon, and remove the bottom block:

```tsx
// header: quoted text + corner resolve/reopen icon
<Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', flex: 1, minWidth: 0 }}>
    «{thread.quotedText}»
  </Typography>
  <Tooltip title={thread.resolvedAt ? 'Открыть заново' : 'Решить'}>
    <IconButton
      size="small"
      onClick={thread.resolvedAt ? onReopen : onResolve}
      aria-label={thread.resolvedAt ? 'Открыть заново' : 'Решить'}
      sx={{ width: 28, height: 28, flexShrink: 0, color: thread.resolvedAt ? 'success.main' : 'text.secondary' }}
    >
      <CheckRoundedIcon fontSize="small" />
    </IconButton>
  </Tooltip>
</Stack>
```

Delete the final `<Box sx={{ mt: 1, textAlign: 'right' }}>…Решить/Открыть заново…</Box>`. Remove the now-unused `Button` import.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter web exec vitest run test/thread-card.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/comments/thread-card.tsx apps/web/test/thread-card.test.tsx
git commit -m "feat(comments): resolve/reopen as a top-right corner icon"
```

---

## Task 2: `#comment-<id>` hash parser + deep-link hook (task 3)

**Files:**
- Create: `apps/web/src/components/page/comments/comment-hash.ts`
- Test: `apps/web/test/comment-hash.test.ts`
- Create: `apps/web/src/components/page/comments/use-comment-hash.ts` (wired in Task 6)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/comment-hash.test.ts
import { describe, expect, it } from 'vitest'
import { parseCommentHash } from '@/components/page/comments/comment-hash'

describe('parseCommentHash', () => {
  it('extracts the id from #comment-<id>', () => {
    expect(parseCommentHash('#comment-abc-123')).toBe('abc-123')
  })
  it('returns null for an empty id', () => {
    expect(parseCommentHash('#comment-')).toBeNull()
  })
  it('returns null for unrelated or empty hashes', () => {
    expect(parseCommentHash('#other')).toBeNull()
    expect(parseCommentHash('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter web exec vitest run test/comment-hash.test.ts`
Expected: FAIL with "Cannot find module … comment-hash".

- [ ] **Step 3: Implement the parser**

```ts
// apps/web/src/components/page/comments/comment-hash.ts
const COMMENT_HASH_RE = /^#comment-(.+)$/

/** Extract a thread id from a `#comment-<id>` URL hash, or null. */
export function parseCommentHash(hash: string): string | null {
  const m = COMMENT_HASH_RE.exec(hash)
  const id = m?.[1]?.trim()
  return id ? id : null
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter web exec vitest run test/comment-hash.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the hook (no test — thin DOM listener; covered by Playwright)**

```ts
// apps/web/src/components/page/comments/use-comment-hash.ts
'use client'

import { useEffect } from 'react'

import { parseCommentHash } from './comment-hash'

/** On mount and on hashchange, route `#comment-<id>` to the sidebar opener. */
export function useCommentHash(onTarget: (threadId: string) => void) {
  useEffect(() => {
    const apply = () => {
      const id = parseCommentHash(window.location.hash)
      if (id) onTarget(id)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [onTarget])
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/page/comments/comment-hash.ts apps/web/src/components/page/comments/use-comment-hash.ts apps/web/test/comment-hash.test.ts
git commit -m "feat(comments): parse #comment-<id> deep-link hash"
```

---

## Task 3: Editor — active-anchor emphasis decoration (task 4 support)

**Files:**
- Modify: `packages/editor/src/comment-ranges.ts` (add `commentDecorationSpecs`)
- Test: `packages/editor/src/comment-ranges.test.ts` (extend)
- Modify: `packages/editor/src/extensions/comments.ts` (active state + command + use specs)
- Modify: `packages/editor/src/types.ts` (prop), `packages/editor/src/anynote-editor.tsx` (effect)
- Modify: `packages/editor/src/styles/content.css` (active style)

- [ ] **Step 1: Write the failing test for `commentDecorationSpecs`**

```ts
// append to packages/editor/src/comment-ranges.test.ts
import { commentDecorationSpecs } from './comment-ranges'

describe('commentDecorationSpecs', () => {
  it('merges base ranges and omits an active spec when none is set', () => {
    expect(commentDecorationSpecs([{ from: 0, to: 5 }, { from: 3, to: 8 }], null)).toEqual([
      { from: 0, to: 8, className: 'comment-highlight' },
    ])
  })

  it('adds one comment-highlight-active spec on top of the merged base', () => {
    expect(commentDecorationSpecs([{ from: 0, to: 5 }, { from: 3, to: 8 }], { from: 3, to: 8 })).toEqual([
      { from: 0, to: 8, className: 'comment-highlight' },
      { from: 3, to: 8, className: 'comment-highlight-active' },
    ])
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @repo/editor exec vitest run src/comment-ranges.test.ts`
Expected: FAIL — `commentDecorationSpecs` is not exported.

- [ ] **Step 3: Implement `commentDecorationSpecs`**

```ts
// add to packages/editor/src/comment-ranges.ts
export type DecoSpec = { from: number; to: number; className: string }

/** Flat base highlights for all comment ranges, plus an optional emphasis
 *  spec for the active anchor (rendered as a separate non-translucent layer). */
export function commentDecorationSpecs(base: DecoRange[], active: DecoRange | null): DecoSpec[] {
  const specs: DecoSpec[] = mergeRanges(base).map((r) => ({ ...r, className: 'comment-highlight' }))
  if (active && active.to > active.from) {
    specs.push({ from: active.from, to: active.to, className: 'comment-highlight-active' })
  }
  return specs
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `pnpm --filter @repo/editor exec vitest run src/comment-ranges.test.ts`
Expected: PASS (all prior + 2 new).

- [ ] **Step 5: Wire the active anchor into the extension**

In `packages/editor/src/extensions/comments.ts`:

Add to `PluginState`: `activeAnchor: Pick<CommentThreadAnchor, 'anchorStart' | 'anchorEnd'> | null`. Init `{ threads: [], activeAnchor: null }`. In `apply`, merge meta partials: `return meta ? { ...value, ...meta } : value`.

Add a command:

```ts
setActiveCommentAnchor:
  (anchor) =>
  ({ tr, dispatch }) => {
    if (dispatch) dispatch(tr.setMeta(commentsPluginKey, { activeAnchor: anchor }))
    return true
  },
```

(Update the `Commands` module augmentation to add `setActiveCommentAnchor: (anchor: Pick<CommentThreadAnchor,'anchorStart'|'anchorEnd'> | null) => ReturnType`.)

Rewrite `decorations` to use the specs builder:

```ts
import { commentDecorationSpecs } from '../comment-ranges'
// ...
decorations(state) {
  const pstate = commentsPluginKey.getState(state)
  if (!pstate) return DecorationSet.empty
  const base: { from: number; to: number }[] = []
  for (const t of pstate.threads) {
    if (t.resolvedAt) continue
    const range = anchorToRange(state, t)
    if (range) base.push(range)
  }
  const active = pstate.activeAnchor ? anchorToRange(state, pstate.activeAnchor) : null
  const specs = commentDecorationSpecs(base, active)
  if (specs.length === 0) return DecorationSet.empty
  const decos = specs.map((s) => Decoration.inline(s.from, s.to, { class: s.className }))
  return DecorationSet.create(state.doc, decos)
},
```

- [ ] **Step 6: Add the editor prop + effect**

`packages/editor/src/types.ts` — add to `EditorContentProps`:

```ts
activeCommentAnchor?: { anchorStart: string; anchorEnd: string } | null
```

`packages/editor/src/anynote-editor.tsx` — after the `setCommentThreads` effect:

```ts
useEffect(() => {
  if (!editor) return
  editor.commands.setActiveCommentAnchor(props.activeCommentAnchor ?? null)
}, [editor, props.activeCommentAnchor])
```

- [ ] **Step 7: Active highlight CSS**

`packages/editor/src/styles/content.css` — after `.comment-highlight`:

```css
.anynote-editor .comment-highlight-active {
  box-shadow: 0 0 0 2px #ffb300;
  border-radius: 2px;
}
```

(No extra background → never darkens over the base highlight.)

- [ ] **Step 8: Run editor gates**

Run: `pnpm --filter @repo/editor test && pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add packages/editor/src
git commit -m "feat(editor): emphasis decoration for the active comment anchor"
```

---

## Task 4: Context — popover vs sidebar split + derived activeAnchor

**Files:**
- Modify: `apps/web/src/components/page/comments/comments-context.tsx`
- Modify: `apps/web/src/components/page/comments/comments-sidebar.tsx` (drop composer block)
- Modify: `apps/web/test/comments-sidebar.test.tsx` (mock new shape)
- Modify: `apps/web/test/comment-toggle-button.test.tsx` (mock new shape)

This task changes the context value shape, so its consumers (`page-renderer.tsx`, sidebar, tests) update together to keep the build green. `page-renderer` wiring is finished in Task 6; here we keep it compiling by aliasing.

- [ ] **Step 1: Update the context type + state**

In `comments-context.tsx`:

```ts
export type CommentPopover = { kind: 'thread'; threadId: string } | { kind: 'new' }
```

Replace `openThread`/`clearOpenThread` exposure with the split. State additions:

```ts
const [popover, setPopover] = useState<CommentPopover | null>(null)
// keep: panelOpen, openThreadId, newAnchor
```

Actions:

```ts
const openThreadPopover = useCallback((id: string) => setPopover({ kind: 'thread', threadId: id }), [])
const closePopover = useCallback(() => {
  setPopover(null)
  setNewAnchor(null)
}, [])
const openThreadInSidebar = useCallback((id: string) => {
  setOpenThreadId(id)
  setPanelOpen(true)
}, [])
```

Change `startNewThread` to open the popover (not the panel):

```ts
const startNewThread = useCallback((anchor: NewThreadAnchor) => {
  setNewAnchor(anchor)
  setPopover({ kind: 'new' })
}, [])
```

`createThread` already clears `newAnchor`; also `setPopover(null)` there. Target-change reset: also `setPopover(null)`.

Derived active anchor (before the `value` memo):

```ts
const activeThreadId = popover?.kind === 'thread' ? popover.threadId : panelOpen ? openThreadId : null
const activeRaw = popover?.kind === 'new' ? newAnchor : anchors.find((a) => a.id === activeThreadId) ?? null
const activeAnchor = activeRaw ? { anchorStart: activeRaw.anchorStart, anchorEnd: activeRaw.anchorEnd } : null
```

- [ ] **Step 2: Update the context value + type**

Add to `PageCommentsContextValue` and the `value` memo (with deps): `popover`, `openThreadPopover`, `closePopover`, `openThreadInSidebar`, `activeAnchor`. Remove `openThread`. Keep `panelOpen`, `togglePanel`, `closePanel`, `openThreadId`, `newAnchor`, `startNewThread`, `cancelNewThread`, and all mutations.

- [ ] **Step 3: Drop the new-comment composer block from the sidebar**

In `comments-sidebar.tsx`, delete the `{newAnchor ? (…composer…) : null}` block and remove `newAnchor`, `createThread`, `cancelNewThread` from the destructure. The empty-state condition becomes `shown.length === 0`.

- [ ] **Step 4: Update the two context-mock tests**

In `comment-toggle-button.test.tsx` and `comments-sidebar.test.tsx`, update the mocked context object: remove `openThread`; add `popover: null, openThreadPopover: vi.fn(), closePopover: vi.fn(), openThreadInSidebar: vi.fn(), activeAnchor: null`. In `comments-sidebar.test.tsx` remove assertions about the in-sidebar new-comment composer (moved to the popover).

- [ ] **Step 5: Keep `page-renderer` compiling**

In `page-renderer.tsx:118`, temporarily alias to avoid a broken build: change destructure to `{ anchors, canComment, startNewThread, openThreadPopover }` and `onOpenThread={openThreadPopover}` at line 474. (Full wiring + popover mount in Task 6.)

- [ ] **Step 6: Run web gates**

Run: `pnpm --filter web exec vitest run test/comments-sidebar.test.tsx test/comment-toggle-button.test.tsx && pnpm --filter web check-types`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/page/comments/comments-context.tsx apps/web/src/components/page/comments/comments-sidebar.tsx apps/web/src/components/page/page-renderer.tsx apps/web/test/comments-sidebar.test.tsx apps/web/test/comment-toggle-button.test.tsx
git commit -m "refactor(comments): split popover vs sidebar state in context"
```

---

## Task 5: CommentPopover component

**Files:**
- Create: `apps/web/src/components/page/comments/comment-popover.tsx`
- Modify: `packages/ui/src/components/index.ts` (re-export `Popper`, `ClickAwayListener`)

- [ ] **Step 1: Re-export the MUI primitives**

In `packages/ui/src/components/index.ts`, add (matching the existing re-export style):

```ts
export { default as Popper } from '@mui/material/Popper'
export { default as ClickAwayListener } from '@mui/material/ClickAwayListener'
```

Verify exact pattern against neighbors first (some files use `export { X } from '@mui/material'`). Match whatever is already used.

- [ ] **Step 2: Write the component**

```tsx
// apps/web/src/components/page/comments/comment-popover.tsx
'use client'

import { useEffect, useMemo } from 'react'

import { Box, ClickAwayListener, Paper, Popper, Typography } from '@repo/ui/components'

import { CommentComposer } from './comment-composer'
import { usePageCommentsContext } from './comments-context'
import { ThreadCard } from './thread-card'

const ACTIVE_SELECTOR = '.comment-highlight-active'
const ZERO_RECT = {
  width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
} as DOMRect

export function CommentPopover() {
  const {
    popover, closePopover, newAnchor, threads, canDeleteComments,
    createThread, addComment, resolveThread, reopenThread, deleteComment,
  } = usePageCommentsContext()

  // Virtual anchor: re-query the active highlight on every reposition so the
  // popover follows the text on scroll and survives ProseMirror re-rendering.
  const anchorEl = useMemo(
    () => ({ getBoundingClientRect: () => document.querySelector(ACTIVE_SELECTOR)?.getBoundingClientRect() ?? ZERO_RECT }),
    [],
  )

  useEffect(() => {
    if (!popover) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePopover() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover, closePopover])

  if (!popover) return null
  const thread = popover.kind === 'thread' ? threads.find((t) => t.id === popover.threadId) ?? null : null
  if (popover.kind === 'thread' && !thread) return null

  return (
    <Popper open anchorEl={anchorEl} placement="bottom-start" style={{ zIndex: 1300 }}
      modifiers={[{ name: 'offset', options: { offset: [0, 6] } }, { name: 'flip', enabled: true }]}>
      <ClickAwayListener onClickAway={closePopover}>
        <Paper variant="outlined" sx={{ width: 320, maxHeight: 380, overflow: 'auto', boxShadow: 4 }}>
          {popover.kind === 'new' && newAnchor ? (
            <Box sx={{ p: 1.5 }}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.5 }}>
                «{newAnchor.quotedText}»
              </Typography>
              <CommentComposer autoFocus onSubmit={createThread} />
            </Box>
          ) : thread ? (
            <ThreadCard
              thread={thread}
              active
              canDeleteComments={canDeleteComments}
              onReply={(c) => addComment(thread.id, c)}
              onResolve={() => resolveThread(thread.id)}
              onReopen={() => reopenThread(thread.id)}
              onDeleteComment={deleteComment}
            />
          ) : null}
        </Paper>
      </ClickAwayListener>
    </Popper>
  )
}
```

**Known consideration (verify in Task 7 via Playwright):** clicking a *second* highlight while a popover is open — ClickAwayListener fires `closePopover`, then the editor's `onOpenThread` re-opens for the new thread. If this flickers/loses the new popover, switch `ClickAwayListener` to `mouseEvent="onMouseDown"` and/or ignore click-away when the event target is inside the editor (`.comment-highlight*`).

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types && pnpm --filter @repo/ui check-types`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/comments/comment-popover.tsx packages/ui/src/components/index.ts
git commit -m "feat(comments): in-text thread popover anchored to the active highlight"
```

---

## Task 6: Wire it together (page-renderer + provider)

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/page/comments/comments-context.tsx` (mount `useCommentHash`)

- [ ] **Step 1: Mount the deep-link hook in the provider**

In `comments-context.tsx`, inside `PageCommentsProvider` (after the actions), call:

```ts
useCommentHash(openThreadInSidebar)
```

(Import `useCommentHash` from `./use-comment-hash`.) This force-opens the sidebar + sets `openThreadId` (→ sidebar scroll/highlight + `activeAnchor` emphasis in text) whenever `#comment-<id>` is present.

- [ ] **Step 2: Pass the active anchor to the editor + mount the popover**

In `page-renderer.tsx`: destructure `activeAnchor` and `openThreadPopover` from context (line ~118). At the editor (line ~470) add `activeCommentAnchor={activeAnchor}` and confirm `onOpenThread={openThreadPopover}`. Render `<CommentPopover />` once inside the TEXT branch (next to the editor, e.g. after the `AnyNoteEditor`). Import `CommentPopover` from `./comments/comment-popover`.

- [ ] **Step 3: Type-check + unit tests**

Run: `pnpm --filter web check-types && pnpm --filter web test`
Expected: clean / PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx apps/web/src/components/page/comments/comments-context.tsx
git commit -m "feat(comments): wire popover + #comment deep-link into the page"
```

---

## Task 7: Full gates + Playwright verification

- [ ] **Step 1: Gates**

Run: `pnpm check-types && pnpm lint && pnpm --filter web test && pnpm --filter @repo/editor test`
Expected: all green.

- [ ] **Step 2: Playwright (manual MCP drive)** — bring up the dev stack and a logged-in session, open a TEXT page with ≥2 overlapping comments, and confirm:
  - overlapping highlights are uniform (no dark patch);
  - click a highlight → popover with the thread, anchored at the text; reply/resolve work;
  - select text → «Комментировать» → composer popover; submit creates the thread;
  - 💬 toolbar icon → right sidebar list (left sidebar stays);
  - navigate to `…/pages/<id>#comment-<threadId>` → sidebar opens, scrolls to + highlights the thread, and the text anchor shows the `.comment-highlight-active` ring;
  - clicking a second highlight cleanly swaps the popover (see Task 5 consideration).

- [ ] **Step 3: Commit any fixes; push the branch**

```bash
git push -u origin feat/comments-popover
```

---

## Self-review notes (author)

- **Spec coverage:** task 2 → resolve icon (Task 1); task 3 → hash hook (Task 2) + sidebar open/emphasis (Tasks 3,4,6); task 4 → popover (Tasks 3–6); highlight-merge fix already committed and reused by `commentDecorationSpecs`.
- **Type consistency:** `CommentPopover` type, `popover`/`openThreadPopover`/`openThreadInSidebar`/`activeAnchor` names, `commentDecorationSpecs`/`DecoSpec`, `setActiveCommentAnchor`, `activeCommentAnchor` prop, `parseCommentHash` — used consistently across tasks.
- **Out of scope:** generating the `#comment-<id>` link ("copy link") — handler only.
