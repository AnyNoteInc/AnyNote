'use client'

import { useEffect, useRef, type PointerEvent } from 'react'

interface DragResizeOptions {
  min: number
  max: number
  /** +1 when dragging right widens the host, -1 when dragging left widens. */
  direction?: 1 | -1
  /** Resolve the width the drag starts from (state or a DOM measurement). */
  getBaseWidth: (handle: HTMLElement) => number
  /** Pointer drag began — hosts disable their width transitions here. */
  onDragStart?: () => void
  /** Live width while dragging: called at most once per animation frame. */
  onLiveWidth: (next: number) => void
  /** Final width on pointer-up — persist here. */
  onCommit: (final: number) => void
}

/**
 * Shared pointer machinery for horizontal resize handles: pointer capture,
 * rAF-coalesced live updates, flush-before-commit on release. Extracted from
 * `PanelResizeHandle` so panel and table-column handles share one drag state
 * machine instead of drifting copies. Keyboard handling stays per-component
 * (the key→direction mapping differs); `clamp` is exposed for it.
 */
export function useDragResize({
  min,
  max,
  direction = 1,
  getBaseWidth,
  onDragStart,
  onLiveWidth,
  onCommit,
}: DragResizeOptions) {
  const dragRef = useRef<{ startX: number; startWidth: number; current: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  const cancelPendingFrame = () => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  // A drag can outlive the component (unmount mid-drag) — drop the pending
  // frame so it can't fire onLiveWidth against a torn-down host.
  useEffect(() => cancelPendingFrame, [])

  const clamp = (value: number) => Math.min(max, Math.max(min, value))

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault()
    const startWidth = getBaseWidth(event.currentTarget)
    dragRef.current = { startX: event.clientX, startWidth, current: startWidth }
    onDragStart?.()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // No active pointer (synthetic events) — the drag still works while the
      // pointer stays over the handle.
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const next = clamp(drag.startWidth + direction * (event.clientX - drag.startX))
    if (next === drag.current) return
    drag.current = next
    // Coalesce pointermove bursts (high-rate mice report >60Hz) to one live
    // width application per frame.
    rafRef.current ??= window.requestAnimationFrame(() => {
      rafRef.current = null
      const live = dragRef.current
      if (live) onLiveWidth(live.current)
    })
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    cancelPendingFrame()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // A zero-move press is not a resize — committing it would fire a pointless
    // persist, and on a double-click the two press-commits would race the
    // reset mutation.
    if (drag.current === drag.startWidth) return
    // Flush the last live value BEFORE committing so the imperative DOM width
    // can never lag one frame behind the committed state.
    onLiveWidth(drag.current)
    onCommit(drag.current)
  }

  return { onPointerDown, onPointerMove, onPointerUp, clamp }
}
