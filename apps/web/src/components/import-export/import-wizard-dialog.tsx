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
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  UploadFileIcon,
} from '@repo/ui/components'

import {
  PAGE_TREE_ROOT,
  PageTreePicker,
  type PageTreeSelection,
} from '@/components/workspace/page-tree-picker'
// Pure, dependency-light modules (RFC-4180 parser + column inference) — safe to
// bundle client-side; the server re-parses the full file authoritatively.
import { parseCsv } from '@/server/page-import/csv'
import { inferColumns, type InferredType } from '@/server/page-import/infer-columns'
import { trpc } from '@/trpc/client'

import { detectImportFormat, uploadMimeFor } from './import-format'
import { SOURCE_CARDS, type SourceCard } from './import-sources'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
}

type ImportLocation = 'team' | 'private'

type ColumnPick = InferredType | 'skip'

type CsvPreview = {
  header: string[]
  /** Up to 10 sample data rows for the preview table. */
  rows: string[][]
  /** Inferred default type per FULL header index (index 0 = the title column). */
  defaults: InferredType[]
}

/** Preview parses at most header + 200 data lines (the server parses the full file). */
const PREVIEW_LINES = 201
const PREVIEW_SAMPLE_ROWS = 10

const CSV_TYPE_OPTIONS: { value: ColumnPick; label: string }[] = [
  { value: 'TEXT', label: 'Текст' },
  { value: 'NUMBER', label: 'Число' },
  { value: 'CHECKBOX', label: 'Чекбокс' },
  { value: 'DATE', label: 'Дата' },
  { value: 'SELECT', label: 'Выбор' },
  { value: 'MULTI_SELECT', label: 'Мультивыбор' },
  { value: 'URL', label: 'URL' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Телефон' },
  { value: 'skip', label: 'Пропустить' },
]

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
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [overrides, setOverrides] = useState<Record<number, ColumnPick>>({})
  const [dbTitle, setDbTitle] = useState('')

  const pagesQ = trpc.page.listByWorkspace.useQuery({ workspaceId }, { enabled: open })

  const createJob = trpc.job.import.create.useMutation({
    onSuccess: () => utils.job.list.invalidate({ workspaceId }),
  })

  const format = file ? detectImportFormat(file.name) : null
  const requiresZip = source?.key === 'NOTION' || source?.key === 'CONFLUENCE'
  const zipMismatch = requiresZip && format !== null && format !== 'ZIP'

  const resetCsvState = () => {
    setPreview(null)
    setOverrides({})
    setDbTitle('')
  }

  // Client-side preview parse: only the first PREVIEW_LINES lines, sliced by
  // newline BEFORE parsing to keep big files cheap. Preview-only — the server
  // re-parses the full file authoritatively when the job runs.
  const loadCsvPreview = async (f: File) => {
    try {
      const text = await f.text()
      const head = text.split(/\r?\n/, PREVIEW_LINES).join('\n')
      const rows = parseCsv(head)
      const header = rows[0]
      if (!header || header.length === 0) return
      const dataRows = rows.slice(1)
      setPreview({
        header,
        rows: dataRows.slice(0, PREVIEW_SAMPLE_ROWS),
        // Per-column inference is independent, so running it on the full header
        // (title column included) keeps indices aligned with header positions.
        defaults: inferColumns(header, dataRows).map((c) => c.type),
      })
      setDbTitle(f.name.replace(/\.[^.]+$/, ''))
    } catch {
      // Malformed preview is non-fatal: the server-side parse reports the error.
      resetCsvState()
    }
  }

  const handleFilePick = (f: File | null) => {
    setFile(f)
    setError(null)
    resetCsvState()
    if (f && detectImportFormat(f.name) === 'CSV') void loadCsvPreview(f)
  }

  const handleBack = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFile(null)
    setError(null)
    setSource(null)
    resetCsvState()
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
    resetCsvState()
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
        // CSV-only knobs: type pins keyed by the FULL header index (as strings)
        // plus the database title; the processor shifts past the title column.
        ...(format === 'CSV'
          ? {
              ...(Object.keys(overrides).length > 0
                ? { columnOverrides: Object.fromEntries(Object.entries(overrides)) }
                : {}),
              ...(dbTitle.trim() ? { databaseTitle: dbTitle.trim() } : {}),
            }
          : {}),
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запустить импорт')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth data-testid="import-wizard">
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
              onChange={(e) => handleFilePick(e.target.files?.[0] ?? null)}
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
                    : source.key === 'GENERIC'
                      ? 'Выбрать файл (.md, .html, .csv, .zip)'
                      : 'Выбрать файл (.md, .html, .zip)'}
              </Button>
              {file && !format ? (
                <Typography variant="caption" color="error">
                  Поддерживаются только .md, .html, .csv и .zip
                </Typography>
              ) : null}
              {zipMismatch ? (
                <Typography variant="caption" color="error">
                  Для этого источника нужен ZIP-архив
                </Typography>
              ) : null}
            </Box>

            {format === 'CSV' && preview ? (
              <Stack spacing={1}>
                <Typography variant="subtitle2">База данных из CSV</Typography>
                <TextField
                  size="small"
                  fullWidth
                  label="Название базы"
                  value={dbTitle}
                  onChange={(e) => setDbTitle(e.target.value)}
                  slotProps={{ htmlInput: { 'data-testid': 'csv-db-title', maxLength: 200 } }}
                />
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    maxHeight: 240,
                    overflow: 'auto',
                  }}
                >
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {preview.header.map((name, idx) => (
                          <TableCell key={idx} sx={{ whiteSpace: 'nowrap' }}>
                            {name.trim() || `Колонка ${idx + 1}`}
                          </TableCell>
                        ))}
                      </TableRow>
                      <TableRow>
                        {preview.header.map((_, idx) =>
                          idx === 0 ? (
                            // The first CSV column is always the row title.
                            <TableCell key={idx}>
                              <Chip label="Название" size="small" />
                            </TableCell>
                          ) : (
                            <TableCell key={idx}>
                              <Select
                                size="small"
                                value={overrides[idx] ?? preview.defaults[idx] ?? 'TEXT'}
                                data-testid={`csv-col-type-${idx}`}
                                onChange={(e) =>
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [idx]: e.target.value as ColumnPick,
                                  }))
                                }
                              >
                                {CSV_TYPE_OPTIONS.map((opt) => (
                                  <MenuItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </MenuItem>
                                ))}
                              </Select>
                            </TableCell>
                          ),
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.rows.map((row, r) => (
                        <TableRow key={r}>
                          {preview.header.map((_, c) => (
                            <TableCell key={c}>
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{ display: 'block', maxWidth: 140 }}
                              >
                                {row[c] ?? ''}
                              </Typography>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Показаны первые строки; типы колонок определены автоматически — их можно изменить.
                </Typography>
              </Stack>
            ) : null}

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
