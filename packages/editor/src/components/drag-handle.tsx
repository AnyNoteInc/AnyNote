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
      chain.setTextSelection(info.from + 1).insertContent("/").run()
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
    <DragHandle editor={editor} onNodeChange={onNodeChange}>
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
