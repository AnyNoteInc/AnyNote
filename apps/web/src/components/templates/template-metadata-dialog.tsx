'use client'

import { useEffect, useState } from 'react'

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EmojiIconButton,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { invalidateTemplates } from './invalidate-templates'

export type EditableTemplate = {
  id: string
  title: string
  description: string | null
  icon: string | null
  category: string | null
}

type Mode = { kind: 'create' } | { kind: 'edit'; template: EditableTemplate }

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  mode: Mode
  onSaved?: (id: string) => void
}

const TITLE_ID = 'template-metadata-dialog-title'

export function TemplateMetadataDialog({ open, onClose, workspaceId, mode, onSaved }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [category, setCategory] = useState('')

  useEffect(() => {
    if (!open) return
    if (mode.kind === 'edit') {
      setTitle(mode.template.title)
      setDescription(mode.template.description ?? '')
      setIcon(mode.template.icon)
      setCategory(mode.template.category ?? '')
    } else {
      setTitle('')
      setDescription('')
      setIcon(null)
      setCategory('')
    }
  }, [open, mode])

  const utils = trpc.useUtils()

  const createMut = trpc.template.create.useMutation({
    onSuccess: ({ id }) => {
      invalidateTemplates(utils, workspaceId)
      onSaved?.(id)
      onClose()
    },
  })
  const updateMut = trpc.template.update.useMutation({
    onSuccess: ({ id }) => {
      invalidateTemplates(utils, workspaceId)
      onSaved?.(id)
      onClose()
    },
  })

  const pending = createMut.isPending || updateMut.isPending
  const isError = createMut.isError || updateMut.isError
  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !pending

  const handleSubmit = () => {
    if (!canSubmit) return
    if (mode.kind === 'create') {
      createMut.mutate({
        workspaceId,
        title: trimmedTitle,
        description: description.trim() || null,
        icon,
        category: category.trim() || null,
      })
    } else {
      updateMut.mutate({
        templateId: mode.template.id,
        workspaceId,
        title: trimmedTitle,
        description: description.trim() || null,
        icon,
        category: category.trim() || null,
      })
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={TITLE_ID}>
      <DialogTitle id={TITLE_ID}>
        {mode.kind === 'create' ? 'Новый шаблон' : 'Изменить шаблон'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <EmojiIconButton
              value={icon}
              onChange={setIcon}
              onRemove={() => setIcon(null)}
              aria-label="Изменить иконку шаблона"
              sx={{ width: 40, height: 40, p: 0.5, borderRadius: 1 }}
              emojiSize={28}
            />
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Название шаблона"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </Stack>
          <TextField
            fullWidth
            size="small"
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
          <TextField
            fullWidth
            size="small"
            label="Категория"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          {isError ? (
            <Alert severity="error">Не удалось сохранить шаблон. Попробуйте ещё раз.</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          {mode.kind === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
