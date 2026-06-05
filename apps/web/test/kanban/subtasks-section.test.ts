import { describe, it, expect } from 'vitest'

import { childStatusColor } from '@/components/kanban/task/subtasks-section'
import type { BoardColumnRow } from '@/components/kanban/types'

function column(id: string, kind: BoardColumnRow['kind'], color: string | null): BoardColumnRow {
  return { id, pageId: 'p1', title: id, kind, position: 0, color }
}

describe('childStatusColor', () => {
  it('prefers the column custom color', () => {
    expect(childStatusColor(column('c', 'ACTIVE', '#abcdef'))).toBe('#abcdef')
  })

  it('falls back to kind default when no color', () => {
    expect(childStatusColor(column('c', 'DONE', null))).toBe('#22c55e')
    expect(childStatusColor(column('c', 'ACTIVE', null))).toBe('#3b82f6')
    expect(childStatusColor(column('c', 'CANCELLED', null))).toBe('#9ca3af')
  })

  it('falls back to a neutral grey when the column is missing', () => {
    expect(childStatusColor(undefined)).toBe('#9ca3af')
  })
})
