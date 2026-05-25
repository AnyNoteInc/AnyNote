'use client'

import { skipToken } from '@tanstack/react-query'

import { trpc } from '@/trpc/client'

import { getAnonId } from './anon-id'

export type CommentTarget = { pageId: string } | { shareId: string }

/** The discriminant identity of a comment target — its page id or share id. */
export const commentTargetKey = (target: CommentTarget): string =>
  'pageId' in target ? target.pageId : target.shareId

export type CommentContent = { text: string; mentions: string[] }
type CommentBaseInput = { pageId?: string; shareId?: string; anonId?: string }

// Explicit return type: keeps the (huge) tRPC mutation/query types out of the
// hook's exported signature (avoids TS7056 "type too large to serialize").
export type UsePageCommentsResult = {
  threads: unknown[]
  base: CommentBaseInput
  createThread: (
    input: CommentBaseInput & {
      anchorStart: string
      anchorEnd: string
      quotedText: string
      content: CommentContent
    },
  ) => void
  addComment: (input: CommentBaseInput & { threadId: string; content: CommentContent }) => void
  editComment: (input: CommentBaseInput & { commentId: string; content: CommentContent }) => void
  deleteComment: (input: CommentBaseInput & { commentId: string }) => void
  resolveThread: (input: CommentBaseInput & { threadId: string }) => void
  reopenThread: (input: CommentBaseInput & { threadId: string }) => void
}

export function usePageComments(
  target: CommentTarget,
  opts?: { enabled?: boolean },
): UsePageCommentsResult {
  const utils = trpc.useUtils()
  const isPageTarget = 'pageId' in target
  const base = isPageTarget ? { pageId: target.pageId } : { shareId: target.shareId, anonId: getAnonId() }
  const subscriptionInput = isPageTarget && (opts?.enabled ?? true) ? { pageId: target.pageId } : skipToken
  const threadsQ = trpc.comment.listThreads.useQuery(base, {
    refetchOnWindowFocus: true,
    enabled: opts?.enabled ?? true,
  })
  const invalidate = () => utils.comment.listThreads.invalidate(base)

  trpc.comment.events.subscribe.useSubscription(
    subscriptionInput,
    { onData: () => invalidate() },
  )

  const createThread = trpc.comment.createThread.useMutation({ onSuccess: invalidate })
  const addComment = trpc.comment.addComment.useMutation({ onSuccess: invalidate })
  const editComment = trpc.comment.editComment.useMutation({ onSuccess: invalidate })
  const deleteComment = trpc.comment.deleteComment.useMutation({ onSuccess: invalidate })
  const resolveThread = trpc.comment.resolveThread.useMutation({ onSuccess: invalidate })
  const reopenThread = trpc.comment.reopenThread.useMutation({ onSuccess: invalidate })

  return {
    threads: threadsQ.data ?? [],
    base,
    createThread: (input) => createThread.mutate(input as Parameters<typeof createThread.mutate>[0]),
    addComment: (input) => addComment.mutate(input as Parameters<typeof addComment.mutate>[0]),
    editComment: (input) => editComment.mutate(input as Parameters<typeof editComment.mutate>[0]),
    deleteComment: (input) => deleteComment.mutate(input as Parameters<typeof deleteComment.mutate>[0]),
    resolveThread: (input) => resolveThread.mutate(input as Parameters<typeof resolveThread.mutate>[0]),
    reopenThread: (input) => reopenThread.mutate(input as Parameters<typeof reopenThread.mutate>[0]),
  }
}
