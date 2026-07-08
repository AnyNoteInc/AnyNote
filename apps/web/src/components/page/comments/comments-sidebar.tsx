'use client'

import { useEffect, useRef, useState } from 'react'

import { Box, Button, CloseIcon, IconButton, Stack, Typography } from '@repo/ui/components'

import { usePageCommentsContext } from './comments-context'
import { ThreadCard } from './thread-card'

export const COMMENTS_SIDEBAR_WIDTH = 320

export function CommentsSidebar() {
  const {
    enabled,
    panelOpen,
    closePanel,
    threads,
    openThreadId,
    canDeleteComments,
    addComment,
    resolveThread,
    reopenThread,
    deleteComment,
  } = usePageCommentsContext()
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const scrollRef = useRef<HTMLDivElement>(null)

  // openThreadId is set by an editor anchor click. Read threads via a ref and
  // key only on openThreadId, so later comment edits (a fresh threads array)
  // don't re-scroll an already-open thread or fight a manual tab switch.
  const threadsRef = useRef(threads)
  threadsRef.current = threads
  useEffect(() => {
    if (!openThreadId) return
    const t = threadsRef.current.find((x) => x.id === openThreadId)
    if (t) setTab(t.resolvedAt ? 'resolved' : 'active')
    const el = scrollRef.current?.querySelector(`[data-thread-card-id="${openThreadId}"]`)
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [openThreadId])

  if (!enabled || !panelOpen) return null

  const shown = threads.filter((t) => (tab === 'active' ? !t.resolvedAt : !!t.resolvedAt))

  return (
    <Box
      ref={scrollRef}
      className="comments-sidebar"
      sx={{
        width: COMMENTS_SIDEBAR_WIDTH,
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        bgcolor: 'background.default',
        borderLeft: 1,
        borderColor: 'divider',
        height: '100%',
        overflow: 'auto',
        p: 1.5,
      }}
    >
      <Stack direction="row" sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">Комментарии</Typography>
        <IconButton size="small" onClick={closePanel} aria-label="Закрыть комментарии">
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
            onDeleteComment={deleteComment}
          />
        ))}
        {shown.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Нет комментариев
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
