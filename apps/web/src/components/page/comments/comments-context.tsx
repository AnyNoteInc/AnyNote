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
