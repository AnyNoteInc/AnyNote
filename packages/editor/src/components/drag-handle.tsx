"use client"

import { useRef, type MouseEvent } from "react"
import AddIcon from "@mui/icons-material/Add"
import DragIndicatorIcon from "@mui/icons-material/DragIndicator"
import { Box, IconButton } from "@mui/material"
import type { Editor } from "@tiptap/core"
import DragHandle from "@tiptap/extension-drag-handle-react"
import type { Node as PMNode } from "@tiptap/pm/model"

type Props = { editor: Editor }

type HoverNodePos = { from: number; to: number; isEmpty: boolean } | null

export function EditorDragHandle({ editor }: Props) {
  const hoverNodeRef = useRef<HoverNodePos>(null)

  const onNodeChange = ({ node, pos }: { node: PMNode | null; editor: Editor; pos: number }) => {
    if (!node) {
      hoverNodeRef.current = null
      return
    }
    hoverNodeRef.current = {
      from: pos,
      to: pos + node.nodeSize,
      isEmpty: node.textContent.length === 0,
    }
  }

  const onElementDragStart = (event: DragEvent) => {
    const info = hoverNodeRef.current
    if (!info || !event.dataTransfer) return
    const dom = editor.view.nodeDOM(info.from) as HTMLElement | null
    if (!dom) return
    const rect = dom.getBoundingClientRect()
    // Upstream's dragHandler builds an off-screen clone wrapper and anchors
    // the drag image via `event.clientX - wrapperRect.left`. Because the
    // wrapper sits at body.left ≈ 0, the preview jumps to the viewport's
    // left edge whenever the block lives in the centered reading column.
    // Shadow setDragImage so the library's call re-anchors to the *original*
    // block's rect — the ghost then stays under the cursor where it was
    // grabbed.
    const nativeSet = event.dataTransfer.setDragImage.bind(event.dataTransfer)
    Object.defineProperty(event.dataTransfer, "setDragImage", {
      configurable: true,
      value: (image: Element) => {
        const width = (image as HTMLElement).getBoundingClientRect().width || rect.width
        const x = Math.max(0, Math.min(event.clientX - rect.left, width))
        const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
        nativeSet(image, x, y)
      },
    })
  }

  const openSlashMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const info = hoverNodeRef.current
    if (!info) return
    const alt = event.altKey
    const chain = editor.chain().focus()
    if (alt) {
      // Insert empty paragraph above the hovered node, then slash
      chain
        .insertContentAt(info.from, { type: "paragraph" })
        .setTextSelection(info.from + 1)
        .insertContent("/")
        .run()
      return
    }
    if (info.isEmpty) {
      chain
        .setTextSelection(info.from + 1)
        .insertContent("/")
        .run()
      return
    }
    // Non-empty: put cursor at end of node and insert new paragraph below
    chain
      .setTextSelection(info.to - 1)
      .insertContentAt(info.to, { type: "paragraph" })
      .setTextSelection(info.to + 1)
      .insertContent("/")
      .run()
  }

  return (
    <DragHandle editor={editor} onNodeChange={onNodeChange} onElementDragStart={onElementDragStart}>
      <Box
        className="tiptap-drag-handle-wrapper"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.25,
          color: "text.disabled",
        }}
      >
        <IconButton
          size="small"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={openSlashMenu}
          sx={{ p: 0.25, color: "text.secondary" }}
          aria-label="Добавить блок"
        >
          <AddIcon fontSize="small" />
        </IconButton>
        <Box sx={{ cursor: "grab", display: "inline-flex", alignItems: "center", p: 0.25 }}>
          <DragIndicatorIcon fontSize="small" />
        </Box>
      </Box>
    </DragHandle>
  )
}
