'use client'

import { Alert, Box, Button, Popover, Stack, TextField, Typography } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { useCallback, useEffect, useState } from 'react'

import { resolveEmbed } from '../embed-providers'
import { normalizeLinkHref } from '../link-href'
import type { BookmarkPreview, PreviewFetch } from '../extensions/url-paste'
import type { SlashRange, VirtualAnchor } from '../types'

// `bookmark` → insert a `bookmark` node (any safe https URL), then async-fill via
//              previewFetch (tolerated absent).
// `embed`    → insert an `embed` node, but ONLY when the URL is on the provider
//              allowlist; otherwise show an honest rejection note.
type Mode = 'bookmark' | 'embed'

type Props = {
  open: boolean
  mode: Mode
  anchorEl: VirtualAnchor | null
  range: SlashRange | null
  editor: Editor
  onClose: () => void
  previewFetch?: PreviewFetch
}

export function EmbedUrlPopover({
  open,
  mode,
  anchorEl,
  range,
  editor,
  onClose,
  previewFetch,
}: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValue('')
      setError(null)
    }
  }, [open])

  const submit = useCallback(() => {
    if (!range) return
    const url = normalizeLinkHref(value)
    if (!url || !/^https?:\/\//i.test(url)) {
      setError('Введите корректную ссылку (http/https)')
      return
    }

    if (mode === 'embed') {
      const resolved = resolveEmbed(url)
      if (!resolved) {
        // Honest rejection: this provider isn't on the allowlist.
        setError(
          'Эту ссылку нельзя встроить. Поддерживаются YouTube, Vimeo, RuTube и другие из списка разрешённых. Попробуйте «Закладку».',
        )
        return
      }
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'embed',
          attrs: { url, provider: resolved.provider, embedUrl: resolved.embedUrl },
        })
        .run()
      onClose()
      return
    }

    // bookmark
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .insertContent({
        type: 'bookmark',
        attrs: { url, title: '', description: '', image: '', favicon: '' },
      })
      .run()
    onClose()

    // Best-effort async preview fill (tolerate an absent fetch — Task 4 wires it).
    if (previewFetch) {
      void previewFetch(url)
        .then((preview: BookmarkPreview) => {
          if (!preview) return
          let pos: number | null = null
          editor.state.doc.descendants((n, p) => {
            if (pos != null) return false
            if (n.type.name === 'bookmark' && n.attrs.url === url && !n.attrs.title) {
              pos = p
              return false
            }
            return undefined
          })
          if (pos == null) return
          editor.view.dispatch(
            editor.view.state.tr.setNodeMarkup(pos, undefined, {
              url,
              title: preview.title ?? '',
              description: preview.description ?? '',
              image: preview.image ?? '',
              favicon: preview.favicon ?? '',
            }),
          )
        })
        .catch(() => undefined)
    }
  }, [editor, mode, onClose, previewFetch, range, value])

  return (
    <Popover
      open={open}
      anchorEl={anchorEl as Element | null}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 380 } } }}
    >
      <Box sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2">
            {mode === 'embed' ? 'Встроить по ссылке' : 'Закладка по ссылке'}
          </Typography>
          <TextField
            autoFocus
            size="small"
            fullWidth
            placeholder="https://..."
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
          {error ? <Alert severity="warning">{error}</Alert> : null}
          <Button variant="contained" fullWidth onClick={submit}>
            {mode === 'embed' ? 'Встроить' : 'Добавить закладку'}
          </Button>
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
            }}
          >
            {mode === 'embed'
              ? 'YouTube, Vimeo, RuTube, VK, Dailymotion, Loom, Figma, CodePen, SoundCloud, Google Maps.'
              : 'Любая https-ссылка. Превью подтянется автоматически.'}
          </Typography>
        </Stack>
      </Box>
    </Popover>
  )
}
