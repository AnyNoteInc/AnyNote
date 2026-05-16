'use client'

import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SprintFormFields, type SprintFormValues } from './sprint-form-fields'

interface SprintLike {
  readonly id: string
  readonly name: string
  readonly description?: string | null
  readonly startDate?: Date | string | null
  readonly endDate?: Date | string | null
}

interface SprintEditDialogProps {
  readonly pageId: string
  readonly sprint: SprintLike
  readonly open: boolean
  readonly onClose: () => void
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

export function SprintEditDialog({ pageId, sprint, open, onClose }: SprintEditDialogProps) {
  const utils = trpc.useUtils()
  const update = trpc.kanban.sprint.update.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      onClose()
    },
  })

  const original = useMemo<SprintFormValues>(
    () => ({
      name: sprint.name,
      description: sprint.description ?? '',
      startDate: toDate(sprint.startDate),
      endDate: toDate(sprint.endDate),
    }),
    [sprint],
  )
  const [values, setValues] = useState<SprintFormValues>(original)

  const dirty =
    values.name !== original.name ||
    values.description !== original.description ||
    (values.startDate?.getTime() ?? null) !== (original.startDate?.getTime() ?? null) ||
    (values.endDate?.getTime() ?? null) !== (original.endDate?.getTime() ?? null)

  function submit() {
    update.mutate({
      pageId,
      id: sprint.id,
      name: values.name,
      description: values.description || null,
      startDate: values.startDate,
      endDate: values.endDate,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Изменить спринт</DialogTitle>
      <DialogContent>
        <SprintFormFields values={values} onChange={setValues} autoFocusName />
        {update.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{update.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          disabled={!values.name || !dirty || update.isPending}
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
