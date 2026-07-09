'use client'

import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatColorFillIcon from '@mui/icons-material/FormatColorFill'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import LinkIcon from '@mui/icons-material/Link'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
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
import { NodeSelection } from '@tiptap/pm/state'
import { BubbleMenu } from '@tiptap/react/menus'
import { useEffect, useRef, useState } from 'react'
import { attachLinkClickHandler } from '../extensions/link-click-handler'
import { selectionToAnchor } from '../comment-anchor'
import type { CommentsStorage } from '../extensions/comments'
import type { InlineAiCapturedRange } from './inline-ai-popover'
import type { AskAICallback } from '../types'
import { normalizeLinkHref } from '../link-href'

type Props = { editor: Editor }

// The inline-AI capability injected onto `editor.storage.ai` (the comments-storage
// precedent). `askAI` gates the button; `onAskAi` opens the action popover that
// anynote-editor mounts as a sibling, fed the captured selection range + anchor.
type AiStorage = {
  askAI?: AskAICallback | null
  onAskAi?: (captured: InlineAiCapturedRange) => void
}

function readAiStorage(editor: Editor): AiStorage | undefined {
  return (editor.storage as unknown as { ai?: AiStorage }).ai
}

/** A virtual anchor at the selection's client rect (the slash-popover precedent). */
function selectionRectAnchor(editor: Editor): InlineAiCapturedRange['anchorEl'] {
  const { from, to } = editor.state.selection
  try {
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    const left = Math.min(start.left, end.left)
    const top = Math.min(start.top, end.top)
    const right = Math.max(start.right, end.right)
    const bottom = Math.max(start.bottom, end.bottom)
    const rect = new DOMRect(left, top, right - left, bottom - top)
    return { getBoundingClientRect: () => rect }
  } catch {
    return null
  }
}

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
  const lastCommentAnchorRef = useRef<ReturnType<typeof selectionToAnchor>>(null)
  // Capture the selection range + text + anchor rect BEFORE the «Спросить AI»
  // click — Tiptap collapses the selection on the toolbar mousedown, and the
  // selection IS the payload (the lastCommentAnchorRef precedent).
  const lastAiCaptureRef = useRef<InlineAiCapturedRange | null>(null)

  useEffect(() => {
    const updateToolbarState = () => {
      setToolbarState(readToolbarState(editor))
      if (editor.state.selection.empty || editor.state.selection instanceof NodeSelection) {
        lastCommentAnchorRef.current = null
        lastAiCaptureRef.current = null
        return
      }
      lastCommentAnchorRef.current = selectionToAnchor(editor.state) ?? lastCommentAnchorRef.current
      const { from, to } = editor.state.selection
      lastAiCaptureRef.current = {
        from,
        to,
        selectedText: editor.state.doc.textBetween(from, to, ' '),
        anchorEl: selectionRectAnchor(editor),
      }
    }

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
    setLinkValue(current ?? '')
  }, [editor, linkDialogOpen])

  useEffect(() => attachLinkClickHandler(editor), [editor])

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
    const next = normalizeLinkHref(linkValue)
    const chain = editor.chain().focus()
    if (!next) {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.unsetLink().run()
    } else {
      if (toolbarState.isLink) chain.extendMarkRange('link')
      chain.setLink({ href: next }).run()
    }
    setLinkDialogOpen(false)
  }

  return (
    <>
      <BubbleMenu
        editor={editor}
        shouldShow={shouldShowTextToolbar}
        className="anynote-text-bubble-menu"
        style={{ zIndex: 8 }}
      >
        <Paper elevation={6} sx={{ display: 'inline-flex', borderRadius: 1, px: 0.5, py: 0.25 }}>
          <Stack
            direction="row"
            spacing={0.25}
            sx={{
              alignItems: 'center',
            }}
          >
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
            <Tooltip title="Ссылка">
              <IconButton
                size="small"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setLinkDialogOpen(true)}
                aria-label="Ссылка"
                sx={markButtonSx(toolbarState.isLink)}
              >
                <LinkIcon
                  sx={{
                    fontSize: 'small',
                  }}
                />
              </IconButton>
            </Tooltip>
            {toolbarState.isLink ? (
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
            ) : null}
            {(editor.storage as unknown as { comments?: CommentsStorage }).comments?.canComment ? (
              <Tooltip title="Комментировать">
                <IconButton
                  size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const anchor = selectionToAnchor(editor.state) ?? lastCommentAnchorRef.current
                    const cb = (editor.storage as unknown as { comments?: CommentsStorage })
                      .comments?.onCreateComment
                    if (anchor && cb) cb(anchor)
                  }}
                  aria-label="Комментировать"
                  sx={{ color: 'text.secondary' }}
                >
                  <ChatBubbleOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {readAiStorage(editor)?.askAI ? (
              <Tooltip title="Спросить AI">
                <IconButton
                  size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const { from, to } = editor.state.selection
                    const captured: InlineAiCapturedRange = lastAiCaptureRef.current ?? {
                      from,
                      to,
                      selectedText: editor.state.doc.textBetween(from, to, ' '),
                      anchorEl: selectionRectAnchor(editor),
                    }
                    readAiStorage(editor)?.onAskAi?.(captured)
                  }}
                  aria-label="Спросить AI"
                  sx={{ color: 'primary.main' }}
                >
                  <AutoAwesomeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
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
