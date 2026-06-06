'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EmojiIconButton,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

const TITLE_ID = 'save-as-template-dialog-title'

interface Props {
  open: boolean
  onClose: () => void
  workspaceId: string
  pageId: string
  /** Pre-fills the template title. */
  defaultTitle: string
  /** Pre-fills the icon. */
  defaultIcon: string | null
  onSaved?: () => void
}

/**
 * "Сохранить как шаблон" form, opened from a page's context/actions menu.
 * Global scope is intentionally disabled: AnyNote has no global-admin role, so
 * global templates are seeded, not user-created.
 */
export function SaveAsTemplateDialog({
  open,
  onClose,
  workspaceId,
  pageId,
  defaultTitle,
  defaultIcon,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(defaultIcon)
  const [category, setCategory] = useState('')

  // Re-seed the form each time the dialog opens for a (possibly different) page.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setDescription('')
      setIcon(defaultIcon)
      setCategory('')
    }
  }, [open, defaultTitle, defaultIcon])

  const utils = trpc.useUtils()
  const createTemplate = trpc.template.createFromPage.useMutation({
    onSuccess: () => {
      utils.template.search.invalidate().catch(() => undefined)
      utils.template.listByWorkspace.invalidate({ workspaceId }).catch(() => undefined)
      onSaved?.()
      onClose()
    },
  })

  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !createTemplate.isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    createTemplate.mutate({
      pageId,
      workspaceId,
      title: trimmedTitle,
      description: description.trim() || undefined,
      icon,
      category: category.trim() || undefined,
      scope: 'WORKSPACE',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby={TITLE_ID}
    >
      <DialogTitle id={TITLE_ID}>Сохранить как шаблон</DialogTitle>
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

          <Box>
            <FormLabel sx={{ fontSize: 13 }}>Область видимости</FormLabel>
            <RadioGroup value="WORKSPACE">
              <FormControlLabel
                value="WORKSPACE"
                control={<Radio size="small" />}
                label="Только это пространство"
              />
              <Tooltip title="Глобальные шаблоны добавляются администратором">
                <FormControlLabel
                  value="GLOBAL"
                  disabled
                  control={<Radio size="small" />}
                  label={
                    <Typography variant="body2" color="text.disabled">
                      Глобальный
                    </Typography>
                  }
                />
              </Tooltip>
            </RadioGroup>
          </Box>

          {createTemplate.isError ? (
            <Alert severity="error">Не удалось сохранить шаблон. Попробуйте ещё раз.</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          Создать шаблон
        </Button>
      </DialogActions>
    </Dialog>
  )
}
