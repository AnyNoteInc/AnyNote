# Comments: in-text popover, #comment deep-link, resolve-as-icon — Design Spec

**Date:** 2026-05-25
**Status:** Draft, awaiting user review
**Branch:** `main` (working tree; builds on the merged right-sidebar work and the uncommitted highlight-merge fix)

## Summary

Evolve the page-comments UX toward the Notion model (user supplied Notion screenshots as the reference). Today, clicking an in-text comment highlight opens the **right sidebar**; the sidebar is the only place a thread can be read or created. This spec keeps the sidebar as the "all discussions" overview but makes the **in-text popover** the primary per-thread surface:

1. **In-text popover (task 4).** Clicking a comment highlight opens a floating **popover with the thread** anchored to the text (view / reply / resolve / delete). Selecting text → «Комментировать» opens a **popover composer** at the selection. The full list stays reachable via the 💬 icon in the toolbar (→ right sidebar, unchanged).
2. **`#comment-<id>` deep-link (task 3).** When the page URL carries `#comment-<threadId>`, force-open the **sidebar**, scroll to that thread, and emphasize it (in the list and in the text).
3. **Resolve as a corner icon (task 2).** Move the «Решить» action from a bottom text button to a **✓ icon in the card's top-right corner** (resolved threads show a "reopen" icon). `ThreadCard` is shared by the popover and the sidebar, so this lands once.

This builds on the already-applied **highlight-merge fix** (overlapping translucent highlights were compounding into dark patches; `mergeRanges` flattens them). That fix stays; on top of it we add a single **emphasized** decoration for the active thread.

**No DB / tRPC / permission / realtime changes.** `usePageComments`, the comment router, anchors-as-decorations, anonymous identity, and SSE subscriptions are untouched.

---

## 1. Goals & Non-goals

### Goals

- Clicking an in-text highlight opens a **non-modal popover** with the thread, anchored to the highlighted text; it follows the text on scroll and closes on outside-click / Escape / navigation.
- Selecting text → «Комментировать» opens a **popover composer** at the selection; submit creates the thread.
- The 💬 toolbar icon still opens the **right sidebar** with the full thread list (the "all discussions" view) — unchanged entry point.
- `#comment-<threadId>` in the URL hash force-opens the **sidebar**, scrolls to + highlights that thread, and **emphasizes its anchor in the text**.
- Resolve/Reopen is a **top-right corner icon** on the thread card (shared by popover + sidebar).
- The active thread's in-text anchor gets a distinct **emphasized** highlight that does **not** compound/darken (separate from the flat base highlight).

### Non-goals

- **No data-layer changes** (schema, router, permissions, notifications, subscriptions).
- **No change to anchoring** — anchors remain Yjs `RelativePosition` decorations; orphaned-thread behavior unchanged.
- **No comments for non-TEXT page types.**
- **"Copy link to comment" (generating `#comment-<id>`) is out of scope** for this spec — we only **handle** an incoming hash. (Noted as a follow-up; without it the deep-link is exercised by editing the URL manually or from tests.)
- **No multi-thread chooser** when a click lands on text covered by several threads — the existing first-match-by-position rule stands (popover shows that thread).

---

## 2. Architecture overview

Two distinct "open a thread" paths, intentionally different (confirmed with the user):

```
click highlight ─────────────▶ POPOVER (anchored to the text)        openThreadPopover(id)
select text → «Комментировать» ▶ POPOVER composer (at the selection)  startNewThread(anchor)
💬 toolbar icon ──────────────▶ SIDEBAR list (all threads)            togglePanel()
#comment-<id> in URL ─────────▶ SIDEBAR + scroll + emphasize          openThreadInSidebar(id)
```

State stays in `PageCommentsProvider` (the existing context). It already sits at the lowest common ancestor of the toolbar toggle, the editor, and the sidebar; the **popover** mounts under it too (rendered from `PageRenderer`, beside the editor).

**Positioning** uses a single mechanism: the editor renders one **emphasized** decoration (`.comment-highlight-active`) over the active anchor's range. The popover's `Popper` anchors to a **virtual element** whose `getBoundingClientRect()` re-queries `.comment-highlight-active` live, so it follows scroll/resize and survives ProseMirror re-rendering the span. No screen coordinates are threaded through React state.

```
PageCommentsProvider
  ├─ CommentToggleButton   → toolbar 💬 (togglePanel)                 [unchanged]
  ├─ PageRenderer → AnyNoteEditor (anchors, onOpenThread, onCreateComment, activeAnchor)
  │     └─ CommentPopover  → Popper anchored to .comment-highlight-active   [new]
  ├─ CommentsSidebar       → right column, list only (no composer)   [trimmed]
  └─ useCommentHash()      → reads #comment-<id> → openThreadInSidebar [new]
```

---

## 3. Components

All under `apps/web/src/components/page/comments/` unless noted.

### 3.1 `comment-popover.tsx` _(new)_

- MUI **`Popper`** (not `Popover`/`Modal`) + **`ClickAwayListener`** — non-modal, no backdrop, so the rest of the page stays interactive.
- `anchorEl` = a memoized **virtual element**: `{ getBoundingClientRect: () => document.querySelector('.comment-highlight-active')?.getBoundingClientRect() ?? ZERO_RECT }`. Placement `bottom-start` with a flip modifier; `z-index` above the editor.
- Renders, based on context:
  - `popover.kind === 'thread'` → **`ThreadCard`** for that thread (full conversation + reply + resolve/delete).
  - `popover.kind === 'new'` → quoted-text label + `CommentComposer` (autofocus) + Cancel; submit → `createThread`.
- Closes (→ `closePopover()`) on click-away, Escape, and target/page change. Width ~320, `maxHeight` with internal scroll.

### 3.2 `thread-card.tsx` _(task 2)_

- Add a **header row**: italic quoted text on the left, a **✓ `IconButton`** (`CheckRoundedIcon`, tooltip «Решить») top-right for active threads; for resolved threads, a **reopen** icon (`ReplayIcon`/`RestoreIcon`, tooltip «Открыть заново»).
- Remove the bottom Resolve/Reopen button.
- Per-comment delete button is unchanged.
- Used by both `CommentPopover` and `CommentsSidebar`.
- If `@repo/ui/components` doesn't already re-export the reopen icon, add the re-export (per CLAUDE.md UI-import rule).

### 3.3 `comments-context.tsx` _(extended)_

Split the single "open thread" notion into **popover** vs **sidebar**, and derive the active anchor:

- New state: `popover: { kind: 'thread'; threadId: string } | { kind: 'new' } | null`.
- `openThreadPopover(id)` → `popover = { kind: 'thread', threadId: id }` (wired to the editor's `onOpenThread`).
- `startNewThread(anchor)` → sets `newAnchor` **and** `popover = { kind: 'new' }` (no longer opens the sidebar).
- `closePopover()` → clears `popover` (+ `newAnchor` when kind was `new`).
- Keep sidebar state: `panelOpen`, `togglePanel`, `closePanel`, `openThreadId`.
- `openThreadInSidebar(id)` → `panelOpen = true`, `openThreadId = id` (sidebar scroll/highlight; used by the deep-link).
- Derived **`activeAnchor: { anchorStart; anchorEnd } | null`** = anchor of `popover.threadId`, else `newAnchor`, else (`panelOpen ? openThreadId : null`). This is the single source for the in-text emphasis.
- `createThread` clears `popover` on success (as it clears `newAnchor` today).
- Target-change reset also clears `popover`.

### 3.4 `comments-sidebar.tsx` _(trimmed)_

- **Remove** the `newAnchor` composer block (creation moved to the popover).
- Keep: header + close, Активные/Решённые tabs, the thread-card list, and the `openThreadId` scroll/highlight effect.
- Cards reuse the updated `ThreadCard` (resolve is now the corner icon).

### 3.5 `use-comment-hash.ts` _(new)_

- A hook mounted inside the provider. On mount and on `hashchange`, parse `location.hash`; if it matches `^#comment-(.+)$`, call `openThreadInSidebar(id)`. Guard against re-firing for the same id. Pure parse helper `parseCommentHash(hash): string | null` is unit-tested.

### 3.6 Editor — `packages/editor`

- `extensions/comments.ts`: keep `mergeRanges` for the flat base highlights. Add plugin state `activeAnchor` + command **`setActiveCommentAnchor(anchor | null)`**; in `decorations`, after the merged base decorations, push one `Decoration.inline(range.from, range.to, { class: 'comment-highlight-active' })` for the active anchor's resolved range.
- `anynote-editor.tsx`: new prop `activeCommentAnchor?: { anchorStart; anchorEnd } | null`; an effect calls `setActiveCommentAnchor` (mirrors the existing `setCommentThreads` effect). `onOpenThread(id)` signature unchanged.
- `styles/content.css`: `.comment-highlight-active` — emphasis that does **not** add another translucent layer (so it can't darken over the base highlight). Concretely: a solid 2px outline/ring (via `box-shadow: 0 0 0 2px #ffb300`) + a brighter solid underline; **no extra background**. Marks "this is the selected comment."
- `page-renderer.tsx`: pass `activeCommentAnchor={activeAnchor}` to the editor; mount `<CommentPopover/>`; keep `onOpenThread={openThreadPopover}` and `onCreateComment={startNewThread}`.

---

## 4. Interaction flows

- **Open from text:** click highlight → `onOpenThread(id)` → `openThreadPopover(id)` → `activeAnchor` set → editor paints `.comment-highlight-active` → popover anchors to it (thread view).
- **Create:** select text → FloatingToolbar «Комментировать» → `onCreateComment(anchor)` → `startNewThread(anchor)` → popover composer at the selection → submit → `createThread` → `closePopover`.
- **Open all:** 💬 → `togglePanel` → sidebar list.
- **Deep-link:** load/`hashchange` with `#comment-<id>` → `openThreadInSidebar(id)` → sidebar opens, scrolls to + highlights the card; `activeAnchor` (= openThreadId) emphasizes the anchor in text.
- **Resolve / Reopen:** corner ✓ / reopen icon on the card (popover or sidebar) → context mutation.
- **Coexistence:** a click always opens the popover, even if the sidebar is open (the two are independent surfaces).
- **Realtime / anonymous / permissions:** unchanged.

---

## 5. Context value shape (delta)

```ts
type Popover = { kind: 'thread'; threadId: string } | { kind: 'new' }

type PageCommentsContextValue = {
  // unchanged: enabled, threads, anchors, activeCount, canComment, canDeleteComments
  // unchanged: createThread, addComment, resolveThread, reopenThread, deleteComment

  // sidebar ("all discussions")
  panelOpen: boolean
  togglePanel: () => void
  closePanel: () => void
  openThreadId: string | null
  openThreadInSidebar: (id: string) => void // #comment deep-link

  // popover (per-thread + create)
  popover: Popover | null
  openThreadPopover: (id: string) => void // editor onOpenThread
  closePopover: () => void
  newAnchor: NewThreadAnchor | null
  startNewThread: (a: NewThreadAnchor) => void // opens the new-comment popover

  // in-text emphasis (derived)
  activeAnchor: { anchorStart: string; anchorEnd: string } | null
}
```

(`openThread`/`clearOpenThread` from the prior spec are replaced by `openThreadPopover` + `openThreadInSidebar`.)

---

## 6. Testing

- **`comment-ranges.test.ts`** (done) — flat highlight merge.
- **`comment-hash.test.ts`** (new) — `parseCommentHash`: `#comment-abc` → `abc`; `#comment-` / `#other` / `''` → `null`.
- **Editor active decoration** (new, `@repo/editor`) — given threads + an active anchor over an overlapping range, the decoration set contains exactly one `.comment-highlight-active` over the active range plus the merged base highlights (no compounding).
- **`comments-sidebar.test.tsx`** (update) — composer block removed; list/tabs/scroll still work; resolve via the corner icon calls the mutation.
- **`thread-card`** — corner ✓ calls `onResolve`; resolved card shows reopen icon calling `onReopen`.
- **Playwright (task 1 + final verification):** bring up the dev server + a test session and confirm: click → popover; select → composer popover; 💬 → sidebar; `#comment-<id>` → sidebar scroll + emphasis; overlapping highlights no longer darken.

---

## 7. Implementation sequence

1. **`thread-card.tsx`** — resolve/reopen corner icon (task 2). Self-contained.
2. **`comments-context.tsx`** — popover vs sidebar split, `activeAnchor`, new actions.
3. **Editor** — `activeCommentAnchor` prop + `setActiveCommentAnchor` command + `.comment-highlight-active` decoration + CSS.
4. **`comment-popover.tsx`** — Popper anchored to `.comment-highlight-active`; thread vs composer.
5. **`comments-sidebar.tsx`** — drop the composer block; keep list + scroll/highlight.
6. **`page-renderer.tsx`** — pass `activeCommentAnchor`, mount `CommentPopover`, wire `onOpenThread`/`onCreateComment`.
7. **`use-comment-hash.ts`** (+ `comment-hash.test.ts`) — deep-link handling (task 3).
8. Tests (§6) + `pnpm gates` + Playwright verification.

---

## 8. Out of scope / follow-ups

- "Copy link to comment" that generates `#comment-<id>` (e.g. from a card «…» menu). Add later to make the deep-link reachable from the UI.
- Reactions/emoji on comments (seen in the Notion reference) — not requested.
- Persisting sidebar open/closed state.
