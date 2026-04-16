"use client"

import DragIndicatorIcon from "@mui/icons-material/DragIndicator"
import { Box } from "@mui/material"
import type { Editor } from "@tiptap/core"
import DragHandle from "@tiptap/extension-drag-handle-react"

type Props = { editor: Editor }

export function EditorDragHandle({ editor }: Props) {
  return (
    <DragHandle editor={editor}>
      <Box
        sx={{
          color: "text.disabled",
          cursor: "grab",
          display: "inline-flex",
          alignItems: "center",
          px: 0.5,
        }}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
    </DragHandle>
  )
}
