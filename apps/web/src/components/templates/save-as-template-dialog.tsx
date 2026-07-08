'use client'

import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
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
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { TagIcon } from '@/components/marketplace/tag-icon'
import { PageIcon } from '@/components/page/page-icon'

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
  const [scope, setScope] = useState<'WORKSPACE' | 'GLOBAL'>('WORKSPACE')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])

  const tagsQuery = trpc.template.listTags.useQuery()

  const toggleTag = (id: string) =>
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // Re-seed the form each time the dialog opens for a (possibly different) page.
  useEffect(() => {
    if (open) {
      setTitle(defaultTitle)
      setDescription('')
      setIcon(defaultIcon)
      setScope('WORKSPACE')
      setSelectedTagIds([])
    }
  }, [open, defaultTitle, defaultIcon])

  const utils = trpc.useUtils()
  const createTemplate = trpc.template.createFromPage.useMutation({
    onSuccess: () => {
      utils.template.listMarketplace.invalidate().catch(() => undefined)
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
      scope,
      tagIds: selectedTagIds,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={TITLE_ID}>
      <DialogTitle id={TITLE_ID}>Сохранить как шаблон</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <EmojiIconButton
              value={icon}
              onChange={setIcon}
              onRemove={() => setIcon(null)}
              aria-label="Изменить иконку шаблона"
              sx={{ width: 40, height: 40, p: 0.5, borderRadius: 1 }}
              emojiSize={28}
              // PageIcon understands the `url:` image-icon format — the default
              // emoji span would render it as raw text.
              renderValue={(v) => <PageIcon icon={v} size={28} fallback="📄" />}
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

          <Box>
            <FormLabel sx={{ fontSize: 13 }}>Теги</FormLabel>
            <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
              {(tagsQuery.data ?? []).map((t) => (
                <Chip
                  key={t.id}
                  icon={<TagIcon name={t.icon} fontSize="small" />}
                  label={t.name}
                  size="small"
                  clickable
                  color={selectedTagIds.includes(t.id) ? 'primary' : 'default'}
                  variant={selectedTagIds.includes(t.id) ? 'filled' : 'outlined'}
                  onClick={() => toggleTag(t.id)}
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <FormLabel sx={{ fontSize: 13 }}>Область видимости</FormLabel>
            <RadioGroup
              value={scope}
              onChange={(e) => setScope(e.target.value as 'WORKSPACE' | 'GLOBAL')}
            >
              <FormControlLabel
                value="WORKSPACE"
                control={<Radio size="small" />}
                label="Только это пространство"
              />
              <FormControlLabel
                value="GLOBAL"
                control={<Radio size="small" />}
                label="Глобальный (виден всем)"
              />
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
