'use client'

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type DialogFile = {
  id: string
  name: string
}

type Props = {
  open: boolean
  file: DialogFile | null
  onClose: () => void
  onDeleted: () => void
}

export function FilesDeleteDialog({ open, file, onClose, onDeleted }: Props) {
  const mutation = trpc.file.delete.useMutation({
    onSuccess: () => {
      onDeleted()
      onClose()
    },
  })

  const handleConfirm = () => {
    if (!file) return
    mutation.mutate({ id: file.id })
  }

  const handleClose = () => {
    if (mutation.isPending) return
    mutation.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Удалить файл?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Файл «{file?.name ?? ''}» будет удалён. Это действие нельзя отменить.
        </DialogContentText>
        {mutation.error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {mutation.error.message}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={mutation.isPending}>
          Отмена
        </Button>
        <Button
          onClick={handleConfirm}
          color="error"
          variant="contained"
          loading={mutation.isPending}
          disabled={!file}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
