'use client'

import { useRef, useState, type MouseEvent } from 'react'
import AddIcon from '@mui/icons-material/Add'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { Box, IconButton } from '@mui/material'
import type { Editor } from '@tiptap/core'
import type { DragHandleRule } from '@tiptap/extension-drag-handle'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'

import { DragHandleMenu } from './drag-handle-menu'

const CONTAINER_TYPES = ['callout', 'toggle', 'hiddenText']

// First child of a container block is not independently draggable — dragging
// the first row should pick the parent container instead. Mirrors the library's
// built-in `listItemFirstChild` rule but for our block types.
const firstChildOfContainer: DragHandleRule = {
  id: 'firstChildOfContainer',
  evaluate: ({ parent, isFirst }) => {
    if (!isFirst || !parent) return 0
    return CONTAINER_TYPES.includes(parent.type.name) ? 1000 : 0
  },
}

// `edgeDetection: 'none'` disables the 12px band where deeper nodes lose score
// near their left edge. With it on, mousing from an inner block toward the
// handle (which sits in the gutter) would flip the target to the parent mid-
// motion, so the handle would jump to the outer container before the cursor
// even reached it.
const nestedOptions = { rules: [firstChildOfContainer], edgeDetection: 'none' as const }

type Props = {
  editor: Editor
  onRequestBlockMove?: (pos: number) => void
}

type HoverKind = 'block' | 'cell'

type HoverNodePos = {
  from: number
  to: number
  isEmpty: boolean
  kind: HoverKind
  rowFrom?: number
  rowTo?: number
  cellIndex?: number
} | null

export function EditorDragHandle({ editor, onRequestBlockMove }: Props) {
  const hoverNodeRef = useRef<HoverNodePos>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPos, setMenuPos] = useState<number | null>(null)

  const onNodeChange = ({
    node,
    pos,
    editor: ed,
  }: {
    node: PMNode | null
    editor: Editor
    pos: number
  }) => {
    if (!node) {
      hoverNodeRef.current = null
      return
    }
    let kind: HoverKind = 'block'
    let rowFrom: number | undefined
    let rowTo: number | undefined
    let cellIndex: number | undefined
    const $pos = ed.state.doc.resolve(pos + 1)
    for (let d = $pos.depth; d >= 0; d--) {
      const ancestor = $pos.node(d)
      if (ancestor.type.name === 'columnLayout') {
        kind = 'cell'
        rowFrom = $pos.before(d)
        rowTo = rowFrom + ancestor.nodeSize
        cellIndex = $pos.index(d)
        break
      }
    }
    hoverNodeRef.current = {
      from: pos,
      to: pos + node.nodeSize,
      isEmpty: node.textContent.length === 0,
      kind,
      rowFrom,
      rowTo,
      cellIndex,
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
    Object.defineProperty(event.dataTransfer, 'setDragImage', {
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
        .insertContentAt(info.from, { type: 'paragraph' })
        .setTextSelection(info.from + 1)
        .insertContent('/')
        .run()
      return
    }
    if (info.isEmpty) {
      chain
        .setTextSelection(info.from + 1)
        .insertContent('/')
        .run()
      return
    }
    // Non-empty: put cursor at end of node and insert new paragraph below
    chain
      .setTextSelection(info.to - 1)
      .insertContentAt(info.to, { type: 'paragraph' })
      .setTextSelection(info.to + 1)
      .insertContent('/')
      .run()
  }

  const openBlockMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const info = hoverNodeRef.current
    if (!info) return
    setMenuAnchor(event.currentTarget)
    setMenuPos(info.from)
  }

  const closeBlockMenu = () => {
    setMenuAnchor(null)
    setMenuPos(null)
  }

  return (
    <>
      <DragHandle
        editor={editor}
        nested={nestedOptions}
        onNodeChange={onNodeChange}
        onElementDragStart={onElementDragStart}
      >
        <Box
          className="tiptap-drag-handle-wrapper"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            color: 'text.disabled',
          }}
        >
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openSlashMenu}
            sx={{ p: 0.25, color: 'text.secondary' }}
            aria-label="Добавить блок"
          >
            <AddIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openBlockMenu}
            sx={{ p: 0.25, cursor: 'grab', color: 'text.secondary' }}
            aria-label="Действия блока"
          >
            <DragIndicatorIcon fontSize="small" />
          </IconButton>
        </Box>
      </DragHandle>
      <DragHandleMenu
        editor={editor}
        anchorEl={menuAnchor}
        pos={menuPos}
        onClose={closeBlockMenu}
        onRequestMove={onRequestBlockMove ?? (() => undefined)}
      />
    </>
  )
}
