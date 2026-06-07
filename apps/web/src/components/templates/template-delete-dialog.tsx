'use client'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { invalidateTemplates } from './invalidate-templates'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  template: { id: string; title: string }
}

export function TemplateDeleteDialog({ open, onClose, workspaceId, template }: Props) {
  const utils = trpc.useUtils()
  const remove = trpc.template.delete.useMutation({
    onSuccess: () => {
      invalidateTemplates(utils)
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Удалить шаблон «{template.title}»?</DialogTitle>
      <DialogContent>
        <Typography variant="body2">Это действие необратимо.</Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => remove.mutate({ templateId: template.id, workspaceId })}
          disabled={remove.isPending}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
