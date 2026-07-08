'use client'

import type { ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import { EmbeddedDatabaseSchema, type EmbeddedDatabaseAttrs } from './embedded-database.schema'

// Arguments handed to the app-injected renderer. The rich live table
// (`DatabaseTableView` + the tRPC query) lives in apps/web, which CANNOT be
// imported from @repo/editor (module-boundary / transpilePackages). So the node
// exposes a render slot: apps/web passes `renderEmbed` through
// `EmbeddedDatabase.configure({ renderEmbed })`, and this view calls it.
export type EmbeddedDatabaseRenderArgs = {
  sourceId: string | null
  viewId: string | null
  readonly: boolean
  /** True when the host editor is not editable (e.g. public share). */
  editorEditable: boolean
}

export type EmbeddedDatabaseRenderer = (args: EmbeddedDatabaseRenderArgs) => ReactNode

export type EmbeddedDatabaseOptions = {
  // Injected by apps/web to render the live `DatabaseTableView`. When absent
  // (SSR, standalone editor, or an unconfigured host) we fall back to a static
  // placeholder card so the node still renders without crashing.
  renderEmbed: EmbeddedDatabaseRenderer | null
}

function PlaceholderCard({ sourceId }: { sourceId: string | null }) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        p: 2,
        my: 0.5,
        bgcolor: 'action.hover',
      }}
    >
      <Typography component="div" variant="body2" sx={{ fontWeight: 600 }}>
        База данных
      </Typography>
      <Typography
        component="div"
        variant="caption"
        sx={{
          color: 'text.secondary',
        }}
      >
        {sourceId ? `Источник: ${sourceId}` : 'Источник не выбран'}
      </Typography>
    </Box>
  )
}

function EmbeddedDatabaseView({ node, extension, editor }: NodeViewProps) {
  const attrs = node.attrs as EmbeddedDatabaseAttrs
  const { renderEmbed } = extension.options as EmbeddedDatabaseOptions

  // A non-editable host (public share) forces readonly regardless of the
  // node's own `readonly` flag.
  const readonly = attrs.readonly || !editor.isEditable

  const content = renderEmbed
    ? renderEmbed({
        sourceId: attrs.sourceId,
        viewId: attrs.viewId,
        readonly,
        editorEditable: editor.isEditable,
      })
    : null

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-embedded-database"
      data-type="embedded-database"
      data-drag-handle=""
      contentEditable={false}
    >
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
          overflow: 'hidden',
          my: 0.5,
        }}
      >
        {content ?? <PlaceholderCard sourceId={attrs.sourceId} />}
      </Box>
    </NodeViewWrapper>
  )
}

export const EmbeddedDatabase = EmbeddedDatabaseSchema.extend<EmbeddedDatabaseOptions>({
  addOptions() {
    return { renderEmbed: null }
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbeddedDatabaseView)
  },
})
