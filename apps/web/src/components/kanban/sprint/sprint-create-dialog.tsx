'use client'

import { useState } from 'react'
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

interface SprintCreateDialogProps {
  readonly pageId: string
  readonly open: boolean
  readonly onClose: () => void
}

const EMPTY: SprintFormValues = { name: '', description: '', startDate: null, endDate: null }

export function SprintCreateDialog({ pageId, open, onClose }: SprintCreateDialogProps) {
  const utils = trpc.useUtils()
  const [values, setValues] = useState<SprintFormValues>(EMPTY)
  const create = trpc.kanban.sprint.create.useMutation({
    onSuccess: async () => {
      await utils.kanban.board.getBoard.invalidate({ pageId })
      setValues(EMPTY)
      onClose()
    },
  })

  function submit() {
    create.mutate({
      pageId,
      name: values.name,
      description: values.description || undefined,
      startDate: values.startDate,
      endDate: values.endDate,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Новый спринт</DialogTitle>
      <DialogContent>
        <SprintFormFields values={values} onChange={setValues} autoFocusName />
        {create.error ? (
          <Box sx={{ mt: 1, color: 'error.main', fontSize: 14 }}>{create.error.message}</Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          onClick={submit}
          variant="contained"
          disabled={!values.name || create.isPending}
        >
          Создать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
