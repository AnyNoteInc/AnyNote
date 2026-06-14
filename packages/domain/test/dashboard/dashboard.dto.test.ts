import { describe, it, expect } from 'vitest'

import { globalFilterInputSchema } from '../../src/dashboard/dto/dashboard.dto.ts'
import { filterOperatorSchema } from '../../src/database/index.ts'

// FIX 3: a persisted global filter's `operator` must be the SAME strict enum a
// FilterCondition uses. An unvalidated `z.string()` would let an invalid
// operator through, where it silently becomes a no-op in the planner
// (`default: return null`). The schema must reject it at the boundary instead.

describe('globalFilterInputSchema.operator validation', () => {
  it('rejects an operator that is not a known filter operator', () => {
    const result = globalFilterInputSchema.safeParse({
      propertyName: 'Статус',
      operator: 'not_a_real_operator',
      value: 'x',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a structurally-valid-but-unsupported operator (e.g. SQL-ish)', () => {
    const result = globalFilterInputSchema.safeParse({
      propertyName: 'Оценка',
      operator: 'LIKE',
    })
    expect(result.success).toBe(false)
  })

  it('accepts every operator the filter-condition enum allows', () => {
    for (const op of filterOperatorSchema.options) {
      const result = globalFilterInputSchema.safeParse({
        propertyName: 'Статус',
        operator: op,
        value: 'x',
      })
      expect(result.success, `operator "${op}" should be accepted`).toBe(true)
    }
  })

  it('keeps the rest of the global-filter shape (value optional)', () => {
    const result = globalFilterInputSchema.safeParse({
      propertyName: 'Статус',
      operator: filterOperatorSchema.options[0],
    })
    expect(result.success).toBe(true)
  })
})
