'use client'

import { Box, IconButton, Link as MuiLink, Paper, Tooltip, Typography } from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useEffect, useState } from 'react'

import { EmbedSchema, type EmbedAttrs } from './embed.schema'
import { readEmbedsEnabled, writeEmbedsEnabled } from '../embed-prefs'
import { normalizeLinkHref } from '../link-href'

export type EmbedOptions = {
  // The current pageId, used to read the per-page rich-embed toggle. Threaded
  // from buildExtensions → page-renderer. When absent, embeds always render
  // (default ON).
  pageId: string | null
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Subscribe to the per-page embeds toggle. Re-reads on the same-tab custom event
// (writeEmbedsEnabled) and the cross-tab storage event.
const useEmbedsEnabled = (pageId: string | null): boolean => {
  const [enabled, setEnabled] = useState(() => (pageId ? readEmbedsEnabled(pageId) : true))
  useEffect(() => {
    if (!pageId) return
    const update = () => setEnabled(readEmbedsEnabled(pageId))
    update()
    window.addEventListener('anynote:embeds-pref', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('anynote:embeds-pref', update)
      window.removeEventListener('storage', update)
    }
  }, [pageId])
  return enabled
}

function EmbedView({ node, deleteNode, editor, selected, extension }: NodeViewProps) {
  const attrs = node.attrs as EmbedAttrs
  const options = extension.options as EmbedOptions
  const embedsOn = useEmbedsEnabled(options.pageId)

  // SECURITY: the iframe src is ALWAYS the provider-transformed embedUrl, passed
  // through the sanitizer once more. The raw `url` is never used as src.
  const safeEmbedUrl = normalizeLinkHref(attrs.embedUrl)
  const safeUrl = normalizeLinkHref(attrs.url)
  const host = hostOf(safeUrl)

  const open = () => {
    if (safeUrl) window.open(safeUrl, '_blank', 'noopener,noreferrer')
  }

  const toolbar =
    selected && editor.isEditable ? (
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
        <Tooltip title="Открыть оригинал" arrow>
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
        {options.pageId ? (
          <Tooltip title={embedsOn ? 'Свернуть встраивания на странице' : 'Показать встраивания'} arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                if (options.pageId) writeEmbedsEnabled(options.pageId, !embedsOn)
              }}
              sx={{ color: 'text.secondary' }}
            >
              {embedsOn ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}
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
    ) : null

  // Rich embeds OFF (or no embedUrl): render a bookmark-style card linking to the
  // original — never an iframe.
  if (!embedsOn || !safeEmbedUrl) {
    return (
      <NodeViewWrapper as="div" className="anynote-embed" data-type="embed" data-collapsed="true" data-drag-handle="">
        <Box sx={{ position: 'relative', my: 0.5 }}>
          {toolbar}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              border: '1px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              borderRadius: 1.5,
              px: 1.5,
              py: 1.25,
            }}
          >
            <VisibilityOffIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Встраивание ({attrs.provider || host})
              </Typography>
              <MuiLink
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                variant="caption"
                onClick={(e) => e.stopPropagation()}
                sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {safeUrl}
              </MuiLink>
            </Box>
          </Box>
        </Box>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper as="div" className="anynote-embed" data-type="embed" data-provider={attrs.provider} data-drag-handle="">
      <Box sx={{ position: 'relative', my: 0.5 }}>
        {toolbar}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 1,
            overflow: 'hidden',
            border: selected ? '2px solid' : '2px solid transparent',
            borderColor: selected ? 'primary.main' : 'transparent',
            backgroundColor: 'black',
          }}
        >
          <Box
            component="iframe"
            src={safeEmbedUrl}
            // The sandbox is the second containment ring (the allowlist is the
            // first): scripts may run but the frame can't navigate the top
            // window or read our cookies. allow-same-origin is required for the
            // provider players' postMessage; combined with the strict allowlist
            // this is the spec's accepted posture.
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer"
            title={`${attrs.provider || 'Встраивание'} — ${host}`}
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        </Box>
      </Box>
    </NodeViewWrapper>
  )
}

export const Embed = EmbedSchema.extend<EmbedOptions>({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      pageId: null,
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedView)
  },
})
