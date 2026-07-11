'use client'

import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined'

import { getFileIcon } from '../assets/files/index'
import { DownloadIcon } from '../assets/index'
import { FileAttachmentSchema } from './file-attachment.schema'
import { attachmentToImageNode, attachmentToMediaNode, inferMediaKind } from './media-mime'

export type FileAttachmentAttrs = {
  url: string
  name: string
  size: number
  mimeType: string
  ext: string
}

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function FileAttachmentView({ node, editor, selected, getPos }: NodeViewProps) {
  const attrs = node.attrs as FileAttachmentAttrs
  const Icon = getFileIcon(attrs.ext)
  const mediaKind = inferMediaKind(attrs.mimeType)
  const playable = mediaKind === 'video' || mediaKind === 'audio'
  const showableAsImage = mediaKind === 'image' && Boolean(attrs.url)

  const swapNode = (swap: object | null) => {
    const pos = getPos()
    if (typeof pos !== 'number' || !swap) return
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, swap)
      .run()
  }

  const playAsMedia = () => swapNode(attachmentToMediaNode(attrs))
  const showAsImage = () => swapNode(attachmentToImageNode(attrs))

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-file-attachment"
      data-type="file-attachment"
      data-drag-handle=""
      contentEditable={false}
    >
      <Box sx={{ position: 'relative' }}>
        {(playable || showableAsImage) && selected && editor.isEditable ? (
          <Paper
            elevation={6}
            sx={{
              position: 'absolute',
              top: -44,
              left: 8,
              display: 'flex',
              alignItems: 'center',
              px: 0.5,
              py: 0.25,
              borderRadius: 1,
              whiteSpace: 'nowrap',
              zIndex: 2,
            }}
          >
            <Tooltip
              title={
                showableAsImage
                  ? 'Показать как изображение'
                  : mediaKind === 'video'
                    ? 'Воспроизвести как видео'
                    : 'Воспроизвести как аудио'
              }
              arrow
            >
              <IconButton
                size="small"
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (showableAsImage) showAsImage()
                  else playAsMedia()
                }}
                sx={{ color: 'text.secondary' }}
                data-testid={showableAsImage ? 'attachment-show-as-image' : 'attachment-play-media'}
              >
                {showableAsImage ? (
                  <ImageOutlinedIcon fontSize="small" />
                ) : (
                  <PlayCircleOutlineIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Paper>
        ) : null}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            textDecoration: 'none',
            color: 'text.primary',
            border: '1px solid',
            borderColor: selected ? 'primary.main' : 'divider',
            borderRadius: 1.5,
            px: 1.5,
            py: 1,
            my: 0.5,
            transition: 'background-color .15s, border-color .15s',
            '&:hover': {
              backgroundColor: 'action.hover',
              borderColor: 'text.secondary',
              '& .download-link': { opacity: 1 },
            },
          }}
        >
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <Icon width={32} height={32} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component="div"
              variant="body2"
              sx={{
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attrs.name}
            </Typography>
            <Typography
              component="div"
              variant="caption"
              sx={{
                color: 'text.secondary',
              }}
            >
              {formatBytes(attrs.size)}
            </Typography>
          </Box>
          <Box
            component="a"
            className="download-link"
            href={attrs.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attrs.name}
            aria-label={`Скачать ${attrs.name}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            sx={{
              color: 'text.secondary',
              opacity: 0.6,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 1,
              p: 0.5,
              transition: 'opacity .15s, background-color .15s',
              '&:hover': { backgroundColor: 'action.hover' },
            }}
          >
            <DownloadIcon width={18} height={18} />
          </Box>
        </Box>
      </Box>
    </NodeViewWrapper>
  )
}

export const FileAttachment = FileAttachmentSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView)
  },
})
