import { describe, expect, it } from 'vitest'

import { computeReminderState } from './state.ts'

const now = new Date('2026-05-11T12:00:00.000Z')

describe('computeReminderState', () => {
  it('returns green when doneAt is set, regardless of timing', () => {
    expect(
      computeReminderState(
        { dueAt: '2025-01-01T00:00:00.000Z', offsets: [0], doneAt: '2026-05-11T11:00:00.000Z' },
        now,
      ),
    ).toBe('green')
  })

  it('returns gray when dueAt is empty', () => {
    expect(computeReminderState({ dueAt: '', offsets: [], doneAt: null }, now)).toBe('gray')
  })

  it('returns red when now is past dueAt', () => {
    expect(
      computeReminderState({ dueAt: '2026-05-11T11:59:00.000Z', offsets: [0], doneAt: null }, now),
    ).toBe('red')
  })

  it('returns yellow when now is between earliest offset window and dueAt', () => {
    expect(
      computeReminderState(
        { dueAt: '2026-05-11T13:00:00.000Z', offsets: [1440, 60, 0], doneAt: null },
        now,
      ),
    ).toBe('yellow')
  })

  it('returns gray when now is before earliest offset window', () => {
    expect(
      computeReminderState(
        { dueAt: '2026-05-18T12:00:00.000Z', offsets: [1440, 60, 0], doneAt: null },
        now,
      ),
    ).toBe('gray')
  })

  it('treats no offsets as instantaneous fire — yellow only at dueAt', () => {
    expect(
      computeReminderState({ dueAt: '2026-05-11T13:00:00.000Z', offsets: [], doneAt: null }, now),
    ).toBe('gray')
  })
})
