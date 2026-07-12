// apps/web/src/components/page/file-preview/viewers.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Box,
  Button,
  CircularProgress,
  DownloadIcon,
  InsertDriveFileOutlinedIcon,
  Typography,
} from '@repo/ui/components'

import { TEXT_PREVIEW_MAX_BYTES, extractApiFileId } from '@/lib/preview-kind'

import { ZoomPanViewport } from './zoom-pan-viewport'

const Center = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1.5,
      p: 3,
      textAlign: 'center',
    }}
  >
    {children}
  </Box>
)

export function DownloadPrompt({
  url,
  name,
  reason,
}: {
  url: string
  name: string | null
  reason: string
}) {
  return (
    <Center>
      <InsertDriveFileOutlinedIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      {name ? <Typography variant="body2">{name}</Typography> : null}
      <Typography variant="caption" color="text.secondary">
        {reason}
      </Typography>
      <Button
        component="a"
        href={url}
        download={name ?? ''}
        target="_blank"
        rel="noopener noreferrer"
        startIcon={<DownloadIcon />}
        size="small"
      >
        Скачать
      </Button>
    </Center>
  )
}

export function ImageViewer({ url, name }: { url: string; name: string | null }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const getNaturalScale = useCallback(() => {
    const img = imgRef.current
    if (!img || !img.naturalWidth || !img.clientWidth) return null
    return img.naturalWidth / img.clientWidth
  }, [])
  return (
    <ZoomPanViewport getNaturalScale={getNaturalScale}>
      <Box
        component="img"
        ref={imgRef}
        src={url}
        alt={name ?? ''}
        draggable={false}
        sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none' }}
      />
    </ZoomPanViewport>
  )
}

export type SvgSource = { kind: 'url'; value: string } | { kind: 'inline'; value: string }

/** SVG показываем ТОЛЬКО через <img> (скрипты внутри не выполняются) — серверный
 *  запрет inline-SVG (file-validation isInlineSafeMime) не трогаем. Разметка и
 *  файл заворачиваются в Blob-URL; data:-URI (drawio) идёт в src напрямую. */
export function SvgViewer({ source, name }: { source: SvgSource; name?: string | null }) {
  const [src, setSrc] = useState<string | null>(
    source.kind === 'inline' && source.value.startsWith('data:') ? source.value : null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const assign = (markup: string) => {
      objectUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
      if (!cancelled) setSrc(objectUrl)
    }
    if (source.kind === 'inline') {
      if (source.value.startsWith('data:')) setSrc(source.value)
      else assign(source.value)
    } else {
      setSrc(null)
      fetch(source.value, { credentials: 'include' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.text()
        })
        .then((text) => assign(text))
        .catch(() => {
          if (!cancelled) setError('Не удалось загрузить файл')
        })
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source.kind, source.value])

  if (error) {
    return (
      <Center>
        <Typography variant="body2" color="text.secondary">
          {error}
        </Typography>
      </Center>
    )
  }
  if (!src) {
    return (
      <Center>
        <CircularProgress size={24} />
      </Center>
    )
  }
  return <ImageViewer url={src} name={name ?? null} />
}

export function PdfViewer({ url, name }: { url: string; name: string | null }) {
  return (
    <Box
      component="iframe"
      src={url}
      title={name ?? 'PDF'}
      data-testid="file-preview-pdf-frame"
      sx={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
    />
  )
}

export function OfficeViewer({ url, name }: { url: string; name: string | null }) {
  const fileId = extractApiFileId(url)
  if (!fileId) {
    return <DownloadPrompt url={url} name={name} reason="Предпросмотр недоступен для этого файла" />
  }
  // Конвертация может занять секунды — iframe сам показывает результат/ошибку
  // роута; таймаут Gotenberg отдаёт текст с 504/502.
  return (
    <Box
      component="iframe"
      src={`/api/files/${fileId}/preview-pdf`}
      title={name ?? 'Документ'}
      data-testid="file-preview-office-frame"
      sx={{ border: 0, width: '100%', flex: 1, minHeight: 0 }}
    />
  )
}

export function MediaViewer({
  url,
  name,
  media,
}: {
  url: string
  name: string | null
  media: 'video' | 'audio'
}) {
  return (
    <Center>
      {media === 'video' ? (
        <Box
          component="video"
          src={url}
          controls
          preload="metadata"
          sx={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 1, backgroundColor: 'black' }}
        />
      ) : (
        <Box component="audio" src={url} controls preload="metadata" sx={{ width: '100%' }} />
      )}
      {name ? (
        <Typography variant="caption" color="text.secondary">
          {name}
        </Typography>
      ) : null}
    </Center>
  )
}

export function TextViewer({
  url,
  name,
  size,
}: {
  url: string
  name: string | null
  size: number | null
}) {
  const tooBig = size != null && size > TEXT_PREVIEW_MAX_BYTES
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tooBig) return
    let cancelled = false
    fetch(url, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((body) => {
        if (!cancelled) setText(body)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось загрузить файл')
      })
    return () => {
      cancelled = true
    }
  }, [url, tooBig])

  if (tooBig) {
    return (
      <DownloadPrompt url={url} name={name} reason="Файл больше 1 МБ — скачайте для просмотра" />
    )
  }
  if (error) {
    return <DownloadPrompt url={url} name={name} reason={error} />
  }
  if (text === null) {
    return (
      <Center>
        <CircularProgress size={24} />
      </Center>
    )
  }
  return (
    <Box
      component="pre"
      data-testid="file-preview-text"
      sx={{
        m: 0,
        p: 2,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: 13,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </Box>
  )
}
