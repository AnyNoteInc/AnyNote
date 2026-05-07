import React, { useState } from 'react'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Box, IconButton } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

import { HiddenTextSchema } from './hidden-text.schema'

// Hidden text should be visible immediately after insertion (so the author can
// type into it) but hidden by default after a reload. We distinguish the two
// states with a `created` timestamp attribute: the slash menu sets it on
// insertion, and the view treats any timestamp older than this threshold as
// "loaded from storage" and starts masked.
const FRESH_INSERT_MS = 3000

function HiddenTextView({ node }: NodeViewProps) {
  const [visible, setVisible] = useState(() => {
    const created = node.attrs.created
    return typeof created === 'number' && Date.now() - created < FRESH_INSERT_MS
  })

  return (
    <NodeViewWrapper className="anynote-hidden-text" data-visible={visible ? 'true' : 'false'}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
          px: 1.5,
          py: 1,
          my: 0.5,
          transition: 'border-color .15s',
          '&:hover': { borderColor: 'text.secondary' },
        }}
      >
        <IconButton
          size="small"
          onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          contentEditable={false}
          aria-label={visible ? 'Скрыть' : 'Показать'}
          sx={{
            width: 20,
            height: 20,
            p: 0,
            mt: '2px',
            flexShrink: 0,
            color: 'text.secondary',
          }}
        >
          {visible ? (
            <VisibilityIcon sx={{ fontSize: 18 }} />
          ) : (
            <VisibilityOffIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
        <NodeViewContent className="anynote-hidden-text-content" as="div" />
      </Box>
    </NodeViewWrapper>
  )
}

export const HiddenText = HiddenTextSchema.extend({
  addNodeView() {
    return ReactNodeViewRenderer(HiddenTextView)
  },
})
