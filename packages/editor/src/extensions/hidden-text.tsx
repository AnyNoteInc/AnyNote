import React, { useState } from "react"
import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import { IconButton } from "@mui/material"
import VisibilityIcon from "@mui/icons-material/Visibility"
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff"

// `visible` is a LOCAL view-state only — we do not persist it. Every client
// starts with the content masked and reveals on their own click.
function HiddenTextView() {
  const [visible, setVisible] = useState(false)

  return (
    <NodeViewWrapper className="anynote-hidden-text" data-visible={visible}>
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
