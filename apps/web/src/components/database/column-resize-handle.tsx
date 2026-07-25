'use client'

import { useRef, type KeyboardEvent } from 'react'

import { Box } from '@repo/ui/components'

import { useDragResize } from '@/lib/use-drag-resize'

const MIN_WIDTH = 80
const MAX_WIDTH = 1200
const KEYBOARD_STEP = 16

type Props = Readonly<{
  /** The committed column width from view settings; undefined = automatic. */
  width: number | undefined
  /** Live width while dragging: rAF-coalesced (see `useDragResize`). */
  onLiveWidth: (next: number) => void
  /** Final width on pointer-up / keyboard step — persist here. */
  onCommit: (final: number) => void
  /** Double-click resets the column back to automatic sizing. */
  onReset: () => void
  ariaLabel: string
}>

/**
 * Vertical drag strip on the right edge of a table HEADER cell that resizes its
 * column. An automatic column has no numeric width, so the drag baseline is the
 * cell's rendered width (measured on interaction). Double-click returns the
 * column to automatic sizing. Drag machinery shared with `PanelResizeHandle`
 * via `useDragResize`.
 */
export function ColumnResizeHandle({ width, onLiveWidth, onCommit, onReset, ariaLabel }: Props) {
  const widthRef = useRef(width)
  widthRef.current = width

  /** Automatic columns have no stored width — fall back to the rendered one. */
  const baseWidth = (handle: HTMLElement): number => {
    if (widthRef.current !== undefined) return widthRef.current
    const cell = handle.closest('th,td')
    return cell ? Math.round(cell.getBoundingClientRect().width) : MIN_WIDTH
  }

  const drag = useDragResize({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    getBaseWidth: baseWidth,
    onLiveWidth,
    onCommit,
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP
    const next = drag.clamp(baseWidth(event.currentTarget) + step)
    onLiveWidth(next)
    onCommit(next)
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={width === undefined ? undefined : Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        event.stopPropagation()
        drag.onPointerDown(event)
      }}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset()
      }}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        // Fully inside its own cell: a sticky header cell is a stacking context,
        // so any overhang into the NEXT cell would be painted over (and made
        // unclickable) by that cell.
        right: 0,
        width: 8,
        cursor: 'col-resize',
        zIndex: 3,
        touchAction: 'none',
        borderRadius: 1,
        '&:hover, &:focus-visible, &:active': {
          bgcolor: 'primary.main',
          opacity: 0.2,
          outline: 'none',
        },
      }}
    />
  )
}
