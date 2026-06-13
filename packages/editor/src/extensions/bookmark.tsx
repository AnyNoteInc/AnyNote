'use client'

import { Box, IconButton, Paper, Tooltip, Typography } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import LinkIcon from '@mui/icons-material/Link'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import { BookmarkSchema, type BookmarkAttrs } from './bookmark.schema'
import { normalizeLinkHref } from '../link-href'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// A bookmark card: favicon + title + description + host. Clicking opens the url
// in a new tab. Attrs are async-fillable (the previewFetch path updates them
// after insert) — the card renders fine with empty title/description (it falls
// back to the host / url).
function BookmarkView({ node, deleteNode, editor, selected }: NodeViewProps) {
  const attrs = node.attrs as BookmarkAttrs
  // Sanitize every URL before use: a crafted Yjs update could smuggle a
  // javascript:/data: scheme into the href or an <img src>.
  const safeUrl = normalizeLinkHref(attrs.url)
  const safeImage = normalizeLinkHref(attrs.image)
  const safeFavicon = normalizeLinkHref(attrs.favicon)
  const host = hostOf(safeUrl)
  const title = attrs.title || safeUrl || 'Закладка'

  const open = () => {
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <NodeViewWrapper as="div" className="anynote-bookmark" data-type="bookmark" data-drag-handle="">
      <Box sx={{ position: 'relative', my: 0.5 }}>
        {selected && editor.isEditable ? (
          <Paper
            elevation={6}
            sx={{
              position: 'absolute',
              top: -44,
              right: 8,
              display: 'flex',
              alignItems: 'center',
              px: 0.5,
              py: 0.25,
              borderRadius: 1,
              whiteSpace: 'nowrap',
              zIndex: 2,
            }}
          >
            <Tooltip title="Открыть ссылку" arrow>
              <IconButton
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  open()
                }}
                sx={{ color: 'text.secondary' }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить" arrow>
              <IconButton
                size="small"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  deleteNode()
                }}
                sx={{ color: 'error.main' }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Paper>
        ) : null}
        <Box
          role="link"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open()
            }
          }}
          sx={{
            display: 'flex',
            alignItems: 'stretch',
            textDecoration: 'none',
            color: 'text.primary',
            border: '1px solid',
            borderColor: selected ? 'primary.main' : 'divider',
            borderRadius: 1.5,
            overflow: 'hidden',
            cursor: 'pointer',
            minHeight: 76,
            transition: 'background-color .15s, border-color .15s',
            '&:hover': { backgroundColor: 'action.hover', borderColor: 'text.secondary' },
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1, px: 1.5, py: 1.25, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              {safeFavicon ? (
                <Box
                  component="img"
                  src={safeFavicon}
                  alt=""
                  width={16}
                  height={16}
                  sx={{ flexShrink: 0, borderRadius: 0.5 }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <LinkIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {title}
              </Typography>
            </Box>
            {attrs.description ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {attrs.description}
              </Typography>
            ) : null}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {host}
            </Typography>
          </Box>
          {safeImage ? (
            <Box
              component="img"
              src={safeImage}
              alt=""
              sx={{
                flexShrink: 0,
                width: 120,
                objectFit: 'cover',
                borderLeft: '1px solid',
                borderColor: 'divider',
              }}
              onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : null}
        </Box>
      </Box>
    </NodeViewWrapper>
  )
}

export const Bookmark = BookmarkSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView)
  },
})
