import { describe, it, expect } from 'vitest'
import { resolveAddSprintId } from '@/components/kanban/lib/resolve-add-sprint'

const sprints = [
  { id: 's-active', status: 'ACTIVE' },
  { id: 's-plan', status: 'PLANNED' },
]

describe('resolveAddSprintId', () => {
  it('returns the chosen sprint id for a specific filter', () => {
    expect(resolveAddSprintId(['s-plan'], sprints)).toBe('s-plan')
  })
  it('returns the active sprint id for "current"', () => {
    expect(resolveAddSprintId('current', sprints)).toBe('s-active')
  })
  it('returns undefined for "all"', () => {
    expect(resolveAddSprintId('all', sprints)).toBeUndefined()
  })
  it('returns undefined for "current" when no active sprint', () => {
    expect(resolveAddSprintId('current', [{ id: 's-plan', status: 'PLANNED' }])).toBeUndefined()
  })
  it('returns undefined for a multi-select filter (ambiguous)', () => {
    expect(resolveAddSprintId(['s-plan', 's-active'], sprints)).toBeUndefined()
  })
})
