'use client'

import { useState } from 'react'
import {
  Box,
  Button,
  CloseIcon,
  DeleteIcon,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { useSelection } from './selection-context'
import type { BoardData } from '../types'

interface BulkActionBarProps {
  readonly pageId: string
  readonly board: BoardData
}

export function BulkActionBar({ pageId, board }: BulkActionBarProps) {
  const { selected, clear } = useSelection()
  const utils = trpc.useUtils()
  const invalidate = () => utils.kanban.board.getBoard.invalidate({ pageId })
  const bulkDelete = trpc.kanban.task.bulkSoftDelete.useMutation({ onSuccess: invalidate })
  const updateTask = trpc.kanban.task.update.useMutation({ onSuccess: invalidate })
  const [busy, setBusy] = useState(false)

  if (selected.size === 0) return null
  const ids = [...selected]

  async function removeFromSprint() {
    setBusy(true)
    try {
      await Promise.all(
        ids
          .filter((id) => board.tasks.find((t) => t.id === id)?.sprintId)
          .map((id) => updateTask.mutateAsync({ pageId, id, sprintId: null, sprintPosition: null })),
      )
      clear()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(`Удалить задачи (${ids.length})?`))
      return
    setBusy(true)
    try {
      await bulkDelete.mutateAsync({ pageId, ids })
      clear()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 5,
        mt: 1,
        py: 1,
        px: 2,
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={2} sx={{ width: '100%' }}>
        <Typography variant="body2" fontWeight={600}>
          {ids.length} выбрано
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={removeFromSprint} disabled={busy}>
          Удалить из спринта
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={deleteSelected}
          disabled={busy}
        >
          Удалить
        </Button>
        <IconButton size="small" onClick={clear} aria-label="Снять выделение">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  )
}
