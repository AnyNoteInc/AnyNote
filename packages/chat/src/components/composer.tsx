"use client"

import { Box, CircularProgress, IconButton, Paper } from "@mui/material"
import SendIcon from "@mui/icons-material/Send"
import { EditorContent, useEditor } from "@tiptap/react"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import History from "@tiptap/extension-history"
import Paragraph from "@tiptap/extension-paragraph"
import Placeholder from "@tiptap/extension-placeholder"
import Text from "@tiptap/extension-text"
import { useCallback, useEffect, useRef, type ReactElement } from "react"
import { chatTokens } from "../theme/tokens"

export interface ComposerProps {
  onSubmit: (text: string) => void
  placeholder?: string
  submitting?: boolean
  disabled?: boolean
}

export function Composer({
  onSubmit,
  placeholder = "Напишите сообщение…",
  submitting = false,
  disabled = false,
}: ComposerProps): ReactElement {
  const composing = useRef(false)
  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      History,
      Placeholder.configure({ placeholder }),
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "Поле ввода сообщения",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
  })

  const submit = useCallback(() => {
    if (!editor || submitting || disabled) return
    const text = editor.getText({ blockSeparator: "\n" }).trim()
    if (!text) return
    onSubmit(text)
    editor.commands.clearContent()
  }, [disabled, editor, onSubmit, submitting])

  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    const onCompositionStart = () => {
      composing.current = true
    }
    const onCompositionEnd = () => {
      composing.current = false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (composing.current) return
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        submit()
      }
    }
    dom.addEventListener("compositionstart", onCompositionStart)
    dom.addEventListener("compositionend", onCompositionEnd)
    dom.addEventListener("keydown", onKeyDown)
    return () => {
      dom.removeEventListener("compositionstart", onCompositionStart)
      dom.removeEventListener("compositionend", onCompositionEnd)
      dom.removeEventListener("keydown", onKeyDown)
    }
  }, [editor, submit])

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, pb: 2 }}>
      <Box sx={{ maxWidth: chatTokens.maxContentWidth, mx: "auto" }}>
        <Paper
          elevation={0}
          sx={{
            display: "flex",
            alignItems: "flex-end",
            gap: 1,
            p: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: `${chatTokens.composerRadius}px`,
            bgcolor: "background.paper",
          }}
        >
          <Box
            sx={{
              flexGrow: 1,
              maxHeight: chatTokens.composerMaxHeight,
              overflowY: "auto",
              px: 1.5,
              py: 1,
              "& .ProseMirror": {
                outline: "none",
                minHeight: 24,
                fontSize: "1rem",
                lineHeight: 1.5,
              },
              "& .ProseMirror p.is-editor-empty:first-of-type::before": {
                content: "attr(data-placeholder)",
                float: "left",
                color: "text.disabled",
                pointerEvents: "none",
                height: 0,
              },
            }}
          >
            <EditorContent editor={editor} />
          </Box>
          <IconButton
            type="button"
            color="primary"
            aria-label="Отправить сообщение"
            disabled={disabled || submitting}
            onClick={submit}
            sx={{ alignSelf: "flex-end" }}
          >
            {submitting ? <CircularProgress size={20} /> : <SendIcon />}
          </IconButton>
        </Paper>
      </Box>
    </Box>
  )
}
