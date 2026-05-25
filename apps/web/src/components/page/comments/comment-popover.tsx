'use client'

import { useEffect, useMemo } from 'react'

import { Box, ClickAwayListener, Paper, Popper, Typography } from '@repo/ui/components'

import { CommentComposer } from './comment-composer'
import { usePageCommentsContext } from './comments-context'
import { ThreadCard } from './thread-card'

const ACTIVE_SELECTOR = '.comment-highlight-active'
const ZERO_RECT = {
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect

/**
 * Floating thread/composer anchored to the active in-text highlight. The anchor
 * re-queries `.comment-highlight-active` on every reposition, so it follows the
 * text on scroll and survives ProseMirror re-rendering the decoration span.
 */
export function CommentPopover() {
  const {
    popover,
    closePopover,
    newAnchor,
    threads,
    canDeleteComments,
    createThread,
    addComment,
    resolveThread,
    reopenThread,
    deleteComment,
  } = usePageCommentsContext()

  const anchorEl = useMemo(
    () => ({
      getBoundingClientRect: () =>
        document.querySelector(ACTIVE_SELECTOR)?.getBoundingClientRect() ?? ZERO_RECT,
    }),
    [],
  )

  useEffect(() => {
    if (!popover) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover, closePopover])

  if (!popover) return null
  const thread = popover.kind === 'thread' ? (threads.find((t) => t.id === popover.threadId) ?? null) : null
  if (popover.kind === 'thread' && !thread) return null

  return (
    <Popper
      open
      anchorEl={anchorEl}
      placement="bottom-start"
      style={{ zIndex: 1300 }}
      modifiers={[
        { name: 'offset', options: { offset: [0, 6] } },
        { name: 'flip', enabled: true },
      ]}
    >
      <ClickAwayListener onClickAway={closePopover}>
        <Paper
          variant="outlined"
          className="comment-popover"
          sx={{ width: 320, maxHeight: 380, overflow: 'auto', boxShadow: 4 }}
        >
          {popover.kind === 'new' && newAnchor ? (
            <Box sx={{ p: 1.5 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ display: 'block', mb: 0.5 }}
              >
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
