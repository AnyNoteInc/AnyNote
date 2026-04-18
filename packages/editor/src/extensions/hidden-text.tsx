import React, { useState } from "react"
import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import { Box, IconButton } from "@mui/material"
import VisibilityIcon from "@mui/icons-material/Visibility"
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff"

// `visible` is a LOCAL view-state only — we do not persist it. Starts visible
// on fresh insertion so the author can type, then the author hides via the eye
// icon when done. On subsequent page loads, the state is lost (React local)
// so other viewers see the intended masked default.
function HiddenTextView() {
  const [visible, setVisible] = useState(true)

  return (
    <NodeViewWrapper className="anynote-hidden-text" data-visible={visible ? "true" : "false"}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1.5,
          px: 1.5,
          py: 1,
          my: 0.5,
          transition: "border-color .15s",
          "&:hover": { borderColor: "text.secondary" },
        }}
      >
        <IconButton
          size="small"
          onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          contentEditable={false}
          aria-label={visible ? "Скрыть" : "Показать"}
          sx={{
            width: 20,
            height: 20,
            p: 0,
            mt: "2px",
            flexShrink: 0,
            color: "text.secondary",
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

export const HiddenText = Node.create({
  name: "hiddenText",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="hidden-text"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "hidden-text" }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HiddenTextView)
  },
})
