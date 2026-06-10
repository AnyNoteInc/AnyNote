'use client'

import { useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
  UploadFileIcon,
} from '@repo/ui/components'

import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  type PageTreeSelection,
} from '@/components/workspace/page-tree-picker'
import { trpc } from '@/trpc/client'

import { detectImportFormat, uploadMimeFor } from './import-format'
import { SOURCE_CARDS, type SourceCard } from './import-sources'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
}

type ImportLocation = 'team' | 'private'

function SourceCardContent({ card }: { card: SourceCard }) {
  return (
    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">{card.label}</Typography>
        {card.badge ? <Chip label={card.badge} size="small" /> : null}
      </Stack>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {card.description}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {card.limitations}
      </Typography>
    </CardContent>
  )
}

export function ImportWizardDialog({ open, onClose, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [source, setSource] = useState<SourceCard | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [location, setLocation] = useState<ImportLocation>('team')
  const [selection, setSelection] = useState<PageTreeSelection | null>(PAGE_TREE_ROOT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const pagesQ = trpc.page.listByWorkspace.useQuery({ workspaceId }, { enabled: open })

  const createJob = trpc.job.import.create.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  const format = file ? detectImportFormat(file.name) : null
  const requiresZip = source?.key === 'NOTION' || source?.key === 'CONFLUENCE'
  const zipMismatch = requiresZip && format !== null && format !== 'ZIP'

  const handleBack = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFile(null)
    setError(null)
    setSource(null)
  }

  const handleClose = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setSource(null)
    setFile(null)
    setLocation('team')
    setSelection(PAGE_TREE_ROOT)
    setBusy(false)
    setError(null)
    setDone(false)
    onClose()
  }

  const handleSubmit = async () => {
    if (!source || !file || !format || zipMismatch) return
    setBusy(true)
    setError(null)
    try {
      // Re-wrap to force a MIME type the upload allowlist accepts: browsers
      // report '' for .md and platform-specific types for .zip, and text/html
      // is deliberately rejected by the allowlist.
      // If job creation fails after a successful upload, the uploaded file simply
      // remains in the workspace library («Библиотека» in settings) where the user
      // can see and delete it; a retry reuses it via content-hash dedup. No cleanup.
      const safeFile = new File([file], file.name, { type: uploadMimeFor(format) })
      const form = new FormData()
      form.append('file', safeFile)
      const res = await fetch('/api/files/upload?kind=attachment', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (!res.ok) {
        setError(`Не удалось загрузить файл (${res.status})`)
        return
      }
      const data = (await res.json()) as { file: { id: string } }
      // Disabled cards (ASANA/MONDAY) have no action area so they can never be
      // selected; the GENERIC fallback only narrows the type for the router enum.
      await createJob.mutateAsync({
        workspaceId,
        fileId: data.file.id,
        format,
        source: source.key === 'ASANA' || source.key === 'MONDAY' ? 'GENERIC' : source.key,
        location,
        parentId: selection === PAGE_TREE_ROOT || selection === null ? null : selection,
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить импорт')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      data-testid="import-wizard"
    >
      <DialogTitle>Импорт</DialogTitle>
      <DialogContent>
        {done ? (
          <Alert severity="success">
            Импорт запущен. Прогресс виден в списке заданий, страницы появятся в дереве по мере
            создания.
          </Alert>
        ) : source === null ? (
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="subtitle2">Откуда импортируете?</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1,
              }}
            >
              {SOURCE_CARDS.map((card) =>
                card.enabled ? (
                  <Card key={card.key} variant="outlined">
                    <CardActionArea
                      onClick={() => setSource(card)}
                      data-testid={`import-source-${card.key.toLowerCase()}`}
                      sx={{ height: '100%' }}
                    >
                      <SourceCardContent card={card} />
                    </CardActionArea>
                  </Card>
                ) : (
                  <Card key={card.key} variant="outlined" sx={{ opacity: 0.6 }}>
                    <SourceCardContent card={card} />
                  </Card>
                ),
              )}
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2">Источник: {source.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {source.limitations}
                </Typography>
              </Box>
              <Button variant="text" size="small" onClick={handleBack} data-testid="import-back">
                Назад
              </Button>
            </Box>

            <input
              ref={fileInputRef}
              type="file"
              accept={source.accept}
              data-testid="import-file-input"
              style={{ display: 'none' }}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <Box>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<UploadFileIcon />}
                onClick={() => fileInputRef.current?.click()}
                data-testid="import-pick-file"
              >
                {file
                  ? file.name
                  : requiresZip
                    ? 'Выбрать файл (.zip)'
                    : 'Выбрать файл (.md, .html, .zip)'}
              </Button>
              {file && !format ? (
                <Typography variant="caption" color="error">
                  Поддерживаются только .md, .html и .zip
                </Typography>
              ) : null}
              {zipMismatch ? (
                <Typography variant="caption" color="error">
                  Для этого источника нужен ZIP-архив
                </Typography>
              ) : null}
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Куда импортировать
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant={location === 'team' ? 'contained' : 'outlined'}
                  onClick={() => setLocation('team')}
                >
                  Команда
                </Button>
                <Button
                  size="small"
                  variant={location === 'private' ? 'contained' : 'outlined'}
                  onClick={() => setLocation('private')}
                >
                  Личное
                </Button>
              </Stack>
            </Box>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Родительская страница (необязательно)
              </Typography>
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
                  onSelect={setSelection}
                  selectedId={selection}
                  showRoot
                  rootLabel="Без родителя (корень)"
                />
              </Box>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={handleClose}>
          {done ? 'Закрыть' : 'Отмена'}
        </Button>
        {!done && source !== null ? (
          <Button
            variant="contained"
            data-testid="import-submit"
            disabled={!file || !format || zipMismatch || busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={() => void handleSubmit()}
          >
            Импортировать
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
