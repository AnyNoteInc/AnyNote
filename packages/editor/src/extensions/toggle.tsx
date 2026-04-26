import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Box, IconButton } from '@mui/material'
import ArrowRightOutlinedIcon from '@mui/icons-material/ArrowRightOutlined'

function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false

  const handleToggle = (event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    updateAttributes({ open: !open })
  }

  return (
    <NodeViewWrapper className="anynote-toggle" data-open={open ? 'true' : 'false'}>
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
          onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault()}
          onClick={handleToggle}
          contentEditable={false}
          className="anynote-toggle-arrow"
          aria-label={open ? 'Свернуть' : 'Развернуть'}
          sx={{
            width: 20,
            height: 20,
            p: 0,
            mt: '2px',
            flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms',
            color: 'text.secondary',
          }}
        >
          <ArrowRightOutlinedIcon sx={{ fontSize: 18 }} />
        </IconButton>
        <NodeViewContent className="anynote-toggle-content" as="div" />
      </Box>
    </NodeViewWrapper>
  )
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute('data-open') !== 'false',
        renderHTML: (attrs) => ({ 'data-open': attrs.open ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== 'toggle') continue
          if (node.attrs.open) return false
          const pos = $from.before(depth)
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: true })
              return true
            })
            .run()
          return false
        }
        return false
      },
    }
  },
})
