'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import type { PageType } from '@repo/db'

import { CommentMentionSearchProvider } from './comment-composer'
import { useWorkspaceMentionSearch } from './use-mention-search'
import { usePageComments, type CommentTarget } from './use-page-comments'

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
  const [newAnchor, setNewAnchor] = useState<PageCommentsContextValue['newAnchor']>(null)

  // Reset transient comment UI when navigating to a different page/share target,
  // without remounting the provider (which would otherwise remount the toolbar chrome).
  const targetKey = 'pageId' in target ? target.pageId : target.shareId
  const [prevTargetKey, setPrevTargetKey] = useState(targetKey)
  if (targetKey !== prevTargetKey) {
    setPrevTargetKey(targetKey)
    setPanelOpen(false)
    setOpenThreadId(null)
    setNewAnchor(null)
  }

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
      const c = commentsRef.current
      c.createThread({ ...c.base, ...newAnchor, content })
      setNewAnchor(null)
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
