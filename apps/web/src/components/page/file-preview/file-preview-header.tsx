// apps/web/src/components/page/file-preview/file-preview-header.tsx
'use client'

import type { FilePreviewPayload } from '@repo/editor'
import {
  Box,
  CloseFullscreenIcon,
  CloseIcon,
  DownloadIcon,
  IconButton,
  OpenInFullIcon,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { useFilePreview } from './file-preview-context'

const downloadPayload = (payload: FilePreviewPayload) => {
  const a = document.createElement('a')
  let objectUrl: string | null = null
  if (payload.kind === 'file') {
    a.href = payload.url
    a.download = payload.name ?? ''
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
  } else if (payload.svg.startsWith('data:')) {
    a.href = payload.svg
    a.download = `${payload.title ?? 'diagram'}.svg`
  } else {
    objectUrl = URL.createObjectURL(new Blob([payload.svg], { type: 'image/svg+xml' }))
    a.href = objectUrl
    a.download = `${payload.title ?? 'diagram'}.svg`
  }
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
}

export function FilePreviewHeader({ payload }: { payload: FilePreviewPayload }) {
  const ctx = useFilePreview()
  if (!ctx) return null
  const title = payload.kind === 'file' ? (payload.name ?? 'Файл') : (payload.title ?? 'Диаграмма')
  const fullscreen = ctx.effectiveMode === 'full'

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </Typography>
      <Tooltip title="Скачать">
        <IconButton
          size="small"
          data-testid="file-preview-download"
          onClick={() => downloadPayload(payload)}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {ctx.isMobile ? null : fullscreen ? (
        <Tooltip title="Свернуть в панель">
          <IconButton
            size="small"
            data-testid="file-preview-collapse"
            onClick={() => ctx.setMode('split')}
          >
            <CloseFullscreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Tooltip title="На весь экран">
          <IconButton
            size="small"
            data-testid="file-preview-expand"
            onClick={() => ctx.setMode('full')}
          >
            <OpenInFullIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Закрыть">
        <IconButton size="small" data-testid="file-preview-close" onClick={ctx.close}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
