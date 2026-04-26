'use client'

import { Alert, Box, Button, CircularProgress, Popover, Stack, Typography } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { marked } from 'marked'
import { useCallback, useId, useRef, useState } from 'react'

import type { SlashRange, VirtualAnchor } from '../types'

type Props = {
  open: boolean
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

// Keep markdown parsing predictable and synchronous — server-side async
// features (highlight.js, etc.) aren't needed here, and async output would
// force us to thread promises through the insert flow.
const parseMarkdown = (source: string): string => {
  const out = marked.parse(source, { async: false, gfm: true })
  return typeof out === 'string' ? out : ''
}

export function MarkdownUploadPopover({ open, anchorEl, range, editor, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputId = useId()

  const reset = useCallback(() => {
    setBusy(false)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleClose = useCallback(() => {
    if (busy) return
    reset()
    onClose()
  }, [busy, onClose, reset])

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (!file || !range) return
      setBusy(true)
      setError(null)
      try {
        const text = await file.text()
        if (!text.trim()) {
          setError('Файл пуст')
          setBusy(false)
          return
        }
        const html = parseMarkdown(text)
        editor.chain().focus().deleteRange(range).insertContent(html).run()
        reset()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось разобрать Markdown')
        setBusy(false)
      }
    },
    [editor, onClose, range, reset],
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
            {busy ? 'Разбор...' : 'Выбрать .md файл'}
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              hidden
              accept=".md,.markdown,text/markdown"
              onChange={handleFileSelected}
            />
          </Button>
          <Typography variant="caption" color="text.secondary">
            Файл разбирается на клиенте и вставляется как текст. На сервер ничего не отправляется.
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </Box>
    </Popover>
  )
}
