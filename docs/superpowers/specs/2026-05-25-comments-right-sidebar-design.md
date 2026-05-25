# Move page comments into a right sidebar — Design Spec

**Date:** 2026-05-25
**Status:** Draft, awaiting user review
**Branch:** `feat/page-comments`

## Summary

Relocate the **inline page comments** UI (built in `2026-05-24-page-comments-design.md`). Today the comment toggle floats over the editor (`position: absolute; top/right: 8`) and the panel renders **inside the content flex row**, and opening it **hides the left workspace sidebar**. The result reads as "mixed with the content and in the wrong place."

This spec moves the UI, **not the data**:

- **Remove** the floating toggle button and the in-content panel from the page body.
- **Move the 💬 toggle into the top toolbar**, immediately left of the ⭐ favorite star → order **📤 Share · 💬 · ⭐ · ⋯**. On the public share page (no toolbar/star), the toggle goes into the page's existing header bar next to «Общий доступ».
- **Move the threads into a real right sidebar** that _pushes_ content (its own column, like the left sidebar) — the left sidebar **stays open**.
- **Threads expand inline in the sidebar** (Google-Docs style): conversation + reply box + Resolve shown in place; clicking an in-text anchor scrolls to + highlights its thread. The previous click-to-popover (`ThreadCard` in a `Popover`) is removed; the new-comment composer also moves into the sidebar.
- Applies **consistently** to both the in-app page view and the public share view.

**No DB / tRPC / permission / realtime changes.** `usePageComments`, the comment router, anchors-as-decorations, anonymous identity, and SSE subscriptions are all untouched. This is a pure UI relocation + state-sharing refactor.

---

## 1. Goals & Non-goals

### Goals

- The editor content area contains **only the document** — no floating comment button, no inline panel overlapping the text.
- The 💬 toggle (with active-thread count `Badge`) lives in the **top toolbar**, left of ⭐ in-app, and in the **share header** on public pages. It renders only for **TEXT** pages.
- A **right sidebar** holds comments as a pushed column; the **left sidebar is no longer hidden** when comments open.
- In the sidebar: Активные / Решённые tabs; each thread is a card showing its **full conversation, a reply box, and Resolve/Reopen** inline; the **active** thread (from an anchor click or card click) is highlighted and scrolled into view.
- **Creating a comment** (select text → «Комментировать») opens the sidebar and shows a **new-comment composer** bound to that anchor; submit creates the thread.
- Same behavior and components reused across the **in-app** and **share** contexts.
- @mentions in the composer keep working (the mention search provider is available to the sidebar).

### Non-goals

- **No data-layer changes** — no schema, router, permission, notification, or subscription changes.
- **No change to anchoring** — anchors remain Yjs `RelativePosition` decorations; orphaned-thread behavior is unchanged.
- **No comments for non-TEXT page types** (unchanged from v1).
- **No restyling of the comment cards' internals** beyond removing the `Paper`/`Popover` chrome and arranging them in the sidebar (reuse `ThreadCard`'s conversation/reply/resolve UI).
- **No new sidebar persistence** (open/closed state is in-memory per page view; not stored in localStorage in v1).

---

## 2. Architecture overview

The comment **state + data** must be shared by three things that sit in different parts of the tree: the **toolbar toggle**, the **editor** (anchors + triggers), and the **right sidebar** (threads + mutations). A React **context provider** mounted at their lowest common ancestor solves this without globals.

```
PageCommentsProvider  (owns usePageComments + UI state; hosts CommentMentionSearchProvider)
  ├─ CommentToggleButton        → toolbar (in-app: PageActionsToolbar; share: header Stack)
  ├─ PageRenderer → AnyNoteEditor (anchors, canComment, onCreateComment, onOpenThread)  [reads context]
  └─ CommentsSidebar            → right column (pushed), threads expanded inline        [reads context]
```

- **In-app** lowest common ancestor = `mainContent` in `workspace-layout-client.tsx` (it builds both the toolbar's `rightSlot` and `children`). Provider wraps it; sidebar renders in the content row beside the scroll area.
- **Share** lowest common ancestor = the share page body in `s/[shareId]/page.tsx` (header + content). The provider is a client component that accepts the server-rendered header/content as `children`; the toggle and sidebar are client components rendered under it.

The provider, toggle, and sidebar components are **written once and reused** in both contexts; only the mount site and a few props differ.

---

## 3. Components

All under `apps/web/src/components/page/comments/`.

### 3.1 `comments-context.tsx` _(new)_

`PageCommentsProvider` + `usePageCommentsContext()`.

Props:

```ts
type PageCommentsProviderProps = {
  target: CommentTarget // { pageId } | { shareId }
  pageType: PageType // gates `enabled` (only 'TEXT')
  canComment: boolean // in-app: true; share: role !== 'READER'
  canDeleteComments: boolean // in-app: true; share: false (no logged-in moderator guarantee)
  workspaceId: string // for mention search
  children: ReactNode
}
```

Internally:

- Calls `usePageComments(target, { enabled: pageType === 'TEXT' })`.
- Derives `uiThreads` (for the sidebar) and `anchors: CommentThreadAnchor[]` (for the editor) — the exact `RawThread`/`UiThread` mapping currently inlined in `PageRenderer` moves here.
- Owns UI state: `panelOpen`, `openThreadId`, `newAnchor` (the pending `{ anchorStart, anchorEnd, quotedText }`).
- Exposes a context value (see §6) including `togglePanel`, `openThread(id)` (sets `openThreadId` + opens panel), `startNewThread(anchor)` (sets `newAnchor` + opens panel), `cancelNewThread`, and bound mutation callbacks (`createThread`, `addComment`, `resolveThread`, `reopenThread`, `deleteComment`) wired to `comments.base`.
- Wraps `children` in `CommentMentionSearchProvider value={mentionSearch}` (the `mentionSearch` callback built from `workspaceId` + tRPC, identical to today's `PageRenderer` version) so the sidebar's `CommentComposer` resolves @mentions via `CommentMentionSearchContext` (it already falls back to that context when no `mentionSearch` prop is passed).

`enabled === false` (non-TEXT) ⇒ context still renders children, but `CommentToggleButton` and `CommentsSidebar` render `null`.

### 3.2 `comment-toggle-button.tsx` _(new)_

The 💬 `IconButton` + count `Badge`, extracted from `PageRenderer`. Reads context: hidden when `!enabled`; `onClick = togglePanel`; `Badge badgeContent={activeCount}`. No absolute positioning — it's an inline toolbar button (`size="small"`, `color: text.secondary` to match `FavoriteStar`).

### 3.3 `comments-sidebar.tsx` _(rewrite of `comments-panel.tsx`)_

The right column. Width ~320, full height, own scroll, `borderLeft`. Reads context. Renders:

- Header «Комментарии» + close button (`setPanelOpen(false)`).
- Активные / Решённые tab toggle (as today).
- When `newAnchor` is set: a **new-comment composer card** at the top (quoted text label + `CommentComposer` + Cancel/Submit); submit ⇒ `createThread({ ...base, ...newAnchor, content })` then `cancelNewThread()`.
- A list of thread cards for the active tab. Each card reuses **`ThreadCard`**'s conversation/reply/resolve/delete UI (the `Paper` wrapper is dropped or restyled to a flat card). The card matching `openThreadId` gets a highlight ring and is `scrollIntoView`'d.
- Empty state «Нет комментариев».

`ThreadCard` (`thread-popover.tsx`) is kept as the presentational conversation component; only its container chrome changes (it's no longer inside a `Popover`). Reply/resolve/reopen/delete call the context mutations.

### 3.4 `page-renderer.tsx` _(slimmed)_

- **Remove**: the floating `IconButton` (top/right:8), the inline `<CommentsPanel>` render and the surrounding flex wrapper that reserved space for it, the new-thread `<Popover>`, the open-thread `<Popover>`/`ThreadCard`, `commentToggleRef`, the `COMMENTS_PANEL_VISIBILITY_EVENT` dispatch `useEffect`, and the local `usePageComments`/`openThreadId`/`panelOpen`/`newThread` state.
- **Keep**: the editor and all non-comment features (reminders, block-move, outline).
- **Read from context** (`usePageCommentsContext()`): `anchors` → `commentThreads`, `canComment`, `onCreateComment={startNewThread}`, `onOpenThread={openThread}`. The editor's own `mentionSearch` prop is still built **locally in `PageRenderer`** (the same cheap `useCallback` on `workspaceId` + tRPC) and passed to `AnyNoteEditor` — unchanged.
- For **TEXT** pages `PageRenderer` now returns just the editor + reminder/move/outline UI (no comment chrome). It **no longer renders** `CommentMentionSearchProvider` itself (the provider does that, one level up).

---

## 4. Layout & mount changes

### 4.1 In-app — `workspace-layout-client.tsx` + `workspace-shell.tsx`

- **Delete** the `COMMENTS_PANEL_VISIBILITY_EVENT` listener, the `commentsPanelOpen` state, and `effectiveMode` (the left-sidebar-hiding). The shell uses `mode` directly again; the left sidebar stays open while comments are open.
- **Look up the active page type**: `PageItem` has no `type`, so the layout reads `trpc.page.getById.useQuery({ id: activePageId })` (already cached by `PageActionsToolbar`/`PageHeader`) to get `pageType`.
- **Restructure `mainContent`**: keep `WorkspaceToolbar` full-width on top; below it a **flex row** = `[<main> scroll area (flex:1)] [<CommentsSidebar/> when panelOpen]`.
- **Wrap on a page**: when `activePageId`, nest `PageEditorProvider` inside `PageCommentsProvider` (`target={{ pageId: activePageId }}`, `pageType`, `canComment` = true, `canDeleteComments` = true, `workspaceId`). `CommentsSidebar` and the toolbar's toggle both live under it.
- `WorkspaceShell` stays a 2-column grid (left sidebar + main). The comments sidebar is part of `main`, **not** a shell column — this keeps the toolbar spanning the full width above both the page and the sidebar (matches the approved mock A).

`PageActionsToolbar` adds `<CommentToggleButton/>` between `<ShareButton/>` and `<FavoriteStar/>`.

### 4.2 Share — `s/[shareId]/page.tsx` + `share-page-client.tsx`

- The server page wraps its existing `Box`(column) — header `Stack` + content — in `<PageCommentsProvider target={{ shareId }} pageType={page.type} canComment={role !== 'READER'} canDeleteComments={false} workspaceId={page.workspaceId}>` (a client component receiving server children).
- `<CommentToggleButton/>` is placed in the header `Stack` (near the «Общий доступ» badge / «Войти» button).
- The content area becomes a **flex row**: `[<SharePageClient/> (flex:1)] [<CommentsSidebar/> when panelOpen]`.
- `SharePageClient` no longer needs to own comment props beyond what it already passes to `PageRenderer`; `PageRenderer` reads comment wiring from context. `commentTarget`/`canComment` props on `PageRenderer` become redundant once it reads context, but are kept harmless or removed in the same change (see §7).

---

## 5. Interaction flows

- **Create**: select text → FloatingToolbar «Комментировать» → editor `onCreateComment(anchor)` → `startNewThread(anchor)` → sidebar opens with the composer for that quoted range → submit → `createThread`.
- **Open from text**: click an in-text comment decoration → editor `onOpenThread(id)` → `openThread(id)` → sidebar opens (if closed), the thread card highlights + `scrollIntoView`.
- **Open from toolbar**: 💬 → `togglePanel` → sidebar opens showing the active-tab list.
- **Reply / Resolve / Reopen / Delete**: handled inside the sidebar card via context mutations (same calls as today).
- **Realtime / anonymous / permissions**: unchanged — `usePageComments` still drives the SSE subscription (members) and refetch-on-focus (public), and `canComment`/`canDeleteComments` gate the UI exactly as before.

---

## 6. Context value shape

```ts
type PageCommentsContextValue = {
  enabled: boolean
  threads: UiThread[]
  anchors: CommentThreadAnchor[] // { id, anchorStart, anchorEnd, resolvedAt }
  activeCount: number
  canComment: boolean
  canDeleteComments: boolean

  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void

  openThreadId: string | null
  openThread: (id: string) => void // sets openThreadId + opens panel
  clearOpenThread: () => void

  newAnchor: { anchorStart: string; anchorEnd: string; quotedText: string } | null
  startNewThread: (a: NonNullable<PageCommentsContextValue['newAnchor']>) => void // + opens panel
  cancelNewThread: () => void

  createThread: (content: CommentContent) => void // uses newAnchor + base internally
  addComment: (threadId: string, content: CommentContent) => void
  resolveThread: (threadId: string) => void
  reopenThread: (threadId: string) => void
  deleteComment: (commentId: string) => void
}
```

`usePageCommentsContext()` throws if used outside the provider (standard pattern).

---

## 7. What's removed / migrated

- `comments-panel.tsx` → replaced by `comments-sidebar.tsx` (expanded-inline). Delete the old file or rewrite in place.
- `PageRenderer`: comment state, floating button, both popovers, the visibility `CustomEvent`, and `CommentMentionSearchProvider` wrapping → moved to provider/sidebar/toggle.
- `workspace-layout-client.tsx`: `COMMENTS_PANEL_VISIBILITY_EVENT`, `commentsPanelOpen`, `effectiveMode` → deleted; add `getById` type lookup + provider mount + content-row restructure.
- `PageRenderer` props `commentTarget` / `canComment`: now redundant (the provider holds the target + permission). Removed from `PageRenderer`; `share-page-client.tsx` stops passing them. The share `page.tsx` supplies them to the provider instead.

---

## 8. Testing

- **`thread-popover.test.tsx`** (exists): keep/adjust — `ThreadCard` still renders conversation/reply/resolve; assert it works outside a popover.
- **`comments-sidebar.test.tsx`** (new): tabs filter active/resolved; new-comment composer appears when `newAnchor` set and calls `createThread` on submit; clicking a card calls `openThread`; reply/resolve call context mutations; empty state renders.
- **`comment-composer.test.tsx`** (exists): unchanged (still rendered, now inside the sidebar).
- **E2E `apps/e2e/page-comments.spec.ts`** (exists): update selectors — the toggle is now a toolbar button (left of the favorite star); assert (a) the toggle opens the **right sidebar** without hiding the **left** sidebar, (b) creating a comment via selection shows the composer in the sidebar and persists, (c) clicking an anchor highlights the thread in the sidebar.
- Verify the in-app flow with `pnpm dev` + the share flow (`/s/[shareId]`) for a TEXT page; confirm non-TEXT pages show **no** toggle/sidebar.

---

## 9. Implementation sequence

1. `comments-context.tsx` — provider + `usePageCommentsContext` (move the data mapping + UI state out of `PageRenderer`).
2. `comment-toggle-button.tsx` — extract the toggle.
3. `comments-sidebar.tsx` — rewrite the panel as expanded-inline, with the new-comment composer + `openThreadId` highlight/scroll; reuse `ThreadCard`.
4. `page-renderer.tsx` — slim down to read context; remove floating button, popovers, inline panel, event dispatch.
5. `workspace-layout-client.tsx` / `workspace-shell.tsx` — remove the visibility event + left-sidebar-hiding; add `getById` type lookup, provider mount, content-row restructure; add the toggle to `PageActionsToolbar`.
6. `s/[shareId]/page.tsx` / `share-page-client.tsx` — provider mount, toggle in header, sidebar in content row.
7. Tests (§8) + `pnpm gates`.
