'use client'

import { Box, Divider, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import CachedIcon from '@mui/icons-material/Cached'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import VideocamOutlinedIcon from '@mui/icons-material/VideocamOutlined'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'

import { mediaToAttachmentNode, type MediaNodeAttrs } from './media-mime'
import { VideoSchema } from './video.schema'
import { normalizeLinkHref } from '../link-href'
import type { OpenFilePreview, UploadHandler } from '../types'

type Side = 'left' | 'right'

export type VideoOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}

function VideoView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
  extension,
  getPos,
}: NodeViewProps) {
  const url = (node.attrs.url as string) || ''
  // Sanitize before using as a media src / download href: a crafted Yjs update
  // (or convert path) could smuggle a javascript:/data: URL. `/api/files/<id>`
  // passes through unchanged; an unsafe scheme normalizes to '' → empty-state.
  const safeUrl = normalizeLinkHref(url)
  const name = (node.attrs.name as string) || ''
  const width = node.attrs.width as number | null
  const options = extension.options as VideoOptions
  const uploadHandler = options.uploadHandler

  const outerRef = useRef<HTMLDivElement | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [resizing, setResizing] = useState(false)

  const upload = useCallback(
    async (file: File) => {
      if (!uploadHandler) {
        setError('Загрузка файлов не настроена')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const result = await uploadHandler({ blob: file, filename: file.name })
        updateAttributes({ url: result.src, name: file.name, size: file.size, mimeType: file.type })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить видео')
      } finally {
        setBusy(false)
      }
    },
    [updateAttributes, uploadHandler],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only intercept OS file drops; let in-editor drags bubble to the
      // drop-placement plugin (same rule as ResizableImage).
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file && file.type.startsWith('video/')) upload(file)
    },
    [upload],
  )

  const handleResizeStart = useCallback(
    (side: Side) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!mediaRef.current || !outerRef.current) return
      const startX = event.clientX
      const startWidth = mediaRef.current.offsetWidth
      const getMaxWidth = () => outerRef.current?.clientWidth ?? 9999
      setResizing(true)
      let lastWidth = startWidth

      const onMove = (e: MouseEvent) => {
        const delta = side === 'right' ? e.clientX - startX : startX - e.clientX
        const next = Math.max(160, Math.min(getMaxWidth(), Math.round(startWidth + delta)))
        if (next === lastWidth) return
        lastWidth = next
        updateAttributes({ width: next })
      }
      const onUp = () => {
        setResizing(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [updateAttributes],
  )

  // ── Empty / placeholder state ───────────────────────────────────────────
  if (!safeUrl) {
    return (
      <NodeViewWrapper as="div" className="anynote-video" data-type="video" data-empty="true">
        <Box
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return
            e.preventDefault()
            e.stopPropagation()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            border: '2px dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            borderRadius: 2,
            px: 3,
            py: 4,
            my: 0.5,
            cursor: 'pointer',
            color: 'text.secondary',
            backgroundColor: dragOver ? 'action.hover' : 'transparent',
            transition: 'background-color .15s, border-color .15s',
            '&:hover': { borderColor: 'text.secondary' },
          }}
        >
          <VideocamOutlinedIcon sx={{ fontSize: 32, opacity: 0.7 }} />
          <Typography variant="body2">
            {busy ? 'Загрузка...' : 'Нажми, чтобы выбрать видео или перетащи'}
          </Typography>
          {error ? (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (fileInputRef.current) fileInputRef.current.value = ''
              if (file) upload(file)
            }}
          />
        </Box>
      </NodeViewWrapper>
    )
  }

  // ── Filled state ────────────────────────────────────────────────────────
  const handleStyle = (side: Side) => ({
    position: 'absolute' as const,
    top: '50%',
    [side]: -4,
    transform: 'translateY(-50%)',
    width: 8,
    height: 44,
    borderRadius: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    cursor: 'ew-resize' as const,
    opacity: resizing || selected ? 1 : 0,
    transition: 'opacity .15s',
    '.anynote-video-wrapper:hover &': { opacity: 1 },
  })

  const toolbarButton = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    danger = false,
  ) => (
    <Tooltip title={label} arrow>
      <IconButton
        size="small"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClick()
        }}
        sx={{ color: danger ? 'error.main' : 'text.secondary' }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  )

  const showAsFile = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const mediaAttrs: MediaNodeAttrs = {
      url,
      name,
      size: (node.attrs.size as number) || 0,
      mimeType: (node.attrs.mimeType as string) || '',
    }
    const swap = mediaToAttachmentNode(mediaAttrs)
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, swap)
      .run()
  }

  return (
    <NodeViewWrapper as="div" className="anynote-video" data-type="video">
      <Box
        ref={outerRef}
        sx={{ display: 'flex', justifyContent: 'center', width: '100%', userSelect: resizing ? 'none' : 'auto' }}
      >
        <Box
          className="anynote-video-wrapper"
          sx={{
            position: 'relative',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            maxWidth: '100%',
            my: 0.5,
            border: selected ? '2px solid' : '2px solid transparent',
            borderColor: selected ? 'primary.main' : 'transparent',
            borderRadius: 1,
          }}
        >
          {selected && editor.isEditable ? (
            <Paper
              elevation={6}
              sx={{
                position: 'absolute',
                top: -48,
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
                px: 0.5,
                py: 0.25,
                borderRadius: 1,
                whiteSpace: 'nowrap',
                zIndex: 2,
              }}
            >
              {toolbarButton('Показать как файл', <InsertDriveFileOutlinedIcon fontSize="small" />, showAsFile)}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
              <Tooltip title="Скачать" arrow>
                <IconButton
                  size="small"
                  component="a"
                  href={safeUrl}
                  download={name}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: 'text.secondary' }}
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {toolbarButton('Заменить', <CachedIcon fontSize="small" />, () =>
                updateAttributes({ url: '', name: '', size: 0, mimeType: '', width: null }),
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
              {toolbarButton('Удалить', <DeleteIcon fontSize="small" />, () => deleteNode(), true)}
            </Paper>
          ) : null}
          <Box sx={{ position: 'relative', lineHeight: 0 }}>
            <Box
              component="video"
              ref={mediaRef}
              src={safeUrl}
              controls
              preload="metadata"
              sx={{
                display: 'block',
                maxWidth: '100%',
                height: 'auto',
                width: width ? `${width}px` : '100%',
                borderRadius: 0.75,
                backgroundColor: 'black',
              }}
            />
            {editor.isEditable ? (
              <>
                <Box onMouseDown={handleResizeStart('left')} sx={handleStyle('left')} />
                <Box onMouseDown={handleResizeStart('right')} sx={handleStyle('right')} />
              </>
            ) : null}
          </Box>
        </Box>
      </Box>
    </NodeViewWrapper>
  )
}

export const Video = VideoSchema.extend<VideoOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView)
  },
})
