'use client'

import { Box, Divider, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import AudiotrackOutlinedIcon from '@mui/icons-material/AudiotrackOutlined'
import CachedIcon from '@mui/icons-material/Cached'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useRef, useState } from 'react'

import { AudioSchema } from './audio.schema'
import { mediaPreviewPayload } from './file-preview-interaction'
import { mediaToAttachmentNode, type MediaNodeAttrs } from './media-mime'
import { replaceNodeAt } from '../lib/replace-node'
import { normalizeLinkHref } from '../link-href'
import type { OpenFilePreview, UploadHandler } from '../types'

export type AudioOptions = {
  uploadHandler: UploadHandler | null
  onOpenFilePreview: OpenFilePreview | null
}

function AudioView({
  node,
  updateAttributes,
  deleteNode,
  editor,
  selected,
  extension,
  getPos,
}: NodeViewProps) {
  const url = (node.attrs.url as string) || ''
  // Sanitize before using as a media src / download href (see video.tsx).
  const safeUrl = normalizeLinkHref(url)
  const name = (node.attrs.name as string) || ''
  const options = extension.options as AudioOptions
  const uploadHandler = options.uploadHandler
  const onOpenFilePreview = options.onOpenFilePreview

  const openPreview = () => {
    if (!onOpenFilePreview || !safeUrl) return
    onOpenFilePreview(
      mediaPreviewPayload({
        url: safeUrl,
        name,
        size: (node.attrs.size as number) || 0,
        mimeType: (node.attrs.mimeType as string) || '',
      }),
    )
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

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
        setError(err instanceof Error ? err.message : 'Не удалось загрузить аудио')
      } finally {
        setBusy(false)
      }
    },
    [updateAttributes, uploadHandler],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file && file.type.startsWith('audio/')) upload(file)
    },
    [upload],
  )

  // ── Empty / placeholder state ───────────────────────────────────────────
  if (!safeUrl) {
    return (
      <NodeViewWrapper as="div" className="anynote-audio" data-type="audio" data-empty="true">
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
          <AudiotrackOutlinedIcon sx={{ fontSize: 32, opacity: 0.7 }} />
          <Typography variant="body2">
            {busy ? 'Загрузка...' : 'Нажми, чтобы выбрать аудио или перетащи'}
          </Typography>
          {error ? (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
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
    replaceNodeAt(editor, pos, node.nodeSize, mediaToAttachmentNode(mediaAttrs))
  }

  return (
    <NodeViewWrapper as="div" className="anynote-audio" data-type="audio">
      <Box
        className="anynote-audio-wrapper"
        sx={{
          position: 'relative',
          my: 0.5,
          border: selected ? '2px solid' : '2px solid transparent',
          borderColor: selected ? 'primary.main' : 'transparent',
          borderRadius: 1,
          p: 0.5,
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
            {toolbarButton(
              'Показать как файл',
              <InsertDriveFileOutlinedIcon fontSize="small" />,
              showAsFile,
            )}
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
              updateAttributes({ url: '', name: '', size: 0, mimeType: '' }),
            )}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
            {toolbarButton('Удалить', <DeleteIcon fontSize="small" />, () => deleteNode(), true)}
          </Paper>
        ) : null}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="audio"
            src={safeUrl}
            controls
            preload="metadata"
            sx={{ display: 'block', width: '100%', flex: 1, minWidth: 0 }}
          />
          {onOpenFilePreview ? (
            <Tooltip title="Открыть просмотр" arrow>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openPreview()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                data-testid="audio-open-preview"
                sx={{ color: 'text.secondary' }}
              >
                <OpenInFullIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
        {name ? (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              pl: 0.5,
            }}
          >
            {name}
          </Typography>
        ) : null}
      </Box>
    </NodeViewWrapper>
  )
}

export const Audio = AudioSchema.extend<AudioOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      uploadHandler: null,
      onOpenFilePreview: null,
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(AudioView)
  },
})
