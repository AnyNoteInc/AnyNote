'use client'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormHelperText,
  FormLabel,
  Stack,
  Typography,
} from '@repo/ui/components'

export type FormUploadedFile = { token: string; name: string }
export type FormUploadHandler = (questionId: string, file: File) => Promise<FormUploadedFile>

function mimeTypeAllowed(mimeType: string, allowedMimeTypes: readonly string[]): boolean {
  if (allowedMimeTypes.length === 0) return true
  return allowedMimeTypes.some(
    (allowed) =>
      allowed === mimeType ||
      (allowed.endsWith('/*') && mimeType.startsWith(`${allowed.slice(0, -1)}`)),
  )
}

interface FormUploadFieldProps {
  readonly questionId: string
  readonly label: string
  readonly description?: string
  readonly required?: boolean
  readonly allowedMimeTypes: readonly string[]
  readonly maxBytesPerFile: number
  readonly maxFiles: number
  readonly value: readonly string[] | undefined
  readonly error?: string
  readonly disabled?: boolean
  readonly onChange: (value: string[]) => void
  readonly onUpload?: FormUploadHandler
  readonly onPendingChange?: (pending: boolean) => void
}

export const FormUploadField = forwardRef<HTMLInputElement, FormUploadFieldProps>(
  function FormUploadField(
    {
      questionId,
      label,
      description,
      required,
      allowedMimeTypes,
      maxBytesPerFile,
      maxFiles,
      value,
      error,
      disabled,
      onChange,
      onUpload,
      onPendingChange,
    },
    forwardedRef,
  ) {
    const tokens = useMemo(() => (Array.isArray(value) ? [...value] : []), [value])
    const [names, setNames] = useState<Record<string, string>>({})
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string>()
    const mountedRef = useRef(true)
    const pendingRef = useRef(false)
    const pendingChangeRef = useRef(onPendingChange)
    const helperId = `form-upload-${questionId}-helper`

    useEffect(() => {
      pendingChangeRef.current = onPendingChange
    }, [onPendingChange])

    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        if (pendingRef.current) {
          pendingRef.current = false
          pendingChangeRef.current?.(false)
        }
      }
    }, [])

    function setPending(pending: boolean) {
      pendingRef.current = pending
      setUploading(pending)
      pendingChangeRef.current?.(pending)
    }

    async function upload(file: File) {
      if (!onUpload) return
      if (file.size > maxBytesPerFile) {
        setUploadError('Файл превышает допустимый размер')
        return
      }
      if (!mimeTypeAllowed(file.type, allowedMimeTypes)) {
        setUploadError('Этот тип файла не разрешён')
        return
      }
      if (tokens.length >= maxFiles) {
        setUploadError('Достигнуто максимальное количество файлов')
        return
      }
      setPending(true)
      setUploadError(undefined)
      try {
        const uploaded = await onUpload(questionId, file)
        if (!mountedRef.current) return
        setNames((current) => ({ ...current, [uploaded.token]: uploaded.name }))
        onChange([...tokens, uploaded.token])
      } catch {
        if (mountedRef.current) setUploadError('Не удалось загрузить файл')
      } finally {
        if (mountedRef.current) setPending(false)
      }
    }

    return (
      <FormControl error={Boolean(error)} disabled={disabled} fullWidth>
        <FormLabel sx={{ mb: 0.75, fontWeight: 650 }}>
          {label}
          {required ? ' *' : ''}
        </FormLabel>
        {tokens.length > 0 ? (
          <Stack spacing={0.75} sx={{ mb: 1 }}>
            {tokens.map((token, index) => (
              <Box
                key={token}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  px: 1.25,
                  py: 0.75,
                }}
              >
                <Typography variant="body2" noWrap>
                  {names[token] ?? `Файл ${index + 1}`}
                </Typography>
                <Button
                  type="button"
                  size="small"
                  disabled={disabled || uploading}
                  onClick={() => onChange(tokens.filter((item) => item !== token))}
                >
                  Удалить
                </Button>
              </Box>
            ))}
          </Stack>
        ) : null}
        <Button
          component="label"
          variant="outlined"
          aria-label={uploading ? 'Загрузка…' : `Добавить файл: ${label}`}
          disabled={disabled || uploading || !onUpload || tokens.length >= maxFiles}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {uploading ? <CircularProgress size={18} sx={{ mr: 1 }} /> : null}
          {uploading ? 'Загрузка…' : 'Добавить файл'}
          <Box
            component="input"
            ref={forwardedRef}
            type="file"
            accept={allowedMimeTypes.join(',') || undefined}
            aria-label={`Загрузить: ${label}`}
            aria-describedby={description || error || uploadError ? helperId : undefined}
            disabled={disabled || uploading || !onUpload || tokens.length >= maxFiles}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void upload(file)
            }}
            sx={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              clipPath: 'inset(50%)',
            }}
          />
        </Button>
        {!onUpload ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
            Загрузка доступна только в опубликованной форме
          </Typography>
        ) : null}
        {error || uploadError || description ? (
          <FormHelperText id={helperId}>{error ?? uploadError ?? description}</FormHelperText>
        ) : null}
      </FormControl>
    )
  },
)
