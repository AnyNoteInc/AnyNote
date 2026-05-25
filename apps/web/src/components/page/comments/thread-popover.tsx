'use client'

import {
  Box,
  Button,
  CheckRoundedIcon,
  CloseIcon,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { CommentComposer } from './comment-composer'
import type { UiThread } from './types'

type Props = {
  thread: UiThread
  onReply: (c: { text: string; mentions: string[] }) => void
  onResolve: () => void
  onReopen: () => void
  onDeleteComment: (commentId: string) => void
  canDeleteComments?: boolean
}

export function ThreadCard({
  thread,
  onReply,
  onResolve,
  onReopen,
  onDeleteComment,
  canDeleteComments = true,
}: Props) {
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
              {canDeleteComments ? (
                <Tooltip title="Удалить комментарий">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => onDeleteComment(c.id)}
                    aria-label="Удалить комментарий"
                    sx={{ width: 32, height: 32, flexShrink: 0 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
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
            <CheckRoundedIcon sx={{ mr: 0.5, fontSize: 18, color: 'success.main' }} />
            Решить
          </Button>
        )}
      </Box>
    </Paper>
  )
}
