'use client'

import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import type { SelectChangeEvent } from '@mui/material'
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEffect, useState } from 'react'

type Props = { editor: Editor }

type TextToolbarSelection = {
  empty: boolean
  node?: unknown
  $from: { parent: { inlineContent: boolean } }
  $to: { parent: { inlineContent: boolean } }
}

type TextToolbarVisibilityArgs = {
  editor: Pick<Editor, 'isEditable'>
  state: { selection: TextToolbarSelection }
}

type ToolbarState = {
  fontFamily: string
  fontSize: string
  isBold: boolean
  isCode: boolean
  isHighlight: boolean
  isItalic: boolean
  isLink: boolean
  isStrike: boolean
  isUnderline: boolean
}

const FONT_FAMILIES = [
  { label: 'Авто', value: '' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", serif' },
  { label: 'Mono', value: '"SF Mono", Menlo, Consolas, monospace' },
]

const FONT_SIZES = [
  { label: 'Авто', value: '' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '32', value: '32px' },
]

function markButtonSx(active: boolean) {
  return {
    color: active ? 'primary.main' : 'text.secondary',
    bgcolor: active ? 'action.selected' : 'transparent',
  }
}

function selectValue(value: unknown, options: Array<{ value: string }>) {
  if (typeof value !== 'string') return ''
  return options.some((option) => option.value === value) ? value : ''
}

function selectLabel(value: unknown, options: Array<{ label: string; value: string }>) {
  return options.find((option) => option.value === value)?.label ?? options[0]?.label ?? ''
}

function readToolbarState(editor: Editor): ToolbarState {
  const textStyle = editor.getAttributes('textStyle')

  return {
    fontFamily: selectValue(textStyle.fontFamily, FONT_FAMILIES),
    fontSize: selectValue(textStyle.fontSize, FONT_SIZES),
    isBold: editor.isActive('bold'),
    isCode: editor.isActive('code'),
    isHighlight: editor.isActive('highlight'),
    isItalic: editor.isActive('italic'),
    isLink: editor.isActive('link'),
    isStrike: editor.isActive('strike'),
    isUnderline: editor.isActive('underline'),
  }
}

export function shouldShowTextToolbar({ editor, state }: TextToolbarVisibilityArgs) {
  const { selection } = state

  if (!editor.isEditable || selection.empty) return false
  if (selection.node) return false

  return selection.$from.parent.inlineContent && selection.$to.parent.inlineContent
}

export function FloatingToolbar({ editor }: Props) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [toolbarState, setToolbarState] = useState(() => readToolbarState(editor))

  useEffect(() => {
    const updateToolbarState = () => setToolbarState(readToolbarState(editor))

    updateToolbarState()
    editor.on('focus', updateToolbarState)
    editor.on('selectionUpdate', updateToolbarState)
    editor.on('transaction', updateToolbarState)
    editor.on('update', updateToolbarState)

    return () => {
      editor.off('focus', updateToolbarState)
      editor.off('selectionUpdate', updateToolbarState)
      editor.off('transaction', updateToolbarState)
      editor.off('update', updateToolbarState)
    }
  }, [editor])

  useEffect(() => {
    if (!linkDialogOpen) return
    const current = editor.getAttributes('link').href as string | undefined
    setLinkValue(current ?? 'https://')
  }, [editor, linkDialogOpen])

  const setFontFamily = (event: SelectChangeEvent) => {
    const value = event.target.value
    if (value) editor.chain().focus().setFontFamily(value).run()
    else editor.chain().focus().unsetFontFamily().run()
  }

  const setFontSize = (event: SelectChangeEvent) => {
    const value = event.target.value
    if (value) editor.chain().focus().setFontSize(value).run()
    else editor.chain().focus().unsetFontSize().run()
  }

  const saveLink = () => {
    const next = linkValue.trim()
    if (!next) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: next }).run()
    }
    setLinkDialogOpen(false)
  }

  return (
    <>
      <BubbleMenu editor={editor} shouldShow={shouldShowTextToolbar}>
        <Paper elevation={6} sx={{ display: 'inline-flex', borderRadius: 1, px: 0.5, py: 0.25 }}>
          <Stack direction="row" alignItems="center" spacing={0.25}>
            <Tooltip title="Жирный">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleBold().run()}
                aria-label="Жирный"
                sx={markButtonSx(toolbarState.isBold)}
              >
                <FormatBoldIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Курсив">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                aria-label="Курсив"
                sx={markButtonSx(toolbarState.isItalic)}
              >
                <FormatItalicIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Подчеркнуть">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
                aria-label="Подчеркнуть"
                sx={markButtonSx(toolbarState.isUnderline)}
              >
                <FormatUnderlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Зачеркнуть">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleStrike().run()}
                aria-label="Зачеркнуть"
                sx={markButtonSx(toolbarState.isStrike)}
              >
                <StrikethroughSIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Подсветить">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff59d' }).run()}
                aria-label="Подсветить"
                sx={markButtonSx(toolbarState.isHighlight)}
              >
                <FormatColorFillIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Инлайн-код">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().toggleCode().run()}
                aria-label="Инлайн-код"
                sx={markButtonSx(toolbarState.isCode)}
              >
                <CodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {toolbarState.isLink ? (
              <>
                <Tooltip title="Ссылка">
                  <IconButton
                    size="small"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setLinkDialogOpen(true)}
                    aria-label="Ссылка"
                    sx={markButtonSx(true)}
                  >
                    <LinkIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Удалить ссылку">
                  <IconButton
                    size="small"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
                    aria-label="Удалить ссылку"
                    sx={{ color: 'text.secondary' }}
                  >
                    <LinkOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <Select
              size="small"
              value={toolbarState.fontFamily}
              onChange={setFontFamily}
              aria-label="Шрифт"
              displayEmpty
              renderValue={(value) => selectLabel(value, FONT_FAMILIES)}
              sx={{
                minWidth: 116,
                height: 32,
                fontSize: 13,
                '& .MuiSelect-select': { py: 0.5 },
              }}
            >
              {FONT_FAMILIES.map((font) => (
                <MenuItem key={font.label} value={font.value}>
                  {font.label}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={toolbarState.fontSize}
              onChange={setFontSize}
              aria-label="Размер шрифта"
              displayEmpty
              renderValue={(value) => selectLabel(value, FONT_SIZES)}
              sx={{
                minWidth: 76,
                height: 32,
                fontSize: 13,
                '& .MuiSelect-select': { py: 0.5 },
              }}
            >
              {FONT_SIZES.map((size) => (
                <MenuItem key={size.label} value={size.value}>
                  {size.label}
                </MenuItem>
              ))}
            </Select>
          </Stack>
        </Paper>
      </BubbleMenu>

      <Dialog
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Ссылка</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="URL"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveLink()
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDialogOpen(false)}>Отмена</Button>
          <Button
            color="error"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              setLinkDialogOpen(false)
            }}
          >
            Удалить
          </Button>
          <Button variant="contained" onClick={saveLink}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
