'use client'

import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface SprintCreateDialogProps {
  pageId: string
  open: boolean
  onClose: () => void
}

export function SprintCreateDialog({ pageId, open, onClose }: SprintCreateDialogProps) {
  const utils = trpc.useUtils()
  const create = trpc.kanban.sprint.create.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  function submit() {
    create.mutate({
      pageId,
      name,
      description: description || undefined,
      startDate: start ? new Date(start) : null,
      endDate: end ? new Date(end) : null,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Новый спринт</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
          />
          <TextField
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Старт"
              type="date"
              value={start}
              InputLabelProps={{ shrink: true }}
              onChange={(e) => setStart(e.target.value)}
              fullWidth
            />
            <TextField
              label="Финиш"
              type="date"
              value={end}
              InputLabelProps={{ shrink: true }}
              onChange={(e) => setEnd(e.target.value)}
              fullWidth
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button onClick={submit} variant="contained" disabled={!name || create.isPending}>
          Создать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
