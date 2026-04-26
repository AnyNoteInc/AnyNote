'use client'

import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import LinkIcon from '@mui/icons-material/Link'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import { IconButton, Paper, Stack } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'

type Props = { editor: Editor }

export function FloatingToolbar({ editor }: Props) {
  return (
    <BubbleMenu editor={editor}>
      <Paper elevation={6} sx={{ display: 'inline-flex', borderRadius: 1, px: 0.5 }}>
        <Stack direction="row">
          <IconButton
            size="small"
            color={editor.isActive('bold') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <FormatBoldIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('italic') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <FormatItalicIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('strike') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strikethrough"
          >
            <StrikethroughSIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('code') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleCode().run()}
            aria-label="Inline code"
          >
            <CodeIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('link') ? 'primary' : 'default'}
            onClick={() => {
              const url = window.prompt('URL')
              if (url) editor.chain().focus().setLink({ href: url }).run()
            }}
            aria-label="Link"
          >
            <LinkIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Paper>
    </BubbleMenu>
  )
}
