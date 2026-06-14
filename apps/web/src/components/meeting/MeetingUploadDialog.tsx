'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  UploadFileIcon,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
}

const CONSENT_URL = '/terms/consent'
const CUSTOM = '__custom__'
const AUTO = '__auto__'

/**
 * Upload a recording → a MEETING page. Clones the import-wizard mold: a hidden
 * file input (audio/video), a REQUIRED consent checkbox (the consents-form
 * linked-copy pattern; the server ALSO requires consentAck, this is the
 * client-side mirror), and a summary-instruction selector («Авто» / a workspace
 * SummaryInstruction / «Своя инструкция» free-text). Confirm (disabled until a
 * file is picked AND consent is given) uploads via `/api/files/upload?kind=media`
 * then `meeting.create`, and navigates to the new page. Surfaces the plan (403)
 * and quota (413) errors cleanly.
 */
export function MeetingUploadDialog({ open, onClose, workspaceId }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [consent, setConsent] = useState(false)
  const [instructionChoice, setInstructionChoice] = useState<string>(AUTO)
  const [customInstruction, setCustomInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const instructionsQ = trpc.meeting.listSummaryInstructions.useQuery(
    { workspaceId },
    { enabled: open },
  )
  const create = trpc.meeting.create.useMutation()

  const reset = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFile(null)
    setTitle('')
    setConsent(false)
    setInstructionChoice(AUTO)
    setCustomInstruction('')
    setBusy(false)
    setError(null)
  }

  const handleClose = () => {
    if (busy) return
    reset()
    onClose()
  }

  const isCustom = instructionChoice === CUSTOM
  const canSubmit = !!file && consent && !busy && (!isCustom || customInstruction.trim().length > 0)

  const handleSubmit = async () => {
    if (!file || !consent) return
    setBusy(true)
    setError(null)
    try {
      // 1) Upload the recording to the quota-counted `media` kind (sniffed).
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/files/upload?kind=media', {
        method: 'POST',
        body: form,
        credentials: 'include',
      })
      if (!res.ok) {
        if (res.status === 413) {
          setError('Превышена квота хранилища для записей на вашем тарифе.')
        } else {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          setError(body?.error ?? `Не удалось загрузить запись (${res.status})`)
        }
        return
      }
      const data = (await res.json()) as { file: { id: string } }

      // 2) Create the MEETING page + artifact (consent-gated, plan-gated server-side).
      const trimmedTitle = title.trim()
      const result = await create.mutateAsync({
        workspaceId,
        recordingFileId: data.file.id,
        consentAck: true,
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...(instructionChoice !== AUTO && instructionChoice !== CUSTOM
          ? { summaryInstructionId: instructionChoice }
          : {}),
        ...(isCustom && customInstruction.trim()
          ? { customInstruction: customInstruction.trim() }
          : {}),
      })

      reset()
      onClose()
      router.push(`/pages/${result.pageId}`)
    } catch (e) {
      // The plan gate surfaces as a FORBIDDEN TRPCError; show its message.
      const code =
        e && typeof e === 'object' && 'data' in e
          ? (e as { data?: { code?: string } }).data?.code
          : undefined
      if (code === 'FORBIDDEN') {
        setError('Транскрипция встреч недоступна на вашем тарифе.')
      } else {
        setError(e instanceof Error ? e.message : 'Не удалось создать встречу.')
      }
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
      data-testid="meeting-upload-dialog"
    >
      <DialogTitle>Загрузить встречу</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Загрузите аудио- или видеозапись встречи — она будет расшифрована, а затем по ней будут
            подготовлены резюме и список задач с помощью AI-провайдера вашего рабочего пространства.
          </Typography>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            data-testid="meeting-file-input"
            style={{ display: 'none' }}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError(null)
            }}
          />
          <Button
            variant="outlined"
            fullWidth
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            data-testid="meeting-pick-file"
          >
            {file ? file.name : 'Выбрать запись (аудио или видео)'}
          </Button>

          <TextField
            size="small"
            fullWidth
            label="Название (необязательно)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'meeting-title' } }}
          />

          <FormControl size="small" fullWidth>
            <InputLabel id="meeting-instruction-label">Инструкция для резюме</InputLabel>
            <Select
              labelId="meeting-instruction-label"
              label="Инструкция для резюме"
              value={instructionChoice}
              data-testid="meeting-instruction-select"
              onChange={(e) => setInstructionChoice(e.target.value)}
            >
              <MenuItem value={AUTO}>Авто</MenuItem>
              {(instructionsQ.data?.instructions ?? []).map((ins) => (
                <MenuItem key={ins.id} value={ins.id}>
                  {ins.name}
                </MenuItem>
              ))}
              <MenuItem value={CUSTOM}>Своя инструкция…</MenuItem>
            </Select>
          </FormControl>

          {isCustom ? (
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              label="Своя инструкция"
              placeholder="Например: выдели решения и ответственных по каждому пункту."
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              slotProps={{
                htmlInput: { maxLength: 4000, 'data-testid': 'meeting-custom-instruction' },
              }}
            />
          ) : null}

          <FormControlLabel
            sx={{ alignItems: 'flex-start', m: 0 }}
            control={
              <Checkbox
                size="small"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                data-testid="meeting-consent-checkbox"
              />
            }
            label={
              <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
                Я подтверждаю, что запись будет загружена и расшифрована, и что согласие участников
                встречи на запись и обработку получено в соответствии с{' '}
                <Box
                  component="a"
                  href={CONSENT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ color: 'primary.main' }}
                >
                  условиями обработки данных
                </Box>
                .
              </Typography>
            }
          />

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={handleClose} disabled={busy}>
          Отмена
        </Button>
        <Button
          variant="contained"
          data-testid="meeting-upload-submit"
          disabled={!canSubmit}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => void handleSubmit()}
        >
          Создать
        </Button>
      </DialogActions>
    </Dialog>
  )
}
