'use client'

import { Box, IconButton, Popover } from '@mui/material'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import Picker, { EmojiStyle, Theme as EmojiTheme, type EmojiClickData } from 'emoji-picker-react'
import { useTheme } from '@mui/material/styles'
import { useCallback, useState } from 'react'

const DEFAULT_EMOJI = '💡'

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const emoji = (node.attrs.emoji as string) || DEFAULT_EMOJI
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const muiTheme = useTheme()
  const pickerTheme = muiTheme.palette.mode === 'dark' ? EmojiTheme.DARK : EmojiTheme.LIGHT

  const openPicker = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!editor.isEditable) return
      setAnchor(event.currentTarget)
    },
    [editor.isEditable],
  )

  const closePicker = useCallback(() => setAnchor(null), [])

  const handleEmojiClick = useCallback(
    (data: EmojiClickData) => {
      updateAttributes({ emoji: data.emoji })
      closePicker()
    },
    [closePicker, updateAttributes],
  )

  return (
    <NodeViewWrapper as="div" className="anynote-callout" data-type="callout">
      <Box
        contentEditable={false}
        sx={{ flexShrink: 0, display: 'flex', alignItems: 'flex-start', pt: 0.25 }}
      >
        <IconButton
          size="small"
          onClick={openPicker}
          disabled={!editor.isEditable}
          aria-label="Выбрать эмодзи"
          sx={{
            width: 32,
            height: 32,
            fontSize: 20,
            lineHeight: 1,
            p: 0,
            borderRadius: 1,
          }}
        >
          <span style={{ fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", sans-serif' }}>
            {emoji}
          </span>
        </IconButton>
      </Box>
      <NodeViewContent as="div" className="anynote-callout-content" />
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={closePicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Picker
          onEmojiClick={handleEmojiClick}
          theme={pickerTheme}
          emojiStyle={EmojiStyle.NATIVE}
          lazyLoadEmojis
          previewConfig={{ showPreview: false }}
          width={320}
          height={360}
        />
      </Popover>
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      emoji: { default: DEFAULT_EMOJI },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (element) => {
          const el = element as HTMLElement
          return {
            emoji: el.getAttribute('data-emoji') || DEFAULT_EMOJI,
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'data-emoji': (node.attrs.emoji as string) || DEFAULT_EMOJI,
      }),
      0,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
})
