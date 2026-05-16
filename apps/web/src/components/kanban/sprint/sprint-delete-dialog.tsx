'use client'

import { useMemo } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import type { BoardTaskData } from '../types'
import { pluralizeRu } from './pluralize-ru'

interface SprintDeleteDialogProps {
  readonly pageId: string
  readonly sprint: { readonly id: string; readonly name: string }
  readonly tasks: BoardTaskData[]
  readonly open: boolean
  readonly onClose: () => void
}

export function SprintDeleteDialog({
  pageId,
  sprint,
  tasks,
  open,
  onClose,
}: SprintDeleteDialogProps) {
  const utils = trpc.useUtils()
  const remove = trpc.kanban.sprint.delete.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const count = useMemo(
    () => tasks.filter((t) => t.sprintId === sprint.id).length,
    [tasks, sprint.id],
  )

  const word = pluralizeRu(count, ['задача', 'задачи', 'задач'])
  const verb = pluralizeRu(count, ['вернётся', 'вернутся', 'вернутся'])

  function submit() {
    remove.mutate({ pageId, id: sprint.id })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Удалить спринт «{sprint.name}»?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {count > 0
            ? `${count} ${word} ${verb} в беклог.`
            : 'В спринте нет задач.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Это действие нельзя отменить.
        </Typography>
        {remove.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{remove.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          color="error"
          disabled={remove.isPending}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
