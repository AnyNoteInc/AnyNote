import type { BoardColumnRow } from '../types'

type ColumnKind = BoardColumnRow['kind']

/** Canonical display color per column kind (status family): blue / green / grey. */
export const KIND_COLORS: Record<ColumnKind, string> = {
  ACTIVE: '#3b82f6',
  DONE: '#22c55e',
  CANCELLED: '#9ca3af',
}

/** Status indicator color for a column: its custom color, else the kind default, else neutral grey. */
export function columnStatusColor(column: BoardColumnRow | undefined): string {
  if (!column) return KIND_COLORS.CANCELLED
  return column.color ?? KIND_COLORS[column.kind]
}
