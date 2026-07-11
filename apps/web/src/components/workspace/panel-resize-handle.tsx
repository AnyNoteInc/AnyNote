'use client'

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { Box } from '@repo/ui/components'

const KEYBOARD_STEP = 16

type Props = Readonly<{
  /** Which edge of the host panel the handle sits on: 'right' for the left
   *  workspace sidebar (drag right widens), 'left' for the right chat panel
   *  (drag left widens). The host must be `position: relative`. */
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  /** Live width updates while dragging (state only — do not persist here). */
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
  onWidth,
  onCommit,
  ariaLabel,
  testId,
}: Props) {
  const dragRef = useRef<{ startX: number; startWidth: number; current: number } | null>(null)
  const widthRef = useRef(width)
  widthRef.current = width

  const clamp = (value: number) => Math.min(max, Math.max(min, value))

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault()
    dragRef.current = {
      startX: event.clientX,
      startWidth: widthRef.current,
      current: widthRef.current,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const delta = event.clientX - drag.startX
    const next = clamp(edge === 'right' ? drag.startWidth + delta : drag.startWidth - delta)
    if (next !== drag.current) {
      drag.current = next
      onWidth(next)
    }
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onCommit(drag.current)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    // The key that points AWAY from the panel widens it.
    const towardsPanel = event.key === 'ArrowLeft' ? edge === 'right' : edge === 'left'
    const next = clamp(widthRef.current + (towardsPanel ? -KEYBOARD_STEP : KEYBOARD_STEP))
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
