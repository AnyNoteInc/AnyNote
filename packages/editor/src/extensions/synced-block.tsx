'use client'

import type { ReactNode } from 'react'
import { Box, Chip, Typography } from '@mui/material'
import SyncIcon from '@mui/icons-material/Sync'
import type { JSONContent } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'

import { SyncedBlockSchema, SYNCED_BLOCK_LABEL, type SyncedBlockAttrs } from './synced-block.schema'

export {
  SYNCED_BLOCK_LABEL,
  createSyncedBlockNode,
  emptySyncedBlockDoc,
  type SyncedBlockAttrs,
} from './synced-block.schema'

// Arguments handed to the app-injected renderer. The live nested collaborative
// editor + the access-checked tRPC query live in apps/web, which CANNOT be
// imported from @repo/editor (module boundary / transpilePackages). So the node
// exposes a render slot: apps/web passes `renderSyncedBlock` through
// `SyncedBlock.configure({ renderSyncedBlock })`, and this view calls it.
export type SyncedBlockRenderArgs = {
  /** The SyncedBlock id stored on the node. */
  blockId: string | null
  /** True when the host editor is editable (false for public share / VIEWER). */
  editorEditable: boolean
  /**
   * Replace THIS node, locally, with the supplied content inlined as normal
   * blocks (the per-instance «отсоединить эту копию» of spec §6/§7, and the
   * lazy auto-detach when «отсоединить все» fired). The canonical block and
   * every OTHER instance are untouched — this is a pure client transaction.
   */
  detachInline: (content: JSONContent | JSONContent[] | null) => void
  /** Navigate to the block's origin page (the «Открыть оригинал» action). */
  onOpenOrigin: (originPageId: string) => void
}

export type SyncedBlockRenderer = (args: SyncedBlockRenderArgs) => ReactNode

export type SyncedBlockOptions = {
  // Injected by apps/web to render the live nested editor / snapshot / access
  // placeholder. When absent (SSR, standalone editor, an unconfigured host) we
  // fall back to a static placeholder card so the node still renders.
  renderSyncedBlock: SyncedBlockRenderer | null
  // Navigation hook so the «Открыть оригинал» action can route. Optional.
  onNavigateToPage: ((pageId: string) => void) | null
}

function PlaceholderCard() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography component="div" variant="body2" sx={{ fontWeight: 600 }}>
        {SYNCED_BLOCK_LABEL}
      </Typography>
    </Box>
  )
}

function SyncedBlockView({ node, extension, editor, getPos }: NodeViewProps) {
  const attrs = node.attrs as SyncedBlockAttrs
  const { renderSyncedBlock, onNavigateToPage } = extension.options as SyncedBlockOptions

  // Replace this node, in THIS editor only, with the inlined content (§6/§7).
  // Resolve the position lazily on call so a stale closure can't delete the
  // wrong range after concurrent edits.
  const detachInline = (content: JSONContent | JSONContent[] | null) => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const target = editor.state.doc.nodeAt(pos)
    if (!target || target.type.name !== 'syncedBlock') return
    const from = pos
    const to = pos + target.nodeSize
    const chain = editor.chain().focus().deleteRange({ from, to })
    if (content != null) {
      chain.insertContentAt(from, content)
    }
    chain.run()
  }

  const onOpenOrigin = (originPageId: string) => {
    onNavigateToPage?.(originPageId)
  }

  const content = renderSyncedBlock
    ? renderSyncedBlock({
        blockId: attrs.blockId,
        editorEditable: editor.isEditable,
        detachInline,
        onOpenOrigin,
      })
    : null

  return (
    <NodeViewWrapper
      as="div"
      className="anynote-synced-block"
      data-type="synced-block"
      data-block-id={attrs.blockId ?? ''}
      data-drag-handle=""
      contentEditable={false}
    >
      <Box
        sx={{
          position: 'relative',
          borderLeft: '3px solid',
          borderColor: 'primary.main',
          borderRadius: 1,
          bgcolor: 'action.hover',
          pl: 1,
          my: 0.5,
          overflow: 'hidden',
        }}
      >
        <Chip
          icon={<SyncIcon sx={{ fontSize: 14 }} />}
          label={SYNCED_BLOCK_LABEL}
          size="small"
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            height: 20,
            fontSize: 11,
            bgcolor: 'background.paper',
            color: 'text.secondary',
            zIndex: 1,
            '& .MuiChip-icon': { color: 'primary.main' },
          }}
        />
        {content ?? <PlaceholderCard />}
      </Box>
    </NodeViewWrapper>
  )
}

export const SyncedBlock = SyncedBlockSchema.extend<SyncedBlockOptions>({
  addOptions() {
    return { renderSyncedBlock: null, onNavigateToPage: null }
  },
  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView)
  },
})
