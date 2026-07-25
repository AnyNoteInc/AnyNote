'use client'

import { useRef, type KeyboardEvent } from 'react'

import { Box } from '@repo/ui/components'

import { useDragResize } from '@/lib/use-drag-resize'

const KEYBOARD_STEP = 16

type Props = Readonly<{
  /** Which edge of the host panel the handle sits on: 'right' for the left
   *  workspace sidebar (drag right widens), 'left' for the right chat panel
   *  (drag left widens). The host must be `position: relative`. */
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  /** Pointer drag began — hosts disable their width transitions here (one
   *  render per drag instead of one per pixel). Not fired for keyboard steps. */
  onDragStart?: () => void
  /** Live width while dragging: called at most once per animation frame.
   *  Apply it imperatively (element style / CSS variable) — routing this into
   *  setState re-renders the whole panel subtree on every frame. */
  onWidth: (next: number) => void
  /** Final width on pointer-up / keyboard step — persist here. */
  onCommit: (final: number) => void
  ariaLabel: string
  testId?: string
}>

/** Invisible-until-hover vertical drag strip that resizes its host panel.
 *  Pointer-captured drag + arrow-key resize (role="separator"). */
export function PanelResizeHandle({
  edge,
  width,
  min,
  max,
  onDragStart,
  onWidth,
  onCommit,
  ariaLabel,
  testId,
}: Props) {
  const widthRef = useRef(width)
  widthRef.current = width

  const drag = useDragResize({
    min,
    max,
    direction: edge === 'right' ? 1 : -1,
    getBaseWidth: () => widthRef.current,
    onDragStart,
    onLiveWidth: onWidth,
    onCommit,
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    // The key that points AWAY from the panel widens it.
    const towardsPanel = event.key === 'ArrowLeft' ? edge === 'right' : edge === 'left'
    const next = drag.clamp(widthRef.current + (towardsPanel ? -KEYBOARD_STEP : KEYBOARD_STEP))
    onWidth(next)
    onCommit(next)
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={testId}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerUp}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [edge]: -3,
        width: 7,
        cursor: 'col-resize',
        zIndex: 30,
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
