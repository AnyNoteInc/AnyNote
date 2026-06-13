'use client'

import { Alert, Box, Button, CircularProgress, Popover, Stack, Typography } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { useCallback, useId, useRef, useState } from 'react'

import { MEDIA_ACCEPT, inferMediaKind } from '../extensions/media-mime'
import type { SlashRange, UploadHandler, VirtualAnchor } from '../types'

// `file`  → insert each upload as a `fileAttachment` (the default popover).
// `media` → insert each upload as a `video`/`audio` node by its MIME family
//           (the /video and /audio slash items reuse this popover).
type UploadTarget = 'file' | 'media'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  uploadHandler: UploadHandler
  onClose: () => void
  target?: UploadTarget
  // Narrows the file picker `accept` (e.g. 'video/*' for the /video item).
  // Defaults to all media when `target` is 'media'.
  accept?: string
}

const getExtension = (name: string): string => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m?.[1] ?? ''
}

export function FileUploadPopover({
  open,
  anchorEl,
  range,
  editor,
  uploadHandler,
  onClose,
  target = 'file',
  accept,
}: Props) {
  const acceptAttr = accept ?? (target === 'media' ? MEDIA_ACCEPT : undefined)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputId = useId()

  const reset = useCallback(() => {
    setBusy(false)
    setProgress(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleClose = useCallback(() => {
    if (busy) return
    reset()
    onClose()
  }, [busy, onClose, reset])

  const handleFilesSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (files.length === 0 || !range) return
      setBusy(true)
      setError(null)
      setProgress({ done: 0, total: files.length })

      try {
        let done = 0
        const uploaded = await Promise.all(
          files.map(async (file) => {
            const result = await uploadHandler({ blob: file, filename: file.name })
            done += 1
            setProgress({ done, total: files.length })
            return {
              url: result.src,
              name: file.name,
              size: file.size,
              mimeType: file.type || 'application/octet-stream',
              ext: getExtension(file.name),
            }
          }),
        )

        const content = uploaded.map((u) => {
          if (target === 'media') {
            const kind = inferMediaKind(u.mimeType)
            // Fall back to a plain attachment when the picked file isn't media.
            if (kind === 'video' || kind === 'audio') {
              return {
                type: kind,
                attrs: { url: u.url, name: u.name, size: u.size, mimeType: u.mimeType },
              }
            }
          }
          return { type: 'fileAttachment', attrs: u }
        })

        editor.chain().focus().deleteRange(range).insertContent(content).run()
        reset()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить файл')
        setBusy(false)
      }
    },
    [editor, onClose, range, reset, target, uploadHandler],
  )

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 360 } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Button
            variant="contained"
            component="label"
            htmlFor={fileInputId}
            disabled={busy}
            fullWidth
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {busy
              ? progress
                ? `Загрузка ${progress.done} из ${progress.total}...`
                : 'Загрузка...'
              : 'Выбрать файлы'}
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              accept={acceptAttr}
              onChange={handleFilesSelected}
            />
          </Button>
          <Typography variant="caption" color="text.secondary">
            {target === 'media'
              ? 'Видео и аудио до 200 МБ. Загрузка начнётся сразу.'
              : 'Можно выбрать несколько файлов. Загрузка начнётся сразу.'}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </Box>
    </Popover>
  )
}
