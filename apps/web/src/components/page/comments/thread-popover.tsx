'use client'

import { Box, Button, Paper, Stack, Typography } from '@repo/ui/components'

import { CommentComposer } from './comment-composer'
import type { UiThread } from './types'

type Props = {
  thread: UiThread
  onReply: (c: { text: string; mentions: string[] }) => void
  onResolve: () => void
  onReopen: () => void
  onDeleteComment: (commentId: string) => void
}

export function ThreadCard({ thread, onReply, onResolve, onReopen, onDeleteComment }: Props) {
  return (
    <Paper sx={{ p: 1.5, width: 320, maxHeight: 440, overflow: 'auto' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        «{thread.quotedText}»
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {thread.comments.map((c) => (
          <Box key={c.id}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle2">{c.authorName}</Typography>
              <Button
                size="small"
                color="error"
                onClick={() => onDeleteComment(c.id)}
                sx={{ minWidth: 0, px: 0.5 }}
                aria-label="Удалить комментарий"
              >
                ×
              </Button>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {c.content.text}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Box sx={{ mt: 1 }}>
        <CommentComposer onSubmit={onReply} />
      </Box>
      <Box sx={{ mt: 1, textAlign: 'right' }}>
        {thread.resolvedAt ? (
          <Button size="small" onClick={onReopen}>
            Открыть заново
          </Button>
        ) : (
          <Button size="small" onClick={onResolve}>
            Решить
          </Button>
        )}
      </Box>
    </Paper>
  )
}
