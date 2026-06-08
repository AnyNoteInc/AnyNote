'use client'

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

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

import { invalidateTemplates } from './invalidate-templates'

type Props = {
  open: boolean
  onClose: () => void
  templateId: string
  workspaceId: string
  initialTitle: string
  initialIcon: string | null
  initialDescription: string | null
}

const TITLE_ID = 'template-meta-dialog-title'

export function TemplateMetaDialog({
  open,
  onClose,
  templateId,
  workspaceId,
  initialTitle,
  initialIcon,
  initialDescription,
}: Readonly<Props>) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [icon, setIcon] = useState(initialIcon ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')

  useEffect(() => {
    if (!open) return
    setTitle(initialTitle)
    setIcon(initialIcon ?? '')
    setDescription(initialDescription ?? '')
  }, [open, initialTitle, initialIcon, initialDescription])

  const utils = trpc.useUtils()
  const updateMut = trpc.template.update.useMutation({
    onSuccess: () => {
      invalidateTemplates(utils)
      utils.template.getById.invalidate({ templateId, workspaceId }).catch(() => undefined)
      router.refresh()
      onClose()
    },
  })

  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !updateMut.isPending

  const handleSave = () => {
    if (!canSubmit) return
    updateMut.mutate({
      templateId,
      workspaceId,
      title: trimmedTitle,
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={TITLE_ID}>
      <DialogTitle id={TITLE_ID}>Изменить шаблон</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Название"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            fullWidth
            size="small"
            label="Иконка (эмодзи)"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
          />
          <TextField
            fullWidth
            size="small"
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSubmit}>
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
