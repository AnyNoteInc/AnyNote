import { describe, it, expect } from 'vitest'
import { selectionReducer } from '@/components/kanban/selection/selection-context'

describe('selectionReducer', () => {
  it('toggles a task id on and off', () => {
    const a = selectionReducer(new Set<string>(), { type: 'toggle', id: 't1' })
    expect(a.has('t1')).toBe(true)
    const b = selectionReducer(a, { type: 'toggle', id: 't1' })
    expect(b.has('t1')).toBe(false)
  })
  it('clears all', () => {
    const a = new Set(['t1', 't2'])
    expect(selectionReducer(a, { type: 'clear' }).size).toBe(0)
  })
  it('sets an explicit selection', () => {
    const a = selectionReducer(new Set(), { type: 'set', ids: ['t3', 't4'] })
    expect([...a].sort()).toEqual(['t3', 't4'])
  })
})
