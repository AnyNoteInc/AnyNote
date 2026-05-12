'use client'

import { useState, type DragEvent, type MouseEvent } from 'react'
import { IconButton, Menu, MenuItem } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'

export function ColumnNodeView({ editor, getPos, node }: NodeViewProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const selectCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const tr = editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos))
    editor.view.dispatch(tr)
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    selectCell()
  }

  const onOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    selectCell()
    setAnchor(event.currentTarget)
  }

  const closeMenu = () => setAnchor(null)

  const deleteCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + node.nodeSize })
      .run()
    closeMenu()
  }

  const unwrapCell = () => {
    const pos = getPos()
    if (typeof pos !== 'number') return
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const $pos = state.doc.resolve(pos)
        const cell = $pos.nodeAfter
        if (!cell || cell.type.name !== 'column') return false
        tr.replaceWith(pos, pos + cell.nodeSize, cell.content)
        return true
      })
      .run()
    closeMenu()
  }

  return (
    <NodeViewWrapper as="div" data-type="column" className="column">
      <IconButton
        className="cell-drag-handle"
        size="small"
        draggable
        onDragStart={onDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onOpenMenu}
        aria-label="Действия ячейки"
      >
        <DragIndicatorIcon fontSize="inherit" />
      </IconButton>
      <NodeViewContent as="div" className="column-content" />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu}>
        <MenuItem onClick={deleteCell}>Удалить ячейку</MenuItem>
        <MenuItem onClick={unwrapCell}>Развернуть ячейку в блоки</MenuItem>
      </Menu>
    </NodeViewWrapper>
  )
}
