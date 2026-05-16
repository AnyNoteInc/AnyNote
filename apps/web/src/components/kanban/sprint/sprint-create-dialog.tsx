'use client'

import { useState } from 'react'
import {
  AdapterDateFns,
  Box,
  Button,
  DatePicker,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LocalizationProvider,
  Stack,
  TextField,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface SprintCreateDialogProps {
  readonly pageId: string
  readonly open: boolean
  readonly onClose: () => void
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
  const [start, setStart] = useState<Date | null>(null)
  const [end, setEnd] = useState<Date | null>(null)

  function submit() {
    create.mutate({
      pageId,
      name,
      description: description || undefined,
      startDate: start,
      endDate: end,
    })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
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
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Период
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <DatePicker
                  label="Старт"
                  value={start}
                  onChange={(value) => {
                    setStart(value)
                    if (end && value && value > end) setEnd(null)
                  }}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
                <Typography color="text.secondary">—</Typography>
                <DatePicker
                  label="Финиш"
                  value={end}
                  minDate={start ?? undefined}
                  onChange={(value) => setEnd(value)}
                  slotProps={{ textField: { size: 'small', fullWidth: true } }}
                />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Отмена</Button>
          <Button onClick={submit} variant="contained" disabled={!name || create.isPending}>
            Создать
          </Button>
        </DialogActions>
      </Dialog>
    </LocalizationProvider>
  )
}
