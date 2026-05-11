import { describe, expect, it } from 'vitest'

import { formatHumanOffset } from '../src/reminders.ts'

describe('formatHumanOffset', () => {
  it.each([
    [0, 'в момент истечения'],
    [60, '1 час'],
    [1440, '1 день'],
    [4320, '3 дня'],
    [10080, '1 неделя'],
    [43200, '1 месяц'],
  ])('formats %d minutes as %s', (minutes, expected) => {
    expect(formatHumanOffset(minutes)).toBe(expected)
  })

  it('falls back to "напоминание" for unknown offsets', () => {
    expect(formatHumanOffset(777)).toBe('напоминание')
  })
})
