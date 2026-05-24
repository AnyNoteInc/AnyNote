'use client'

import { useState } from 'react'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import type { UiThread } from './types'

type Props = {
  threads: UiThread[]
  onOpen: (id: string) => void
  onClose: () => void
}

export function CommentsPanel({ threads, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const shown = threads.filter((t) => (tab === 'active' ? !t.resolvedAt : !!t.resolvedAt))

  return (
    <Box sx={{ width: 320, borderLeft: 1, borderColor: 'divider', height: '100%', overflow: 'auto', p: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Комментарии</Typography>
        <Button size="small" onClick={onClose}>
          Закрыть
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Button size="small" variant={tab === 'active' ? 'contained' : 'text'} onClick={() => setTab('active')}>
          Активные
        </Button>
        <Button size="small" variant={tab === 'resolved' ? 'contained' : 'text'} onClick={() => setTab('resolved')}>
          Решённые
        </Button>
      </Stack>
      <Stack spacing={1}>
        {shown.map((t) => (
          <Box
            key={t.id}
            onClick={() => onOpen(t.id)}
            sx={{ p: 1, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              «{t.quotedText}»
            </Typography>
            <Typography variant="body2" noWrap>
              {t.comments[0]?.authorName}: {t.comments[0]?.content.text}
            </Typography>
          </Box>
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
