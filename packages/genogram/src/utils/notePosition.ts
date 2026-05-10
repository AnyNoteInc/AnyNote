import type { LayoutResult } from '../layout/types'
import { LAYOUT } from '../layout/constants'

/**
 * Approximate annotation node footprint in flow units. Matches the
 * AnnotationNode rendering (maxWidth=200, padding=4×8, fontSize=9 with
 * line-height 1.3 leaving room for two short lines).
 */
const NOTE_BBOX = { width: 220, height: 56 }

/**
 * Conservative half-extent used to test "does this proposed note overlap a
 * genogram entity at position p?". The largest entity is PERSON_BIG (80
 * across); using its half-width as a uniform expansion keeps the safety
 * check cheap without per-entity type lookups.
 */
const ENTITY_HALF = LAYOUT.PERSON_BIG / 2

/**
 * Pick a position for a brand-new annotation that doesn't sit on top of any
 * existing genogram element.
 *
 * If the user-supplied `preferred` position already sits on empty pane (the
 * note's bounding box clears every entity's bbox), we return it unchanged so
 * double-click placements stay where the user clicked. Otherwise we drop
 * the note into the empty band right below the layout's bottom edge — this
 * area is reliably free because it's outside the laid-out subtree and the
 * Y bound is computed from real entity positions.
 */
export function findSafeNotePosition(
  preferred: { x: number; y: number },
  layout: LayoutResult,
): { x: number; y: number } {
  if (!overlapsAnyEntity(preferred, layout)) {
    return preferred
  }
  return {
    x: layout.bounds.x,
    y: layout.bounds.y + layout.bounds.height + LAYOUT.SIBLING_GAP,
  }
}

function overlapsAnyEntity(
  topLeft: { x: number; y: number },
  layout: LayoutResult,
): boolean {
  const noteRight = topLeft.x + NOTE_BBOX.width
  const noteBottom = topLeft.y + NOTE_BBOX.height
  for (const p of Object.values(layout.positions)) {
    const eLeft = p.x - ENTITY_HALF
    const eRight = p.x + ENTITY_HALF
    const eTop = p.y - ENTITY_HALF
    const eBottom = p.y + ENTITY_HALF
    const overlapsX = topLeft.x < eRight && noteRight > eLeft
    const overlapsY = topLeft.y < eBottom && noteBottom > eTop
    if (overlapsX && overlapsY) return true
  }
  return false
}
