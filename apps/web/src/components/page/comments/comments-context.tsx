'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { PageType } from '@repo/db'
import type { CommentThreadAnchor } from '@repo/editor'

import { usePagePanelMember } from '@/components/page/panel-region-context'

import { CommentMentionSearchProvider } from './comment-composer'
import { useCommentHash } from './use-comment-hash'
import { useWorkspaceMentionSearch } from './use-mention-search'
import {
  commentTargetKey,
  usePageComments,
  type CommentContent,
  type CommentTarget,
} from './use-page-comments'

import type { UiThread } from './types'

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

/** Pure mapping from the tRPC thread list to the editor anchors + sidebar view + active count. */
export function deriveCommentViews(rawThreads: RawThread[]): {
  uiThreads: UiThread[]
  anchors: CommentThreadAnchor[]
  activeCount: number
} {
  const anchors: CommentThreadAnchor[] = rawThreads.map((t) => ({
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

export type NewThreadAnchor = { anchorStart: string; anchorEnd: string; quotedText: string }

/** Which thread the in-text popover is showing, or a pending new-comment composer. */
export type CommentPopover = { kind: 'thread'; threadId: string } | { kind: 'new' }

export type PageCommentsContextValue = {
  enabled: boolean
  threads: UiThread[]
  anchors: CommentThreadAnchor[]
  activeCount: number
  canComment: boolean
  canDeleteComments: boolean

  // Right sidebar — the "all discussions" view (toolbar icon + #comment deep-link).
  panelOpen: boolean
  closePanel: () => void
  togglePanel: () => void
  openThreadId: string | null
  openThreadInSidebar: (id: string) => void

  // In-text popover — per-thread view and new-comment creation.
  popover: CommentPopover | null
  openThreadPopover: (id: string) => void
  closePopover: () => void
  newAnchor: NewThreadAnchor | null
  startNewThread: (anchor: NewThreadAnchor) => void
  cancelNewThread: () => void

  // The single highlighted anchor in the text (derived from popover/sidebar state).
  activeAnchor: { anchorStart: string; anchorEnd: string } | null

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
  const { uiThreads, anchors, activeCount } = useMemo(
    () => deriveCommentViews(comments.threads as unknown as RawThread[]),
    [comments.threads],
  )
  const commentsRef = useRef(comments)
  commentsRef.current = comments

  const [panelOpen, setPanelOpen] = useState(false)
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [newAnchor, setNewAnchor] = useState<NewThreadAnchor | null>(null)
  const [popover, setPopover] = useState<CommentPopover | null>(null)

  // Reset transient comment UI when navigating to a different page/share target,
  // without remounting the provider (which would otherwise remount the toolbar chrome).
  const targetKey = commentTargetKey(target)
  const [prevTargetKey, setPrevTargetKey] = useState(targetKey)
  if (targetKey !== prevTargetKey) {
    setPrevTargetKey(targetKey)
    setPanelOpen(false)
    setOpenThreadId(null)
    setNewAnchor(null)
    setPopover(null)
  }

  const closePanel = useCallback(() => setPanelOpen(false), [])
  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])

  // Единый регион панелей: открытые комментарии вытесняют историю/просмотр.
  usePagePanelMember('comments', panelOpen, closePanel)
  const openThreadInSidebar = useCallback((id: string) => {
    setOpenThreadId(id)
    setPanelOpen(true)
  }, [])
  const openThreadPopover = useCallback((id: string) => {
    setPopover({ kind: 'thread', threadId: id })
  }, [])
  const closePopover = useCallback(() => {
    setPopover(null)
    setNewAnchor(null)
  }, [])
  const startNewThread = useCallback((anchor: NewThreadAnchor) => {
    setNewAnchor(anchor)
    setPopover({ kind: 'new' })
  }, [])
  const cancelNewThread = useCallback(() => {
    setNewAnchor(null)
    setPopover(null)
  }, [])

  const createThread = useCallback(
    (content: CommentContent) => {
      if (!newAnchor) return
      const c = commentsRef.current
      c.createThread({ ...c.base, ...newAnchor, content })
      setNewAnchor(null)
      setPopover(null)
    },
    [newAnchor],
  )
  const addComment = useCallback((threadId: string, content: CommentContent) => {
    const c = commentsRef.current
    c.addComment({ ...c.base, threadId, content })
  }, [])
  const resolveThread = useCallback((threadId: string) => {
    const c = commentsRef.current
    c.resolveThread({ ...c.base, threadId })
  }, [])
  const reopenThread = useCallback((threadId: string) => {
    const c = commentsRef.current
    c.reopenThread({ ...c.base, threadId })
  }, [])
  const deleteComment = useCallback((commentId: string) => {
    const c = commentsRef.current
    c.deleteComment({ ...c.base, commentId })
  }, [])

  // A `#comment-<id>` URL hash force-opens the sidebar on that thread.
  useCommentHash(openThreadInSidebar)

  // The active anchor drives the in-text emphasis decoration: the popover's
  // thread (or its pending new selection), else the sidebar's open thread.
  // Memoized so its identity is stable — otherwise the editor's
  // setActiveCommentAnchor effect would dispatch a transaction every render.
  const activeAnchor = useMemo<{ anchorStart: string; anchorEnd: string } | null>(() => {
    if (popover?.kind === 'new') {
      return newAnchor ? { anchorStart: newAnchor.anchorStart, anchorEnd: newAnchor.anchorEnd } : null
    }
    let id: string | null = null
    if (popover?.kind === 'thread') id = popover.threadId
    else if (panelOpen) id = openThreadId
    const found = id ? anchors.find((a) => a.id === id) : undefined
    return found ? { anchorStart: found.anchorStart, anchorEnd: found.anchorEnd } : null
  }, [popover, panelOpen, openThreadId, newAnchor, anchors])

  const value = useMemo<PageCommentsContextValue>(
    () => ({
      enabled,
      threads: uiThreads,
      anchors,
      activeCount,
      canComment,
      canDeleteComments,
      panelOpen,
      closePanel,
      togglePanel,
      openThreadId,
      openThreadInSidebar,
      popover,
      openThreadPopover,
      closePopover,
      newAnchor,
      startNewThread,
      cancelNewThread,
      activeAnchor,
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
      closePanel,
      togglePanel,
      openThreadId,
      openThreadInSidebar,
      popover,
      openThreadPopover,
      closePopover,
      newAnchor,
      startNewThread,
      cancelNewThread,
      activeAnchor,
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
