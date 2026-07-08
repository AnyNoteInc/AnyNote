'use client'

import { useState } from 'react'
import { Button, CloseIcon, DeleteIcon, IconButton, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { useSelection } from './selection-context'
import type { BoardData } from '../types'

interface BulkActionBarProps {
  readonly pageId: string
  readonly board: BoardData
}

// Inline bulk-action controls shown in the table-view header (left of "Новый
// спринт") whenever one or more tasks are selected.
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
      const sprintByTaskId = new Map(board.tasks.map((t) => [t.id, t.sprintId]))
      await Promise.all(
        ids
          .filter((id) => sprintByTaskId.get(id))
          .map((id) =>
            updateTask.mutateAsync({ pageId, id, sprintId: null, sprintPosition: null }),
          ),
      )
      clear()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSelected() {
    if (
      typeof globalThis.confirm === 'function' &&
      !globalThis.confirm(`Удалить задачи (${ids.length})?`)
    )
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
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
        {ids.length} выбрано
      </Typography>
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
  )
}
