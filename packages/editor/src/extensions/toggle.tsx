import { Node, mergeAttributes } from "@tiptap/core"
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { IconButton } from "@mui/material"
import ArrowRightOutlinedIcon from "@mui/icons-material/ArrowRightOutlined"

function ToggleView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open !== false

  const handleToggle = (event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    updateAttributes({ open: !open })
  }

  return (
    <NodeViewWrapper className="anynote-toggle" data-open={open}>
      <IconButton
        size="small"
        onMouseDown={(e: ReactMouseEvent<HTMLButtonElement>) => e.preventDefault()}
        onClick={handleToggle}
        contentEditable={false}
        className="anynote-toggle-arrow"
        aria-label={open ? "Свернуть" : "Развернуть"}
        sx={{
          width: 20,
          height: 20,
          p: 0,
          mt: "2px",
          transform: open ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 120ms",
          color: "text.secondary",
        }}
      >
        <ArrowRightOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <NodeViewContent className="anynote-toggle-content" as="div" />
    </NodeViewWrapper>
  )
}

export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-open") !== "false",
        renderHTML: (attrs) => ({ "data-open": String(Boolean(attrs.open)) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "toggle" }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView)
  },

  addKeyboardShortcuts() {
    return {
      // If user presses Enter at the end of the first-child paragraph while the
      // toggle is collapsed, expand it so the new paragraph is visible.
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.type.name !== "toggle") continue
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
