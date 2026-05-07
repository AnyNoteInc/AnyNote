'use client'

import { useState } from 'react'

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from '@repo/ui/components'

type Props = {
  open: boolean
  onClose: () => void
  pageId: string
  workspaceId: string
}

type Format = 'pdf' | 'html' | 'md'

const FORMAT_LABEL: Record<Format, string> = {
  pdf: 'PDF',
  html: 'HTML',
  md: 'Markdown',
}

function buildExportUrl(workspaceId: string, pageId: string, format: Format) {
  return `/api/workspaces/${workspaceId}/pages/${pageId}/export/${format}`
}

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      // fall through
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  return plain?.[1] ?? null
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function PageExportDialog({ open, onClose, pageId, workspaceId }: Props) {
  const [pending, setPending] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function downloadAs(format: Format) {
    setPending(format)
    setError(null)
    try {
      const res = await fetch(buildExportUrl(workspaceId, pageId, format), {
        credentials: 'same-origin',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const filename =
        parseFilenameFromContentDisposition(res.headers.get('content-disposition')) ??
        `page.${format}`
      triggerBlobDownload(blob, filename)
      onClose()
    } catch {
      setError(`Не удалось скачать ${FORMAT_LABEL[format]}. Попробуйте ещё раз.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog open={open} onClose={pending ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Экспортировать страницу</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>Выберите формат:</DialogContentText>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1.5}>
          {(['pdf', 'md', 'html'] as const).map((fmt) => (
            <Button
              key={fmt}
              variant="contained"
              onClick={() => downloadAs(fmt)}
              disabled={pending !== null}
              startIcon={pending === fmt ? <CircularProgress size={16} color="inherit" /> : null}
            >
              {FORMAT_LABEL[fmt]}
            </Button>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending !== null}>
          Отмена
        </Button>
      </DialogActions>
    </Dialog>
  )
}
