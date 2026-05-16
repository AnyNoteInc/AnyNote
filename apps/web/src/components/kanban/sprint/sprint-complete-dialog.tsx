'use client'

import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardColumnRow, BoardData, BoardTaskData } from '../types'

interface SprintCompleteDialogProps {
  readonly pageId: string
  readonly sprint: { readonly id: string; readonly name: string }
  readonly tasks: BoardTaskData[]
  readonly columns: BoardColumnRow[]
  readonly otherSprints: BoardData['sprints']
  readonly open: boolean
  readonly onClose: () => void
}

const BACKLOG_VALUE = '__backlog__'

export function SprintCompleteDialog({
  pageId,
  sprint,
  tasks,
  columns,
  otherSprints,
  open,
  onClose,
}: SprintCompleteDialogProps) {
  const utils = trpc.useUtils()
  const complete = trpc.kanban.sprint.complete.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const { doneCount, undoneCount } = useMemo(() => {
    const undoneColumnIds = new Set(
      columns.filter((c) => c.kind === 'ACTIVE').map((c) => c.id),
    )
    const sprintTasks = tasks.filter((t) => t.sprintId === sprint.id)
    const undone = sprintTasks.filter((t) => undoneColumnIds.has(t.columnId))
    return { doneCount: sprintTasks.length - undone.length, undoneCount: undone.length }
  }, [tasks, columns, sprint.id])

  const plannedSprints = useMemo(
    () =>
      otherSprints
        .filter((s) => s.id !== sprint.id && s.status === 'PLANNED')
        .sort((a, b) => a.position - b.position),
    [otherSprints, sprint.id],
  )

  const [destination, setDestination] = useState<string>(
    plannedSprints[0]?.id ?? BACKLOG_VALUE,
  )

  function submit() {
    complete.mutate({
      pageId,
      id: sprint.id,
      moveUndoneTo: destination === BACKLOG_VALUE ? null : destination,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Завершить спринт «{sprint.name}»</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={4} sx={{ mt: 1, mb: 2 }}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Выполнено
            </Typography>
            <Typography variant="h4">{doneCount}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Не выполнено
            </Typography>
            <Typography variant="h4">{undoneCount}</Typography>
          </Box>
        </Stack>

        {undoneCount > 0 ? (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Куда перенести невыполненные задачи?
            </Typography>
            <TextField
              select
              fullWidth
              size="small"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              {plannedSprints.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
              <MenuItem value={BACKLOG_VALUE}>Беклог</MenuItem>
            </TextField>
          </>
        ) : null}

        {complete.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{complete.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button onClick={submit} variant="contained" disabled={complete.isPending}>
          Завершить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
