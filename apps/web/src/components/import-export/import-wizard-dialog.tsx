'use client'

import { useRef, useState } from 'react'

import {
  Alert,
  Box,
  Button,
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

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
}

type ImportLocation = 'team' | 'private'

export function ImportWizardDialog({ open, onClose, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  const handleClose = () => {
    setFile(null)
    setLocation('team')
    setSelection(PAGE_TREE_ROOT)
    setBusy(false)
    setError(null)
    setDone(false)
    onClose()
  }

  const handleSubmit = async () => {
    if (!file || !format) return
    setBusy(true)
    setError(null)
    try {
      // Re-wrap to force a MIME type the upload allowlist accepts: browsers
      // report '' for .md and platform-specific types for .zip, and text/html
      // is deliberately rejected by the allowlist.
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
      await createJob.mutateAsync({
        workspaceId,
        fileId: data.file.id,
        format,
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
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.html,.htm,.zip"
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
                {file ? file.name : 'Выбрать файл (.md, .html, .zip)'}
              </Button>
              {file && !format ? (
                <Typography variant="caption" color="error">
                  Поддерживаются только .md, .html и .zip
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
        {!done ? (
          <Button
            variant="contained"
            data-testid="import-submit"
            disabled={!file || !format || busy}
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
