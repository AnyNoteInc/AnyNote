'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'

import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  type PageTreeSelection,
} from '@/components/workspace/page-tree-picker'
import { trpc } from '@/trpc/client'

type ExportScope = 'WORKSPACE' | 'COLLECTION' | 'SUBTREE'
type ExportFormat = 'MARKDOWN_ZIP' | 'HTML_ZIP'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  preset?: { pageId: string; pageTitle: string } | null
}

const SCOPE_OPTIONS: { value: ExportScope; label: string }[] = [
  { value: 'WORKSPACE', label: 'Всё пространство' },
  { value: 'COLLECTION', label: 'Раздел' },
  { value: 'SUBTREE', label: 'Поддерево' },
]

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'MARKDOWN_ZIP', label: 'Markdown' },
  { value: 'HTML_ZIP', label: 'HTML' },
]

export function BulkExportDialog({ open, onClose, workspaceId, preset = null }: Props) {
  const utils = trpc.useUtils()

  const [scope, setScope] = useState<ExportScope>('WORKSPACE')
  const [collectionId, setCollectionId] = useState('')
  const [pageSelection, setPageSelection] = useState<PageTreeSelection | null>(null)
  const [format, setFormat] = useState<ExportFormat>('MARKDOWN_ZIP')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const effectiveScope: ExportScope = preset ? 'SUBTREE' : scope

  const collectionsQ = trpc.collection.list.useQuery(
    { workspaceId },
    { enabled: open && !preset && scope === 'COLLECTION' },
  )
  const pagesQ = trpc.page.listByWorkspace.useQuery(
    { workspaceId },
    { enabled: open && !preset && scope === 'SUBTREE' },
  )

  const createJob = trpc.job.export.create.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  const handleClose = () => {
    setScope('WORKSPACE')
    setCollectionId('')
    setPageSelection(null)
    setFormat('MARKDOWN_ZIP')
    setError(null)
    setDone(false)
    onClose()
  }

  const handleSubmit = async () => {
    setError(null)
    let scopeId: string | null = null
    if (effectiveScope === 'COLLECTION') scopeId = collectionId || null
    if (effectiveScope === 'SUBTREE') {
      scopeId = preset
        ? preset.pageId
        : pageSelection && pageSelection !== PAGE_TREE_ROOT
          ? pageSelection
          : null
    }
    if (effectiveScope !== 'WORKSPACE' && !scopeId) {
      setError('Выберите объект экспорта')
      return
    }
    try {
      await createJob.mutateAsync({ workspaceId, scope: effectiveScope, scopeId, format })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить экспорт')
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      data-testid="bulk-export-dialog"
    >
      <DialogTitle>Экспорт</DialogTitle>
      <DialogContent>
        {done ? (
          <Alert severity="success">
            Экспорт запущен. Скачать архив можно в «Настройки → Импорт и экспорт», когда задание
            завершится. Архив хранится 7 дней.
          </Alert>
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {preset ? (
              <Typography variant="body2">
                Страница «{preset.pageTitle || 'Без названия'}» со всеми подстраницами.
              </Typography>
            ) : (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Что экспортировать
                </Typography>
                <Stack direction="row" spacing={1}>
                  {SCOPE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      size="small"
                      variant={scope === opt.value ? 'contained' : 'outlined'}
                      onClick={() => setScope(opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </Stack>
              </Box>
            )}

            {!preset && scope === 'COLLECTION' ? (
              <Select
                size="small"
                displayEmpty
                fullWidth
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
              >
                <MenuItem value="" disabled>
                  Выберите раздел
                </MenuItem>
                {(collectionsQ.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.title || (c.kind === 'TEAM' ? 'Команда' : 'Личное')}
                  </MenuItem>
                ))}
              </Select>
            ) : null}

            {!preset && scope === 'SUBTREE' ? (
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: 200,
                  overflowY: 'auto',
                  p: 0.5,
                }}
              >
                <PageTreePicker
                  pages={pagesQ.data ?? []}
                  onSelect={setPageSelection}
                  selectedId={pageSelection}
                  showRoot={false}
                />
              </Box>
            ) : null}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Формат
              </Typography>
              <Stack direction="row" spacing={1}>
                {FORMAT_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    size="small"
                    variant={format === opt.value ? 'contained' : 'outlined'}
                    onClick={() => setFormat(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </Stack>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={handleClose}>
          {done ? 'Закрыть' : 'Отмена'}
        </Button>
        {!done ? (
          <Button
            variant="contained"
            data-testid="export-submit"
            disabled={createJob.isPending}
            onClick={() => void handleSubmit()}
          >
            Экспортировать
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
