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
        <IconButton size="small" onClick={() => setPanelOpen(false)} aria-label="Закрыть комментарии">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Button size="small" variant={tab === 'active' ? 'contained' : 'text'} onClick={() => setTab('active')}>
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
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.5 }}>
            «{newAnchor.quotedText}»
          </Typography>
          <CommentComposer autoFocus onSubmit={createThread} />
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
            onDeleteComment={deleteComment}
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
