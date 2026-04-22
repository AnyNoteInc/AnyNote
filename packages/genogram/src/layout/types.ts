import type { EntityId, PersonId } from "../types"

export interface Point {
  x: number
  y: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutResult {
  positions: Record<EntityId, Point>
  generations: Record<PersonId, number>
  bounds: Bounds
}

export const EMPTY_LAYOUT: LayoutResult = {
  positions: {},
  generations: {},
  bounds: { x: 0, y: 0, width: 0, height: 0 },
}
