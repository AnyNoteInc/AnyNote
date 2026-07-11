'use client'

import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { offset } from '@floating-ui/dom'
import AddIcon from '@mui/icons-material/Add'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import { Box, IconButton } from '@mui/material'
import type { Editor } from '@tiptap/core'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as PMNode } from '@tiptap/pm/model'

import { DragHandleMenu } from './drag-handle-menu'
import { dragHandleCrossAxis } from './drag-handle-position'
import { excludeColumnNodes, excludeFirstContainerChild } from './drag-handle-rules'

// `edgeDetection: 'none'` disables the 12px band where deeper nodes lose score
// near their left edge. With it on, mousing from an inner block toward the
// handle (which sits in the gutter) would flip the target to the parent mid-
// motion, so the handle would jump to the outer container before the cursor
// even reached it.
const nestedOptions = {
  rules: [excludeColumnNodes, excludeFirstContainerChild],
  edgeDetection: 'none' as const,
}

// Horizontal gap between the controls and the block's text edge. The default
// left-start placement puts the handle flush against the text (gap 0).
const GAP_FROM_TEXT_PX = 10

type Props = {
  editor: Editor
  onRequestBlockMove?: (pos: number) => void
}

type HoverNodePos = {
  from: number
  to: number
  isEmpty: boolean
} | null

export function EditorDragHandle({ editor, onRequestBlockMove }: Props) {
  const hoverNodeRef = useRef<HoverNodePos>(null)
  const hoverDomRef = useRef<HTMLElement | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPos, setMenuPos] = useState<number | null>(null)

  // Referentially stable: the react wrapper re-registers the whole PM plugin
  // whenever this prop's identity changes. The plugin invokes onNodeChange
  // right before repositioning, so hoverDomRef is fresh when the middleware
  // runs. mainAxis pushes the handle away from the text; crossAxis re-centers
  // it on the block's first rendered line (left-start top-aligns by default).
  const computePositionConfig = useMemo(
    () => ({
      placement: 'left-start' as const,
      strategy: 'absolute' as const,
      middleware: [
        offset(({ rects }) => ({
          mainAxis: GAP_FROM_TEXT_PX,
          crossAxis: dragHandleCrossAxis(hoverDomRef.current, rects.floating.height),
        })),
      ],
    }),
    [],
  )

  // Both plugin callbacks are useCallback'd for the same reason the position
  // config is memoized: a fresh identity makes the react wrapper tear down and
  // re-register the PM plugin, which resets the handle to visibility:hidden
  // until the next mousemove.
  const onNodeChange = useCallback(
    ({ node, pos }: { node: PMNode | null; editor: Editor; pos: number }) => {
      if (!node) {
        hoverNodeRef.current = null
        hoverDomRef.current = null
        return
      }
      const dom = editor.view.nodeDOM(pos)
      hoverDomRef.current = dom instanceof HTMLElement ? dom : null
      hoverNodeRef.current = {
        from: pos,
        to: pos + node.nodeSize,
        isEmpty: node.textContent.length === 0,
      }
    },
    [editor],
  )

  const onElementDragStart = useCallback(
    (event: DragEvent) => {
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
    },
    [editor],
  )

  const openSlashMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const info = hoverNodeRef.current
    if (!info) return
    const alt = event.altKey
    const chain = editor.chain().focus()
    if (alt) {
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
        computePositionConfig={computePositionConfig}
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
            <AddIcon fontSize="medium" />
          </IconButton>
          <IconButton
            size="small"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={openBlockMenu}
            sx={{ p: 0.25, cursor: 'grab', color: 'text.secondary' }}
            aria-label="Действия блока"
          >
            <DragIndicatorIcon fontSize="medium" />
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
