'use client'

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { Editor } from '@tiptap/core'
import { marked } from 'marked'
import { useCallback, useId, useRef, useState } from 'react'

import type { SlashRange } from '../types'

type Props = {
  open: boolean
  range: SlashRange | null
  editor: Editor
  onClose: () => void
}

// Keep markdown parsing predictable and synchronous.
const parseMarkdown = (source: string): string => {
  const out = marked.parse(source, { async: false, gfm: true })
  return typeof out === 'string' ? out : ''
}

export function MarkdownUploadPopover({ open, range, editor, onClose }: Props) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputId = useId()

  const reset = useCallback(() => {
    setBusy(false)
    setError(null)
    setRaw('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleClose = useCallback(() => {
    if (busy) return
    reset()
    onClose()
  }, [busy, onClose, reset])

  const insert = useCallback(
    (text: string) => {
      if (!range) return false
      if (!text.trim()) {
        setError('Пусто')
        return false
      }
      editor.chain().focus().deleteRange(range).insertContent(parseMarkdown(text)).run()
      reset()
      onClose()
      return true
    },
    [editor, onClose, range, reset],
  )

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (!file) return
      setBusy(true)
      setError(null)
      try {
        const text = await file.text()
        if (!insert(text)) setBusy(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось разобрать Markdown')
        setBusy(false)
      }
    },
    [insert],
  )

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Вставить содержимое</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        <Stack spacing={2}>
          <Stack spacing={1.5}>
            <Button
              variant="outlined"
              component="label"
              htmlFor={fileInputId}
              disabled={busy}
              fullWidth
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {busy ? 'Разбор...' : 'Выбрать файл'}
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
              Файл разбирается на клиенте и вставляется как текст.
            </Typography>
          </Stack>

          <Divider flexItem />

          <TextField
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="# Заголовок&#10;&#10;Текст в формате Markdown..."
            multiline
            minRows={6}
            maxRows={16}
            fullWidth
            disabled={busy}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Отмена
        </Button>
        <Button variant="contained" onClick={() => insert(raw)} disabled={busy}>
          Вставить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
