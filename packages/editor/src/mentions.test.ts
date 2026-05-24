import { describe, expect, it } from 'vitest'

import { filterMentionItems } from './mentions'

const members = [
  { id: 'u-1', name: 'Анна Иванова', email: 'anna@example.com' },
  { id: 'u-2', name: 'Victor Stone', email: 'victor@example.com' },
  { id: 'u-3', name: 'Мария Петрова', email: null },
]

describe('filterMentionItems', () => {
  it('returns workspace members matching name or email', () => {
    expect(filterMentionItems(members, 'vic')).toEqual([
      { id: 'u-2', label: 'Victor Stone', email: 'victor@example.com' },
    ])
    expect(filterMentionItems(members, 'anna@')).toEqual([
      { id: 'u-1', label: 'Анна Иванова', email: 'anna@example.com' },
    ])
  })

  it('limits empty mention suggestions to the first 8 members', () => {
    const many = Array.from({ length: 12 }, (_, idx) => ({
      id: `u-${idx}`,
      name: `User ${idx}`,
      email: null,
    }))

    expect(filterMentionItems(many, '')).toHaveLength(8)
  })
})
