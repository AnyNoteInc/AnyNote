'use client'

import { useState, type DragEvent, type MouseEvent } from 'react'
import { IconButton, Menu, MenuItem } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

export function ColumnLayoutNodeView({ editor, getPos, node }: NodeViewProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const selectRow = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
    editor.view.dispatch(tr)
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    selectRow()
  }

  const onOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    selectRow()
    setAnchor(event.currentTarget)
  }

  const closeMenu = () => setAnchor(null)

  const deleteRow = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    closeMenu()
  }

  return (
    <NodeViewWrapper
      as="div"
      data-type="column-layout"
      data-columns={String(node.childCount)}
      className={`column-layout column-layout--${node.childCount}`}
    >
      <IconButton
        className="row-drag-handle"
        size="small"
        draggable
        onDragStart={onDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onOpenMenu}
        aria-label="Действия ряда"
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>
      <NodeViewContent as="div" className="column-layout-content" />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem onClick={deleteRow}>Удалить ряд</MenuItem>
      </Menu>
    </NodeViewWrapper>
  )
}
