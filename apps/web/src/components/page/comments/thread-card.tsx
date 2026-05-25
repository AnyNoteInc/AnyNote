'use client'

import {
  Box,
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
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontStyle: 'italic', flex: 1, minWidth: 0 }}
        >
          «{thread.quotedText}»
        </Typography>
        <Tooltip title={thread.resolvedAt ? 'Открыть заново' : 'Решить'}>
          <IconButton
            size="small"
            onClick={thread.resolvedAt ? onReopen : onResolve}
            aria-label={thread.resolvedAt ? 'Открыть заново' : 'Решить'}
            sx={{
              width: 28,
              height: 28,
              flexShrink: 0,
              color: thread.resolvedAt ? 'success.main' : 'text.secondary',
            }}
          >
            <CheckRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
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
    </Paper>
  )
}
