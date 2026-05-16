'use client'

import { Box, Divider, IconButton, Stack, Tooltip } from '@mui/material'
import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatQuoteIcon from '@mui/icons-material/FormatQuote'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import Looks3Icon from '@mui/icons-material/Looks3'
import LooksOneIcon from '@mui/icons-material/LooksOne'
import LooksTwoIcon from '@mui/icons-material/LooksTwo'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor, JSONContent } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import StarterKit from '@tiptap/starter-kit'

import { buildPlaceholder } from './extensions/placeholder'

export interface AnyNotePlainEditorProps {
  readonly value: JSONContent | null
  readonly placeholder?: string
  readonly className?: string
  readonly editable?: boolean
  readonly onBlurSave: (value: JSONContent) => void
}

interface ToolbarButtonConfig {
  readonly tooltip: string
  readonly icon: React.ReactNode
  readonly isActive: (ed: Editor) => boolean
  readonly run: (ed: Editor) => void
}

const TOOLBAR: ReadonlyArray<ToolbarButtonConfig | 'divider'> = [
  {
    tooltip: 'Жирный (Ctrl+B)',
    icon: <FormatBoldIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('bold'),
    run: (ed) => ed.chain().focus().toggleBold().run(),
  },
  {
    tooltip: 'Курсив (Ctrl+I)',
    icon: <FormatItalicIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('italic'),
    run: (ed) => ed.chain().focus().toggleItalic().run(),
  },
  {
    tooltip: 'Зачёркнутый',
    icon: <StrikethroughSIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('strike'),
    run: (ed) => ed.chain().focus().toggleStrike().run(),
  },
  {
    tooltip: 'Инлайн-код',
    icon: <CodeIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('code'),
    run: (ed) => ed.chain().focus().toggleCode().run(),
  },
  'divider',
  {
    tooltip: 'Заголовок 1',
    icon: <LooksOneIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('heading', { level: 1 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    tooltip: 'Заголовок 2',
    icon: <LooksTwoIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('heading', { level: 2 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    tooltip: 'Заголовок 3',
    icon: <Looks3Icon fontSize="small" />,
    isActive: (ed) => ed.isActive('heading', { level: 3 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  'divider',
  {
    tooltip: 'Маркированный список',
    icon: <FormatListBulletedIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('bulletList'),
    run: (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  {
    tooltip: 'Нумерованный список',
    icon: <FormatListNumberedIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('orderedList'),
    run: (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    tooltip: 'Цитата',
    icon: <FormatQuoteIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('blockquote'),
    run: (ed) => ed.chain().focus().toggleBlockquote().run(),
  },
  'divider',
  {
    tooltip: 'Ссылка',
    icon: <LinkIcon fontSize="small" />,
    isActive: (ed) => ed.isActive('link'),
    run: (ed) => {
      const prev = ed.getAttributes('link').href as string | undefined
      const next = typeof window !== 'undefined' ? window.prompt('URL', prev ?? 'https://') : null
      if (next === null) return
      if (next === '') {
        ed.chain().focus().extendMarkRange('link').unsetLink().run()
        return
      }
      ed.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
    },
  },
  {
    tooltip: 'Убрать ссылку',
    icon: <LinkOffIcon fontSize="small" />,
    isActive: () => false,
    run: (ed) => ed.chain().focus().unsetLink().run(),
  },
]

function PlainEditorToolbar({ editor }: { readonly editor: Editor }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.25}
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        px: 0.5,
        py: 0.25,
        flexWrap: 'wrap',
      }}
    >
      {TOOLBAR.map((item, idx) => {
        if (item === 'divider') {
          return (
            <Divider
              key={`d-${idx}`}
              orientation="vertical"
              flexItem
              sx={{ mx: 0.5, my: 0.5 }}
            />
          )
        }
        const active = item.isActive(editor)
        return (
          <Tooltip key={item.tooltip} title={item.tooltip} arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => item.run(editor)}
              sx={{
                color: active ? 'primary.main' : 'text.secondary',
                bgcolor: active ? 'action.selected' : 'transparent',
              }}
            >
              {item.icon}
            </IconButton>
          </Tooltip>
        )
      })}
    </Stack>
  )
}

export function AnyNotePlainEditor({
  value,
  placeholder = "Введите '/' для команд",
  className,
  editable = true,
  onBlurSave,
}: AnyNotePlainEditorProps) {
  const editor = useEditor({
    editable,
    immediatelyRender: false,
    content: value ?? undefined,
    extensions: [
      StarterKit.configure({ dropcursor: false }),
      Link.configure({ openOnClick: false }),
      Typography,
      buildPlaceholder(placeholder),
    ],
    onBlur: ({ editor: ed }) => {
      onBlurSave(ed.getJSON())
    },
  })

  return (
    <Box className={`anynote-editor ${className ?? ''}`}>
      {editor && editable ? <PlainEditorToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </Box>
  )
}
