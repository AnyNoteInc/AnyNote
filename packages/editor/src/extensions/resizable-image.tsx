'use client'

import { Box, Divider, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material'
import AlignHorizontalCenterIcon from '@mui/icons-material/AlignHorizontalCenter'
import AlignHorizontalLeftIcon from '@mui/icons-material/AlignHorizontalLeft'
import AlignHorizontalRightIcon from '@mui/icons-material/AlignHorizontalRight'
import CachedIcon from '@mui/icons-material/Cached'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import SubtitlesIcon from '@mui/icons-material/Subtitles'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'

import { imagePreviewPayload, shouldOpenImagePreview } from './file-preview-interaction'
import { pinViewportPosition } from '../lib/pin-viewport'
import type { OpenFilePreview, UploadHandler } from '../types'

type Align = 'left' | 'center' | 'right'
type Side = 'left' | 'right'

export type ResizableImageOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}

const ALIGN_FLEX: Record<Align, 'flex-start' | 'center' | 'flex-end'> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
}

function ResizableImageView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
  extension,
}: NodeViewProps) {
  const src = (node.attrs.src as string | null) ?? null
  const alt = (node.attrs.alt as string | null) ?? undefined
  const title = (node.attrs.title as string | null) ?? undefined
  const width = node.attrs.width as number | null
  const align = ((node.attrs.align as Align) ?? 'center') as Align
  const caption = node.attrs.caption as string | null
  const captionShown = caption !== null
  const options = extension.options as ResizableImageOptions
  const uploadHandler = options.uploadHandler
  const onOpenFilePreview = options.onOpenFilePreview

  const outerRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  const openPreview = useCallback(() => {
    if (!onOpenFilePreview) return
    const payload = imagePreviewPayload({
      src,
      name: (node.attrs.name as string | null) ?? null,
      size: (node.attrs.size as number | null) ?? null,
      mimeType: (node.attrs.mimeType as string | null) ?? null,
    })
    if (!payload) return
    // Сплит-панель сужает колонку — держим изображение на месте во вьюпорте.
    if (outerRef.current) pinViewportPosition(outerRef.current)
    onOpenFilePreview(payload)
  }, [onOpenFilePreview, src, node.attrs.name, node.attrs.size, node.attrs.mimeType])
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
        // Metadata feeds the «Сохранить как файл» swap (image → fileAttachment).
        updateAttributes({
          src: result.src,
          name: file.name || null,
          size: file.size || null,
          mimeType: file.type || null,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить изображение')
      } finally {
        setBusy(false)
      }
    },
    [updateAttributes, uploadHandler],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only intercept OS file drops; let in-editor drags bubble to the
      // editor's drop-placement plugin so an empty placeholder can be wrapped
      // into a column layout like any other block.
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file && file.type.startsWith('image/')) upload(file)
    },
    [upload],
  )

  const handleResizeStart = useCallback(
    (side: Side) => (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!imgRef.current || !outerRef.current) return
      const startX = event.clientX
      const startWidth = imgRef.current.offsetWidth
      const getMaxWidth = () => outerRef.current?.clientWidth ?? 9999
      setResizing(true)
      let lastWidth = startWidth

      const onMove = (e: MouseEvent) => {
        const delta = side === 'right' ? e.clientX - startX : startX - e.clientX
        const next = Math.max(80, Math.min(getMaxWidth(), Math.round(startWidth + delta)))
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
  if (!src) {
    return (
      <NodeViewWrapper as="div" className="anynote-image" data-type="image" data-empty="true">
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
          <ImageOutlinedIcon sx={{ fontSize: 32, opacity: 0.7 }} />
          <Typography variant="body2">
            {busy ? 'Загрузка...' : 'Нажми, чтобы выбрать файл или перетащи'}
          </Typography>
          {error ? (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
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
    '.anynote-image-wrapper:hover &': { opacity: 1 },
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

  return (
    <NodeViewWrapper as="div" className="anynote-image" data-type="image">
      <Box
        ref={outerRef}
        sx={{
          display: 'flex',
          justifyContent: ALIGN_FLEX[align],
          width: '100%',
          userSelect: resizing ? 'none' : 'auto',
        }}
      >
        <Box
          className="anynote-image-wrapper"
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
              {toolbarButton('По левому краю', <AlignHorizontalLeftIcon fontSize="small" />, () =>
                updateAttributes({ align: 'left' }),
              )}
              {toolbarButton('По центру', <AlignHorizontalCenterIcon fontSize="small" />, () =>
                updateAttributes({ align: 'center' }),
              )}
              {toolbarButton('По правому краю', <AlignHorizontalRightIcon fontSize="small" />, () =>
                updateAttributes({ align: 'right' }),
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
              {toolbarButton(
                captionShown ? 'Убрать подпись' : 'Подпись',
                <SubtitlesIcon fontSize="small" />,
                () => updateAttributes({ caption: captionShown ? null : '' }),
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
              {onOpenFilePreview
                ? toolbarButton('Просмотр', <ZoomInIcon fontSize="small" />, openPreview)
                : null}
              <Tooltip title="Скачать" arrow>
                <IconButton
                  size="small"
                  component="a"
                  href={src}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseDown={(e) => e.stopPropagation()}
                  sx={{ color: 'text.secondary' }}
                >
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {/* «Сохранить как файл» переехал в блочное меню («Превратить в»). */}
              {toolbarButton('Заменить', <CachedIcon fontSize="small" />, () =>
                updateAttributes({ src: null, width: null, caption: null, align: 'center' }),
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
              {toolbarButton('Удалить', <DeleteIcon fontSize="small" />, () => deleteNode(), true)}
            </Paper>
          ) : null}
          <Box sx={{ position: 'relative', lineHeight: 0 }}>
            <Box
              component="img"
              ref={imgRef}
              src={src}
              alt={alt}
              title={title}
              draggable={false}
              onClick={() => {
                if (shouldOpenImagePreview({ isEditable: editor.isEditable, isDoubleClick: false }))
                  openPreview()
              }}
              onDoubleClick={() => {
                if (shouldOpenImagePreview({ isEditable: editor.isEditable, isDoubleClick: true }))
                  openPreview()
              }}
              sx={{
                display: 'block',
                maxWidth: '100%',
                height: 'auto',
                width: width ? `${width}px` : 'auto',
                borderRadius: 0.75,
                userSelect: 'none',
                cursor: onOpenFilePreview && !editor.isEditable ? 'zoom-in' : undefined,
              }}
            />
            {editor.isEditable ? (
              <>
                <Box onMouseDown={handleResizeStart('left')} sx={handleStyle('left')} />
                <Box onMouseDown={handleResizeStart('right')} sx={handleStyle('right')} />
              </>
            ) : null}
          </Box>
          {captionShown ? (
            <TextField
              value={caption ?? ''}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Подпись к рисунку"
              variant="standard"
              fullWidth
              disabled={!editor.isEditable}
              slotProps={{ input: { disableUnderline: true } }}
              sx={{
                mt: 0.5,
                '& .MuiInput-input': {
                  fontSize: '0.875rem',
                  textAlign: 'center',
                  color: 'text.secondary',
                  fontStyle: 'italic',
                },
              }}
            />
          ) : null}
        </Box>
      </Box>
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend<ResizableImageOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
  addAttributes() {
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      // Transient marker used by the imagePaste plugin to re-find a freshly
      // pasted placeholder after its async upload resolves. Deliberately not
      // rendered to / parsed from the DOM so it never persists in saved content.
      uploadId: { default: null, rendered: false },
      // File metadata stamped at upload time; feeds the «Сохранить как файл»
      // swap (image → fileAttachment). Null on legacy images — the swap then
      // falls back to a generic name.
      name: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attrs) => {
          const v = attrs.name as string | null
          return v ? { 'data-name': v } : {}
        },
      },
      size: {
        default: null,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-size')
          if (!raw) return null
          const n = Number(raw)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) => {
          const v = attrs.size as number | null
          return v ? { 'data-size': String(v) } : {}
        },
      },
      mimeType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-mime'),
        renderHTML: (attrs) => {
          const v = attrs.mimeType as string | null
          return v ? { 'data-mime': v } : {}
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const w = element.getAttribute('width')
          if (!w) return null
          const n = Number(w)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) => {
          const w = attrs.width as number | null
          return w ? { width: String(w) } : {}
        },
      },
      align: {
        default: 'center',
        parseHTML: (element) => (element.getAttribute('data-align') as Align) ?? 'center',
        renderHTML: (attrs) => ({ 'data-align': (attrs.align as Align) ?? 'center' }),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption'),
        renderHTML: (attrs) => {
          const c = attrs.caption as string | null
          return c === null ? {} : { 'data-caption': c }
        },
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})
