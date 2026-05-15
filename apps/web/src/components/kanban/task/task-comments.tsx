'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  IconButton,
  CloseIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface TaskCommentsProps {
  readonly pageId: string
  readonly taskId: string
  readonly currentUserId: string
}

interface CommentRow {
  id: string
  authorId: string
  content: unknown
  createdAt: Date | string
  author: { firstName: string | null; lastName: string | null; email: string }
}

function authorName(author: {
  firstName: string | null
  lastName: string | null
  email: string
}): string {
  const name = `${author.firstName ?? ''} ${author.lastName ?? ''}`.trim()
  return name || author.email
}

function readText(content: unknown): string {
  if (content && typeof content === 'object' && 'text' in content) {
    const value = (content as { text: unknown }).text
    if (typeof value === 'string') return value
  }
  return typeof content === 'string' ? content : ''
}

export function TaskComments({ pageId, taskId, currentUserId }: TaskCommentsProps) {
  const utils = trpc.useUtils()
  const { data: listData } = trpc.kanban.comment.list.useQuery({ pageId, taskId })
  const comments: CommentRow[] = listData ?? []

  const invalidate = () => utils.kanban.comment.list.invalidate({ pageId, taskId })
  const create = trpc.kanban.comment.create.useMutation({ onSuccess: invalidate })
  const remove = trpc.kanban.comment.delete.useMutation({ onSuccess: invalidate })

  const [draft, setDraft] = useState('')

  function submit() {
    const text = draft.trim()
    if (!text) return
    create.mutate({ pageId, taskId, content: { text } })
    setDraft('')
  }

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">Комментарии</Typography>

      <Stack spacing={1.5}>
        {comments.map((c) => (
          <Box
            key={c.id}
            sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', position: 'relative' }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary">
                {authorName(c.author)} ·{' '}
                {new Date(c.createdAt).toLocaleString('ru-RU', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </Typography>
              {c.authorId === currentUserId ? (
                <IconButton
                  size="small"
                  onClick={() => remove.mutate({ pageId, taskId, id: c.id })}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              ) : null}
            </Stack>
            <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
              {readText(c.content)}
            </Typography>
          </Box>
        ))}
        {comments.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Комментариев пока нет.
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={1}>
        <TextField
          multiline
          minRows={2}
          placeholder="Написать комментарий…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <Stack direction="row" justifyContent="flex-end">
          <Button onClick={submit} variant="contained" size="small" disabled={!draft.trim()}>
            Отправить (Ctrl+Enter)
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )
}
