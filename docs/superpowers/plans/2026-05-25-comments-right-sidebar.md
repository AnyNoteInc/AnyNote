# Move Page Comments Into a Right Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the inline-comments UI so the 💬 toggle lives in the top toolbar (left of the favorite star, and in the share header) and the threads live in a pushed right sidebar that expands conversations inline — removing the floating button and in-content panel, and no longer hiding the left sidebar.

**Architecture:** Lift all comment state/data into a `PageCommentsProvider` React context mounted at the lowest common ancestor of the toolbar, the editor, and the sidebar (the workspace `mainContent` in-app; the share page body for share links). A `CommentToggleButton` and `CommentsSidebar` read that context; `PageRenderer` is slimmed to consume it. **No data-layer changes** — `usePageComments`, the tRPC comment router, anchors-as-decorations, anonymous identity, and SSE subscriptions are untouched.

**Tech Stack:** Next.js 16 App Router, React 19, MUI v6 (via `@repo/ui/components`), tRPC v11, Tiptap (`@repo/editor`), Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-05-25-comments-right-sidebar-design.md`

---

## File Structure

**New files** (all under `apps/web/src/components/page/comments/`):

- `use-mention-search.ts` — `useWorkspaceMentionSearch(workspaceId)` hook (extracted verbatim from `PageRenderer`); shared by the editor mention prop and the provider's `CommentMentionSearchProvider`.
- `comments-context.tsx` — `deriveCommentViews` (pure mapping), `PageCommentsContext` + `usePageCommentsContext` + `PageCommentsProvider`, plus the `RawThread`/`PageCommentsContextValue`/`CommentAnchor`/`CommentContent` types.
- `comment-toggle-button.tsx` — the 💬 `IconButton` + count `Badge`, context-connected.
- `comments-sidebar.tsx` — the right column (tabs, new-comment composer, inline thread cards), context-connected. Replaces `comments-panel.tsx`.
- `thread-card.tsx` — renamed from `thread-popover.tsx`; the conversation/reply/resolve card, now flat (no popover), with an `active` highlight + `data-thread-card-id`.

**Modified files:**

- `apps/web/src/components/page/page-renderer.tsx` — slimmed: consume context; drop floating button, popovers, inline panel, visibility event; props `commentTarget`/`canComment` → `renderAuth`.
- `apps/web/src/components/page/page-actions-toolbar.tsx` — add `<CommentToggleButton/>` between Share and FavoriteStar.
- `apps/web/src/components/workspace/workspace-layout-client.tsx` — remove the visibility event + left-sidebar-hiding; add page-type lookup, provider mount, content-row + sidebar.
- `apps/web/src/app/(share)/s/[shareId]/page.tsx` — mount provider, toggle in header, sidebar in content row.
- `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx` — pass `renderAuth` instead of `commentTarget`/`canComment`.

**Deleted:** `apps/web/src/components/page/comments/comments-panel.tsx`.

**Tests:** `apps/web/test/comments-context.test.tsx` (new), `apps/web/test/comment-toggle-button.test.tsx` (new), `apps/web/test/comments-sidebar.test.tsx` (new), `apps/web/test/thread-popover.test.tsx` → `thread-card.test.tsx` (renamed), `apps/e2e/page-comments.spec.ts` (updated).

**Unchanged:** `workspace-shell.tsx` (still a 2-column grid; the comments sidebar lives inside `main`), `use-page-comments.ts`, the comment router, the editor.

---

## Task 1: Extract `useWorkspaceMentionSearch` hook

**Files:**

- Create: `apps/web/src/components/page/comments/use-mention-search.ts`
- Modify: `apps/web/src/components/page/page-renderer.tsx`

This is a behavior-preserving extraction so both `PageRenderer` (editor mention prop) and the provider (comment composer) share one implementation. Its inferred return type already satisfies both consumers today.

- [ ] **Step 1: Create the hook**

Create `apps/web/src/components/page/comments/use-mention-search.ts`:

```ts
'use client'

import { useCallback } from 'react'

import { filterMentionItems } from '@repo/editor'

import { trpc } from '@/trpc/client'

/** Workspace member @mention search, shared by the editor and the comment composer. */
export function useWorkspaceMentionSearch(workspaceId: string) {
  const trpcUtils = trpc.useUtils()
  return useCallback(
    async (query: string) => {
      try {
        const members = await trpcUtils.workspace.listMembers.ensureData({ workspaceId })
        return filterMentionItems(
          members.map((member) => {
            const name =
              [member.user.firstName, member.user.lastName].filter(Boolean).join(' ').trim() ||
              member.user.email
            return { id: member.user.id, name, email: member.user.email }
          }),
          query,
        )
      } catch {
        return []
      }
    },
    [trpcUtils, workspaceId],
  )
}
```

- [ ] **Step 2: Use the hook in `PageRenderer`**

In `apps/web/src/components/page/page-renderer.tsx`, remove `filterMentionItems` from the `@repo/editor` import block (lines 8–16) and add the hook import near the other local imports (after line 47):

```ts
import { useWorkspaceMentionSearch } from './comments/use-mention-search'
```

Delete the inline `mentionSearch` `useCallback` (currently lines 280–302) and replace it with:

```ts
const mentionSearch = useWorkspaceMentionSearch(workspaceId)
```

- [ ] **Step 3: Verify types and existing tests pass**

Run: `pnpm --filter web check-types`
Expected: no errors.

Run: `pnpm --filter web test`
Expected: PASS (all existing suites, including `comment-composer.test.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/comments/use-mention-search.ts apps/web/src/components/page/page-renderer.tsx
git commit -m "refactor(comments): extract useWorkspaceMentionSearch hook"
```

---

## Task 2: `deriveCommentViews` + context types

**Files:**

- Create: `apps/web/src/components/page/comments/comments-context.tsx`
- Test: `apps/web/test/comments-context.test.tsx`

Creates the comments-context module with the pure mapping helper (moved out of `PageRenderer`), the context object, the consumer hook, and the shared types. The `PageCommentsProvider` component is added in Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/comments-context.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'

import { deriveCommentViews, type RawThread } from '@/components/page/comments/comments-context'

const rawThreads: RawThread[] = [
  {
    id: 't1',
    anchorStart: 'A',
    anchorEnd: 'B',
    quotedText: 'Q1',
    resolvedAt: null,
    comments: [
      {
        id: 'c1',
        authorId: 'u1',
        authorName: 'Анна',
        content: { text: 'привет' },
        createdAt: '2026-05-25T10:00:00Z',
      },
    ],
  },
  {
    id: 't2',
    anchorStart: 'C',
    anchorEnd: 'D',
    quotedText: 'Q2',
    resolvedAt: '2026-05-25T11:00:00Z',
    comments: [],
  },
]

describe('deriveCommentViews', () => {
  it('derives anchors, ui threads, and the active count', () => {
    const { anchors, uiThreads, activeCount } = deriveCommentViews(rawThreads)
    expect(anchors).toEqual([
      { id: 't1', anchorStart: 'A', anchorEnd: 'B', resolvedAt: null },
      { id: 't2', anchorStart: 'C', anchorEnd: 'D', resolvedAt: '2026-05-25T11:00:00Z' },
    ])
    expect(uiThreads[0]).toMatchObject({ id: 't1', quotedText: 'Q1' })
    expect(uiThreads[0]?.comments[0]).toMatchObject({
      id: 'c1',
      authorName: 'Анна',
      content: { text: 'привет' },
    })
    expect(activeCount).toBe(1)
  })

  it('defaults missing comment content to empty text', () => {
    const { uiThreads } = deriveCommentViews([
      {
        id: 't',
        anchorStart: 'A',
        anchorEnd: 'B',
        quotedText: 'q',
        resolvedAt: null,
        comments: [
          {
            id: 'c',
            authorId: null,
            authorName: 'X',
            content: null,
            createdAt: '2026-05-25T10:00:00Z',
          },
        ],
      },
    ])
    expect(uiThreads[0]?.comments[0]?.content).toEqual({ text: '' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test comments-context`
Expected: FAIL — cannot resolve `@/components/page/comments/comments-context`.

- [ ] **Step 3: Create the context module (helper + types + context + hook)**

Create `apps/web/src/components/page/comments/comments-context.tsx`:

```tsx
'use client'

import { createContext, useContext } from 'react'

import type { UiThread } from './types'

export type CommentContent = { text: string; mentions: string[] }

export type RawComment = {
  id: string
  authorId: string | null
  authorName: string
  content: unknown
  createdAt: string | Date
}

export type RawThread = {
  id: string
  anchorStart: string
  anchorEnd: string
  quotedText: string
  resolvedAt: string | Date | null
  comments: RawComment[]
}

export type CommentAnchor = {
  id: string
  anchorStart: string
  anchorEnd: string
  resolvedAt: string | Date | null
}

/** Pure mapping from the tRPC thread list to the editor anchors + sidebar view + active count. */
export function deriveCommentViews(rawThreads: RawThread[]): {
  uiThreads: UiThread[]
  anchors: CommentAnchor[]
  activeCount: number
} {
  const anchors: CommentAnchor[] = rawThreads.map((t) => ({
    id: t.id,
    anchorStart: t.anchorStart,
    anchorEnd: t.anchorEnd,
    resolvedAt: t.resolvedAt,
  }))
  const uiThreads: UiThread[] = rawThreads.map((t) => ({
    id: t.id,
    quotedText: t.quotedText,
    resolvedAt: t.resolvedAt,
    comments: t.comments.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      authorName: c.authorName,
      content: (c.content ?? { text: '' }) as { text: string },
      createdAt: c.createdAt,
    })),
  }))
  const activeCount = rawThreads.filter((t) => !t.resolvedAt).length
  return { uiThreads, anchors, activeCount }
}

export type PageCommentsContextValue = {
  enabled: boolean
  threads: UiThread[]
  anchors: CommentAnchor[]
  activeCount: number
  canComment: boolean
  canDeleteComments: boolean

  panelOpen: boolean
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void

  openThreadId: string | null
  openThread: (id: string) => void
  clearOpenThread: () => void

  newAnchor: { anchorStart: string; anchorEnd: string; quotedText: string } | null
  startNewThread: (anchor: { anchorStart: string; anchorEnd: string; quotedText: string }) => void
  cancelNewThread: () => void

  createThread: (content: CommentContent) => void
  addComment: (threadId: string, content: CommentContent) => void
  resolveThread: (threadId: string) => void
  reopenThread: (threadId: string) => void
  deleteComment: (commentId: string) => void
}

export const PageCommentsContext = createContext<PageCommentsContextValue | null>(null)

export function usePageCommentsContext(): PageCommentsContextValue {
  const ctx = useContext(PageCommentsContext)
  if (!ctx) throw new Error('usePageCommentsContext must be used within PageCommentsProvider')
  return ctx
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test comments-context`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/comments/comments-context.tsx apps/web/test/comments-context.test.tsx
git commit -m "feat(comments): add comments context module with deriveCommentViews"
```

---

## Task 3: `PageCommentsProvider`

**Files:**

- Modify: `apps/web/src/components/page/comments/comments-context.tsx`

Adds the provider that owns `usePageComments`, the UI state, and the mention-search provider. No new unit test — its data mapping is covered by Task 2 and its wiring by the component tests (Tasks 4, 6) and the E2E (Task 8).

- [ ] **Step 1: Add provider imports**

At the top of `comments-context.tsx`, extend the React import and add the dependencies:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { PageType } from '@repo/db'

import { CommentMentionSearchProvider } from './comment-composer'
import { useWorkspaceMentionSearch } from './use-mention-search'
import { usePageComments, type CommentTarget } from './use-page-comments'
```

- [ ] **Step 2: Append the provider component**

Add to the end of `comments-context.tsx`:

```tsx
export function PageCommentsProvider({
  target,
  pageType,
  canComment,
  canDeleteComments,
  workspaceId,
  children,
}: {
  target: CommentTarget
  pageType: PageType | undefined
  canComment: boolean
  canDeleteComments: boolean
  workspaceId: string
  children: ReactNode
}) {
  const enabled = pageType === 'TEXT'
  const comments = usePageComments(target, { enabled })
  const mentionSearch = useWorkspaceMentionSearch(workspaceId)
  const { uiThreads, anchors, activeCount } = deriveCommentViews(
    comments.threads as unknown as RawThread[],
  )
  const base = comments.base

  const [panelOpen, setPanelOpen] = useState(false)
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [newAnchor, setNewAnchor] = useState<PageCommentsContextValue['newAnchor']>(null)

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])
  const openThread = useCallback((id: string) => {
    setOpenThreadId(id)
    setPanelOpen(true)
  }, [])
  const clearOpenThread = useCallback(() => setOpenThreadId(null), [])
  const startNewThread = useCallback(
    (anchor: NonNullable<PageCommentsContextValue['newAnchor']>) => {
      setNewAnchor(anchor)
      setPanelOpen(true)
    },
    [],
  )
  const cancelNewThread = useCallback(() => setNewAnchor(null), [])

  const createThread = useCallback(
    (content: CommentContent) => {
      if (!newAnchor) return
      comments.createThread({ ...base, ...newAnchor, content })
      setNewAnchor(null)
    },
    [comments, base, newAnchor],
  )
  const addComment = useCallback(
    (threadId: string, content: CommentContent) =>
      comments.addComment({ ...base, threadId, content }),
    [comments, base],
  )
  const resolveThread = useCallback(
    (threadId: string) => comments.resolveThread({ ...base, threadId }),
    [comments, base],
  )
  const reopenThread = useCallback(
    (threadId: string) => comments.reopenThread({ ...base, threadId }),
    [comments, base],
  )
  const deleteComment = useCallback(
    (commentId: string) => comments.deleteComment({ ...base, commentId }),
    [comments, base],
  )

  const value = useMemo<PageCommentsContextValue>(
    () => ({
      enabled,
      threads: uiThreads,
      anchors,
      activeCount,
      canComment,
      canDeleteComments,
      panelOpen,
      setPanelOpen,
      togglePanel,
      openThreadId,
      openThread,
      clearOpenThread,
      newAnchor,
      startNewThread,
      cancelNewThread,
      createThread,
      addComment,
      resolveThread,
      reopenThread,
      deleteComment,
    }),
    [
      enabled,
      uiThreads,
      anchors,
      activeCount,
      canComment,
      canDeleteComments,
      panelOpen,
      togglePanel,
      openThreadId,
      openThread,
      clearOpenThread,
      newAnchor,
      startNewThread,
      cancelNewThread,
      createThread,
      addComment,
      resolveThread,
      reopenThread,
      deleteComment,
    ],
  )

  return (
    <PageCommentsContext.Provider value={value}>
      <CommentMentionSearchProvider value={mentionSearch}>{children}</CommentMentionSearchProvider>
    </PageCommentsContext.Provider>
  )
}
```

- [ ] **Step 3: Verify types**

Run: `pnpm --filter web check-types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/comments/comments-context.tsx
git commit -m "feat(comments): add PageCommentsProvider"
```

---

## Task 4: `CommentToggleButton`

**Files:**

- Create: `apps/web/src/components/page/comments/comment-toggle-button.tsx`
- Test: `apps/web/test/comment-toggle-button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/comment-toggle-button.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
import {
  PageCommentsContext,
  type PageCommentsContextValue,
} from '@/components/page/comments/comments-context'

function ctx(overrides: Partial<PageCommentsContextValue>): PageCommentsContextValue {
  return {
    enabled: true,
    threads: [],
    anchors: [],
    activeCount: 0,
    canComment: true,
    canDeleteComments: true,
    panelOpen: false,
    setPanelOpen: vi.fn(),
    togglePanel: vi.fn(),
    openThreadId: null,
    openThread: vi.fn(),
    clearOpenThread: vi.fn(),
    newAnchor: null,
    startNewThread: vi.fn(),
    cancelNewThread: vi.fn(),
    createThread: vi.fn(),
    addComment: vi.fn(),
    resolveThread: vi.fn(),
    reopenThread: vi.fn(),
    deleteComment: vi.fn(),
    ...overrides,
  }
}

const renderWith = (value: PageCommentsContextValue) =>
  render(
    <PageCommentsContext.Provider value={value}>
      <CommentToggleButton />
    </PageCommentsContext.Provider>,
  )

describe('CommentToggleButton', () => {
  afterEach(cleanup)

  it('renders nothing when comments are disabled', () => {
    const { container } = renderWith(ctx({ enabled: false }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the active count and toggles the panel', async () => {
    const actor = userEvent.setup()
    const togglePanel = vi.fn()
    renderWith(ctx({ enabled: true, activeCount: 3, togglePanel }))

    expect(screen.getByText('3')).toBeInTheDocument()
    await actor.click(screen.getByRole('button', { name: 'Комментарии' }))
    expect(togglePanel).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test comment-toggle-button`
Expected: FAIL — cannot resolve `comment-toggle-button`.

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/page/comments/comment-toggle-button.tsx`:

```tsx
'use client'

import { Badge, CommentIcon, IconButton, Tooltip } from '@repo/ui/components'

import { usePageCommentsContext } from './comments-context'

export function CommentToggleButton() {
  const { enabled, activeCount, togglePanel } = usePageCommentsContext()
  if (!enabled) return null
  return (
    <Tooltip title="Комментарии">
      <IconButton
        size="small"
        onClick={togglePanel}
        aria-label="Комментарии"
        sx={{ color: 'text.secondary' }}
      >
        <Badge badgeContent={activeCount} color="primary">
          <CommentIcon sx={{ fontSize: 20 }} />
        </Badge>
      </IconButton>
    </Tooltip>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test comment-toggle-button`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/comments/comment-toggle-button.tsx apps/web/test/comment-toggle-button.test.tsx
git commit -m "feat(comments): add CommentToggleButton"
```

---

## Task 5: Rename `thread-popover.tsx` → `thread-card.tsx` and flatten it

**Files:**

- Rename: `apps/web/src/components/page/comments/thread-popover.tsx` → `thread-card.tsx`
- Rename: `apps/web/test/thread-popover.test.tsx` → `thread-card.test.tsx`
- Modify: both renamed files

The card is no longer inside a popover. It must fill the sidebar width, support an `active` highlight, and carry `data-thread-card-id` for scroll targeting.

- [ ] **Step 1: Rename the source and test with git**

```bash
git mv apps/web/src/components/page/comments/thread-popover.tsx apps/web/src/components/page/comments/thread-card.tsx
git mv apps/web/test/thread-popover.test.tsx apps/web/test/thread-card.test.tsx
```

- [ ] **Step 2: Update the test import + add an `active` assertion**

In `apps/web/test/thread-card.test.tsx`, change the import path:

```tsx
import { ThreadCard } from '@/components/page/comments/thread-card'
```

Append this test inside the `describe('ThreadCard', ...)` block:

```tsx
it('marks the active card with a thread id attribute', () => {
  render(
    <ThreadCard
      thread={thread}
      active
      canDeleteComments
      onReply={vi.fn()}
      onResolve={vi.fn()}
      onReopen={vi.fn()}
      onDeleteComment={vi.fn()}
    />,
  )

  expect(document.querySelector('[data-thread-card-id="thread-1"]')).not.toBeNull()
})
```

- [ ] **Step 3: Run the test to verify the new assertion fails**

Run: `pnpm --filter web test thread-card`
Expected: FAIL — the new test fails (no `data-thread-card-id`); the original two pass.

- [ ] **Step 4: Update `ThreadCard`**

In `apps/web/src/components/page/comments/thread-card.tsx`, change the props type and the `Paper`:

```tsx
type Props = {
  thread: UiThread
  active?: boolean
  onReply: (c: { text: string; mentions: string[] }) => void
  onResolve: () => void
  onReopen: () => void
  onDeleteComment: (commentId: string) => void
  canDeleteComments?: boolean
}

export function ThreadCard({
  thread,
  active = false,
  onReply,
  onResolve,
  onReopen,
  onDeleteComment,
  canDeleteComments = true,
}: Props) {
  return (
    <Paper
      variant="outlined"
      data-thread-card-id={thread.id}
      sx={{
        p: 1.5,
        width: '100%',
        borderColor: active ? 'primary.main' : 'divider',
        boxShadow: active ? 2 : 0,
      }}
    >
```

Leave the rest of the component body (quoted text, comments, composer, resolve/reopen buttons) unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter web test thread-card`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/page/comments/thread-card.tsx apps/web/test/thread-card.test.tsx
git commit -m "refactor(comments): rename ThreadCard file and flatten for sidebar use"
```

---

## Task 6: `CommentsSidebar`

**Files:**

- Create: `apps/web/src/components/page/comments/comments-sidebar.tsx`
- Test: `apps/web/test/comments-sidebar.test.tsx`

The right column: tabs, the new-comment composer (when `newAnchor` is set), and one inline `ThreadCard` per thread. Self-gates to `null` when disabled or closed.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/comments-sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
import {
  PageCommentsContext,
  type PageCommentsContextValue,
} from '@/components/page/comments/comments-context'
import type { UiThread } from '@/components/page/comments/types'

const threads: UiThread[] = [
  {
    id: 't1',
    quotedText: 'Активный фрагмент',
    resolvedAt: null,
    comments: [
      {
        id: 'c1',
        authorId: 'u1',
        authorName: 'Анна',
        content: { text: 'Вопрос' },
        createdAt: new Date(),
      },
    ],
  },
  {
    id: 't2',
    quotedText: 'Решённый фрагмент',
    resolvedAt: new Date(),
    comments: [
      {
        id: 'c2',
        authorId: 'u2',
        authorName: 'Олег',
        content: { text: 'Готово' },
        createdAt: new Date(),
      },
    ],
  },
]

function ctx(overrides: Partial<PageCommentsContextValue>): PageCommentsContextValue {
  return {
    enabled: true,
    threads: [],
    anchors: [],
    activeCount: 0,
    canComment: true,
    canDeleteComments: true,
    panelOpen: true,
    setPanelOpen: vi.fn(),
    togglePanel: vi.fn(),
    openThreadId: null,
    openThread: vi.fn(),
    clearOpenThread: vi.fn(),
    newAnchor: null,
    startNewThread: vi.fn(),
    cancelNewThread: vi.fn(),
    createThread: vi.fn(),
    addComment: vi.fn(),
    resolveThread: vi.fn(),
    reopenThread: vi.fn(),
    deleteComment: vi.fn(),
    ...overrides,
  }
}

const renderWith = (value: PageCommentsContextValue) =>
  render(
    <PageCommentsContext.Provider value={value}>
      <CommentsSidebar />
    </PageCommentsContext.Provider>,
  )

describe('CommentsSidebar', () => {
  afterEach(cleanup)

  it('renders nothing when the panel is closed', () => {
    const { container } = renderWith(ctx({ panelOpen: false, threads }))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows active threads by default and switches to resolved', async () => {
    const actor = userEvent.setup()
    renderWith(ctx({ threads }))

    expect(screen.getByText('«Активный фрагмент»')).toBeInTheDocument()
    expect(screen.queryByText('«Решённый фрагмент»')).not.toBeInTheDocument()

    await actor.click(screen.getByRole('button', { name: 'Решённые' }))
    expect(screen.getByText('«Решённый фрагмент»')).toBeInTheDocument()
  })

  it('creates a thread from the new-comment composer', async () => {
    const actor = userEvent.setup()
    const createThread = vi.fn()
    renderWith(
      ctx({
        threads: [],
        newAnchor: { anchorStart: 'a', anchorEnd: 'b', quotedText: 'Новый' },
        createThread,
      }),
    )

    await actor.type(screen.getByPlaceholder('Комментарий…'), 'Первый коммент')
    await actor.click(screen.getByRole('button', { name: 'Отправить комментарий' }))
    expect(createThread).toHaveBeenCalledWith({ text: 'Первый коммент', mentions: [] })
  })

  it('replies through the active thread card', async () => {
    const actor = userEvent.setup()
    const addComment = vi.fn()
    renderWith(ctx({ threads: [threads[0]!], addComment }))

    await actor.type(screen.getByPlaceholder('Комментарий…'), 'Ответ')
    await actor.keyboard('{Control>}{Enter}{/Control}')
    expect(addComment).toHaveBeenCalledWith('t1', { text: 'Ответ', mentions: [] })
  })

  it('shows the empty state when there are no active threads', () => {
    renderWith(ctx({ threads: [] }))
    expect(screen.getByText('Нет комментариев')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test comments-sidebar`
Expected: FAIL — cannot resolve `comments-sidebar`.

- [ ] **Step 3: Create the component**

Create `apps/web/src/components/page/comments/comments-sidebar.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

import { Box, Button, CloseIcon, IconButton, Stack, Typography } from '@repo/ui/components'

import { CommentComposer } from './comment-composer'
import { usePageCommentsContext } from './comments-context'
import { ThreadCard } from './thread-card'

export function CommentsSidebar() {
  const {
    enabled,
    panelOpen,
    setPanelOpen,
    threads,
    newAnchor,
    openThreadId,
    canDeleteComments,
    createThread,
    cancelNewThread,
    addComment,
    resolveThread,
    reopenThread,
    deleteComment,
  } = usePageCommentsContext()
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Opening a thread (anchor click) switches to its tab and scrolls it into view.
  useEffect(() => {
    if (!openThreadId) return
    const t = threads.find((x) => x.id === openThreadId)
    if (t) setTab(t.resolvedAt ? 'resolved' : 'active')
    const el = scrollRef.current?.querySelector(`[data-thread-card-id="${openThreadId}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [openThreadId, threads])

  if (!enabled || !panelOpen) return null

  const shown = threads.filter((t) => (tab === 'active' ? !t.resolvedAt : !!t.resolvedAt))

  return (
    <Box
      ref={scrollRef}
      className="comments-sidebar"
      sx={{
        width: 320,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: 'divider',
        height: '100%',
        overflow: 'auto',
        p: 1.5,
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Комментарии</Typography>
        <IconButton
          size="small"
          onClick={() => setPanelOpen(false)}
          aria-label="Закрыть комментарии"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Button
          size="small"
          variant={tab === 'active' ? 'contained' : 'text'}
          onClick={() => setTab('active')}
        >
          Активные
        </Button>
        <Button
          size="small"
          variant={tab === 'resolved' ? 'contained' : 'text'}
          onClick={() => setTab('resolved')}
        >
          Решённые
        </Button>
      </Stack>

      {newAnchor ? (
        <Box sx={{ mb: 1.5, p: 1, border: 1, borderColor: 'primary.main', borderRadius: 1 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: 'block', mb: 0.5 }}
          >
            «{newAnchor.quotedText}»
          </Typography>
          <CommentComposer autoFocus onSubmit={(c) => createThread(c)} />
          <Box sx={{ textAlign: 'right', mt: 0.5 }}>
            <Button size="small" onClick={cancelNewThread}>
              Отмена
            </Button>
          </Box>
        </Box>
      ) : null}

      <Stack spacing={1}>
        {shown.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            active={t.id === openThreadId}
            canDeleteComments={canDeleteComments}
            onReply={(c) => addComment(t.id, c)}
            onResolve={() => resolveThread(t.id)}
            onReopen={() => reopenThread(t.id)}
            onDeleteComment={(commentId) => deleteComment(commentId)}
          />
        ))}
        {shown.length === 0 && !newAnchor && (
          <Typography variant="body2" color="text.secondary">
            Нет комментариев
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test comments-sidebar`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/comments/comments-sidebar.tsx apps/web/test/comments-sidebar.test.tsx
git commit -m "feat(comments): add CommentsSidebar with inline threads"
```

---

## Task 7: Switchover — slim `PageRenderer`, wire in-app + share

**Files:**

- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Modify: `apps/web/src/app/(share)/s/[shareId]/page.tsx`
- Modify: `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx`

This is the atomic cut from the old UI to the new one. After Step 1 the app does not run until Steps 2–3 mount the providers; it is fully working again after Step 3.

- [ ] **Step 1: Slim `PageRenderer` to consume context**

In `apps/web/src/components/page/page-renderer.tsx`:

1. Remove these imports: `Badge`, `CommentIcon`, `IconButton`, `Popover`, `Tooltip` (from `@repo/ui/components` — keep `Box`, `CircularProgress`); the `CommentsPanel` import; the `ThreadCard` import; the `usePageComments, type CommentTarget` import; the `CommentComposer, CommentMentionSearchProvider` import; the `UiThread` import. Add:

```ts
import { usePageCommentsContext } from './comments/comments-context'
```

2. Delete the `COMMENTS_PANEL_VISIBILITY_EVENT` constant (currently line 50).

3. Change the `Props` type and signature:

```tsx
type Props = {
  page: PageInput
  workspaceId: string
  user: { id: string; name: string; color: string }
  yjsToken?: () => Promise<string>
  editable?: boolean
  renderAuth?: { shareId: string }
}

export function PageRenderer({
  page,
  workspaceId,
  user,
  yjsToken,
  editable = true,
  renderAuth,
}: Props) {
```

4. Near the other hook calls (e.g. just after `const pageEditor = usePageEditor()`), add:

```tsx
const { anchors, canComment, startNewThread, openThread } = usePageCommentsContext()
```

5. Delete the entire "Inline comments (TEXT pages)" block (currently lines 416–488: `commentTgt`, `renderAuth`, `comments`, `openThreadId`, `panelOpen`, `newThread`, `commentToggleRef`, the `RawComment`/`RawThread` types, `rawThreads`, `commentThreads`, `uiThreads`, `openThread`, `activeCount`, `canDeleteComments`, the `COMMENTS_PANEL_VISIBILITY_EVENT` dispatch `useEffect`, and `handleCreateComment`).

6. Replace the entire `if (page.type === 'TEXT') { ... }` branch (currently lines 561–705) with:

```tsx
if (page.type === 'TEXT') {
  return (
    <Box sx={{ height: '100%', minHeight: 0, position: 'relative' }}>
      <AnyNoteEditor
        pageId={page.id}
        workspaceId={workspaceId}
        initialContentYjs={page.contentYjs}
        yjsUrl={resolveYjsUrl()}
        yjsToken={token}
        editable={editable}
        user={user}
        uploadHandler={uploadHandler}
        pageSearch={pageSearch}
        mentionSearch={mentionSearch}
        onNavigateToPage={onNavigateToPage}
        drawioUrl={resolveDrawioUrl()}
        onReady={handleEditorReady}
        onRequestBlockMove={handleRequestBlockMove}
        onReminderCreate={handleReminderCreate}
        onReminderClick={handleReminderClick}
        commentThreads={anchors}
        canComment={canComment}
        plantumlRenderAuth={renderAuth}
        onCreateComment={startNewThread}
        onOpenThread={openThread}
        loadingFallback={<EditorContentSkeleton />}
      />
      {reminderUI.open && (
        <ReminderPopover
          open
          anchorEl={reminderUI.anchorEl}
          mode={reminderUI.mode}
          initial={reminderUI.initial}
          workspaceId={workspaceId}
          onClose={() => setReminderUI({ open: false })}
          onSave={saveReminder}
          onDelete={() => deleteReminder(reminderUI.initial.id)}
        />
      )}
      <EditorOutline editor={editor} mode={outlineMode} />
      <BlockMoveDialog
        open={movePos != null}
        onClose={handleCloseMove}
        onConfirm={handleConfirmMove}
        busy={moveBusy}
        canConfirm={moveTarget != null && moveTarget !== PAGE_TREE_ROOT}
        treePicker={
          <>
            <PageTreePicker
              pages={pagesQuery.data ?? []}
              excludeIds={new Set([page.id])}
              onSelect={setMoveTarget}
              selectedId={moveTarget}
              showRoot={false}
            />
            {moveError ? (
              <Box sx={{ color: 'error.main', mt: 1, fontSize: 13, px: 1 }}>{moveError}</Box>
            ) : null}
          </>
        }
      />
    </Box>
  )
}
```

The `PLANTUML` branch's `renderAuth={renderAuth}` (passed to `PlantumlBoard`) now reads the new `renderAuth` prop — no code change needed there since the variable name is identical.

- [ ] **Step 2: Wire the in-app layout**

In `apps/web/src/components/workspace/workspace-layout-client.tsx`:

1. Add imports:

```ts
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
```

2. Delete the `COMMENTS_PANEL_VISIBILITY_EVENT` constant (line 37), the `commentsPanelOpen` state (line 64), and the visibility-event `useEffect` (lines 80–89).

3. Delete `const effectiveMode: SidebarMode = commentsPanelOpen ? 'hidden' : mode` (line 163). After the `activePageId` line (159), add the page-type lookup:

```tsx
const activePageQ = trpc.page.getById.useQuery(
  { id: activePageId ?? '' },
  { enabled: !!activePageId },
)
const activePageType = activePageQ.data?.type
```

4. Replace `mainContent` (lines 168–193) with the row-based layout:

```tsx
const mainContent = (
  <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <WorkspaceToolbar
      breadcrumbs={breadcrumbs}
      sidebarHidden={mode === 'hidden'}
      onOpenSidebar={() => setMode('full')}
      sidebarContent={<WorkspaceSidebar {...sidebarProps} />}
      rightSlot={
        activeChatId ? (
          <ChatActionsToolbar chatId={activeChatId} workspaceId={workspace.id} />
        ) : activePageId ? (
          <PageActionsToolbar pageId={activePageId} workspaceId={workspace.id} />
        ) : null
      }
    />
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Box
        component="main"
        sx={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}
        data-full-width={fullWidth ? 'true' : 'false'}
        data-outline-mode={activePageId ? outlineMode : undefined}
        className="page-content-scroll"
      >
        {children}
      </Box>
      {activePageId ? <CommentsSidebar /> : null}
    </Box>
  </Box>
)
```

5. Replace the `sidebar` assignment (lines 195–198) and the final `return` (lines 200–209):

```tsx
const sidebar =
  mode === 'full' ? <WorkspaceSidebar {...sidebarProps} onHide={() => setMode('hidden')} /> : null

const pageMain = (
  <PageCommentsProvider
    key={activePageId ?? 'none'}
    target={{ pageId: activePageId ?? '' }}
    pageType={activePageType}
    canComment
    canDeleteComments
    workspaceId={workspace.id}
  >
    <PageEditorProvider>{mainContent}</PageEditorProvider>
  </PageCommentsProvider>
)

return (
  <SearchDialogProvider workspaceId={workspace.id}>
    <WorkspaceHotkeyMount workspaceId={workspace.id} onPages={() => setSidebarSection('pages')} />
    <WorkspaceShell mode={mode} sidebar={sidebar} main={activePageId ? pageMain : mainContent} />
  </SearchDialogProvider>
)
```

6. In `apps/web/src/components/page/page-actions-toolbar.tsx`, add the import and place the toggle between `ShareButton` and `FavoriteStar`:

```tsx
import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
```

```tsx
<Stack direction="row" spacing={0.5} alignItems="center" className="page-actions-toolbar">
  <ShareButton pageId={pageId} />
  <CommentToggleButton />
  <FavoriteStar
    pageId={pageId}
    pageTitle={title}
    workspaceId={workspaceId}
    isFavorite={isFavorite}
  />
  <PageActionsMenu
    pageId={pageId}
    pageTitle={title}
    workspaceId={workspaceId}
    pageType={pageType}
    isFavorite={isFavorite}
    movedPage={movedPage}
    pages={pages}
  />
</Stack>
```

- [ ] **Step 3: Wire the share page**

In `apps/web/src/app/(share)/s/[shareId]/page.tsx`, add imports:

```ts
import { PageCommentsProvider } from '@/components/page/comments/comments-context'
import { CommentToggleButton } from '@/components/page/comments/comment-toggle-button'
import { CommentsSidebar } from '@/components/page/comments/comments-sidebar'
```

Replace the final `return ( ... )` (lines 66–104) with a provider-wrapped, row-based layout:

```tsx
return (
  <PageCommentsProvider
    target={{ shareId }}
    pageType={page.type}
    canComment={role !== 'READER'}
    canDeleteComments={false}
    workspaceId={page.workspaceId}
  >
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {page.icon ? <span>{page.icon}</span> : null}
        <Typography variant="subtitle1" sx={{ flex: 1 }} noWrap>
          {page.title || 'Без названия'}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
          <PublicIcon sx={{ fontSize: 18 }} />
          <Typography variant="caption">Общий доступ</Typography>
        </Stack>
        {!editable && (
          <Typography variant="caption" color="text.secondary">
            Только просмотр
          </Typography>
        )}
        <CommentToggleButton />
        {!session && (
          <Button size="small" href={`/sign-in?redirect=/s/${shareId}`}>
            Войти
          </Button>
        )}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SharePageClient
            shareId={shareId}
            page={{ id: page.id, type: page.type, contentYjs }}
            workspaceId={page.workspaceId}
            user={user}
            editable={editable}
            role={role}
          />
        </Box>
        <CommentsSidebar />
      </Box>
    </Box>
  </PageCommentsProvider>
)
```

Then in `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx`, drop the comment props and pass `renderAuth` instead. Remove the `commentTarget={{ shareId }}` and `canComment={role !== 'READER'}` props from `<PageRenderer>` and add `renderAuth={{ shareId }}`:

```tsx
return (
  <PageRenderer
    page={page}
    workspaceId={workspaceId}
    user={user}
    yjsToken={yjsToken}
    editable={editable}
    renderAuth={{ shareId }}
  />
)
```

(`role` is still used to compute `editable` upstream in `page.tsx`; the `role` prop on `SharePageClient` may now be unused — if `check-types` flags it as unused, remove `role` from `SharePageClient`'s props and the `page.tsx` call.)

- [ ] **Step 4: Verify types and build**

Run: `pnpm --filter web check-types`
Expected: no errors.

Run: `pnpm --filter web build`
Expected: build succeeds (catches RSC/static issues).

- [ ] **Step 5: Manually verify both flows**

Start dev (`docker compose up -d` first if not running): `pnpm --filter web dev`

- In-app: open a TEXT page → the 💬 button sits left of the ⭐ star in the top-right toolbar; clicking it opens a right sidebar **without** hiding the left sidebar; select text → «Комментировать» opens the sidebar with a composer; submitting adds a card; clicking the in-text highlight scrolls/highlights the card. Open a non-TEXT page (e.g. Excalidraw) → **no** 💬 button.
- Share: open `/s/<shareId>` for a TEXT page → 💬 in the header next to «Общий доступ»; the sidebar opens beside the content.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx apps/web/src/components/page/page-actions-toolbar.tsx apps/web/src/components/workspace/workspace-layout-client.tsx "apps/web/src/app/(share)/s/[shareId]/page.tsx" "apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx"
git commit -m "feat(comments): move comments toggle to toolbar and threads to a right sidebar"
```

---

## Task 8: Delete old panel, update E2E, run gates

**Files:**

- Delete: `apps/web/src/components/page/comments/comments-panel.tsx`
- Modify: `apps/e2e/page-comments.spec.ts`

- [ ] **Step 1: Confirm `comments-panel.tsx` has no importers, then delete it**

Run: `grep -rn "comments-panel\|CommentsPanel" apps/web/src apps/web/test`
Expected: no matches (Task 7 removed the only importer).

```bash
git rm apps/web/src/components/page/comments/comments-panel.tsx
```

- [ ] **Step 2: Update the E2E assertions for the new layout**

In `apps/e2e/page-comments.spec.ts`, replace the post-reload block (currently lines 107–112) with:

```ts
await page.reload()
await expect(editor).toBeVisible({ timeout: 15_000 })
await page.getByRole('button', { name: 'Комментарии' }).click()
// The right sidebar opens WITHOUT hiding the left workspace sidebar.
await expect(page.locator('.workspace-sidebar')).toHaveCount(1)
await expect(page.locator('.comments-sidebar')).toBeVisible()
await expect(page.getByText(`«${selectedText}»`)).toBeVisible({ timeout: 10_000 })
await expect(page.getByText('Тест Тест')).toBeVisible()
await expect(page.getByText(commentText)).toBeVisible()
```

(The creation flow on lines 72–77 is unchanged: «Комментировать» now opens the sidebar composer, where the existing `Комментарий…` / `Отправить комментарий` selectors still match.)

- [ ] **Step 3: Run the comment E2E spec**

Run: `pnpm exec playwright test apps/e2e/page-comments.spec.ts`
Expected: PASS (1 test). If it times out on cold compile, re-run with `--retries=1` (dev-only warm-up, per repo convention).

- [ ] **Step 4: Run the full merge gate**

Run: `pnpm gates`
Expected: check-types + lint + build + test all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/page-comments.spec.ts apps/web/src/components/page/comments/comments-panel.tsx
git commit -m "test(e2e): comments live in the right sidebar without hiding the left"
```

---

## Self-Review

**Spec coverage:**

- Remove floating button + in-content panel → Task 7 Step 1 (PageRenderer slim). ✓
- 💬 in toolbar left of ⭐ (in-app) + share header → Task 7 Steps 2–3. ✓
- Right sidebar pushes content; left sidebar stays → Task 7 Steps 2–3 (row layout, `effectiveMode`/event removed). ✓
- Threads expand inline; anchor click highlights/scrolls; popover removed → Tasks 5–6 + Task 7 Step 1 (`onOpenThread={openThread}`). ✓
- New-comment composer in the sidebar → Task 6 (`newAnchor` block) + `onCreateComment={startNewThread}`. ✓
- Consistent across in-app + share → Task 7 Steps 2–3 (same provider/toggle/sidebar). ✓
- Renders only for TEXT pages → `enabled = pageType === 'TEXT'` gates toggle + sidebar (Tasks 3, 4, 6). ✓
- @mentions keep working → Task 1 hook + provider's `CommentMentionSearchProvider` (Task 3). ✓
- No data-layer changes → only `usePageComments` consumed; no router/schema edits. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command shows expected output. ✓

**Type consistency:** `deriveCommentViews`/`RawThread`/`CommentAnchor`/`PageCommentsContextValue`/`CommentContent` defined in Task 2 and used identically in Tasks 3, 4, 6. Context fields (`enabled`, `activeCount`, `togglePanel`, `panelOpen`, `setPanelOpen`, `threads`, `newAnchor`, `openThreadId`, `canDeleteComments`, `createThread`, `addComment`, `resolveThread`, `reopenThread`, `deleteComment`, `startNewThread`, `cancelNewThread`, `openThread`) match between the type (Task 2), the provider (Task 3), and the consumers (Tasks 4, 6, 7). `ThreadCard` prop `active` added in Task 5 and used in Task 6. `PageRenderer` editor props (`commentThreads={anchors}`, `onCreateComment={startNewThread}`, `onOpenThread={openThread}`, `canComment`) match the editor's `types.ts` signatures. `renderAuth` prop added to `PageRenderer` (Task 7 Step 1) and passed by `share-page-client.tsx` (Task 7 Step 3). ✓
