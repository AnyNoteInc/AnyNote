import { describe, expect, it } from 'vitest'

import { computeDeviation, formatDeviation } from '@/components/kanban/views/deviation'

describe('computeDeviation', () => {
  it('returns null when either date is missing', () => {
    expect(computeDeviation(null, new Date('2025-06-01'))).toBeNull()
    expect(computeDeviation(new Date('2025-06-01'), null)).toBeNull()
    expect(computeDeviation(null, null)).toBeNull()
  })

  it('reports late when actual is after due (Факт − План > 0)', () => {
    const d = computeDeviation(new Date('2025-06-01'), new Date('2025-06-04'))
    expect(d).toEqual({ days: 3, tone: 'late' })
  })

  it('reports early when actual is before due', () => {
    const d = computeDeviation(new Date('2025-06-05'), new Date('2025-06-03'))
    expect(d).toEqual({ days: -2, tone: 'early' })
  })

  it('reports onTime when same day (ignores time-of-day)', () => {
    const d = computeDeviation(
      new Date('2025-06-01T18:00:00'),
      new Date('2025-06-01T06:00:00'),
    )
    expect(d).toEqual({ days: 0, tone: 'onTime' })
  })
})

describe('formatDeviation', () => {
  it('formats onTime', () => {
    expect(formatDeviation({ days: 0, tone: 'onTime' })).toBe('в срок')
  })
  it('formats a late deviation with + and Russian plural', () => {
    expect(formatDeviation({ days: 1, tone: 'late' })).toBe('+1 день')
    expect(formatDeviation({ days: 3, tone: 'late' })).toBe('+3 дня')
    expect(formatDeviation({ days: 5, tone: 'late' })).toBe('+5 дней')
    expect(formatDeviation({ days: 11, tone: 'late' })).toBe('+11 дней')
  })
  it('formats an early deviation with a minus sign', () => {
    expect(formatDeviation({ days: -2, tone: 'early' })).toBe('−2 дня')
  })
})
