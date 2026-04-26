import type { EntityId, GenogramPageData, PersonId } from '../types'
import { assignGenerations } from './generations'
import { placeAll, type PlacementContext } from './placement'
import { buildRelations } from './relations'
import type { Bounds, LayoutResult, Point } from './types'
import { EMPTY_LAYOUT } from './types'

export function computeLayout(data: GenogramPageData): LayoutResult {
  if (Object.keys(data.entities.people).length === 0) return EMPTY_LAYOUT

  const relations = buildRelations(data)
  const generations = assignGenerations(data, relations)
  if (generations.size === 0) return EMPTY_LAYOUT

  let minGen = Number.POSITIVE_INFINITY
  for (const g of generations.values()) {
    if (g < minGen) minGen = g
  }
  if (!Number.isFinite(minGen)) return EMPTY_LAYOUT

  const positions = new Map<EntityId, Point>()
  const ctx: PlacementContext = {
    data,
    relations,
    generations,
    minGen,
    positions,
    visitedUnions: new Set(),
  }

  placeAll(ctx)

  const positionsRecord: Record<EntityId, Point> = {}
  for (const [id, pos] of positions) positionsRecord[id] = pos

  const genRecord: Record<PersonId, number> = {}
  for (const [pid, g] of generations) genRecord[pid] = g

  return {
    positions: positionsRecord,
    generations: genRecord,
    bounds: computeBounds(positions),
  }
}

function computeBounds(positions: Map<EntityId, Point>): Bounds {
  if (positions.size === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const { x, y } of positions.values()) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
