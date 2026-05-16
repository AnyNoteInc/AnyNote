import { describe, expect, it } from 'vitest'

import { pluralizeRu } from '@/components/kanban/sprint/pluralize-ru'

const FORMS: [string, string, string] = ['задача', 'задачи', 'задач']

describe('pluralizeRu', () => {
  it('returns form-0 (singular) for 1 and 21', () => {
    expect(pluralizeRu(1, FORMS)).toBe('задача')
    expect(pluralizeRu(21, FORMS)).toBe('задача')
  })

  it('returns form-1 (paucal) for 2-4, 22-24', () => {
    expect(pluralizeRu(2, FORMS)).toBe('задачи')
    expect(pluralizeRu(3, FORMS)).toBe('задачи')
    expect(pluralizeRu(4, FORMS)).toBe('задачи')
    expect(pluralizeRu(22, FORMS)).toBe('задачи')
  })

  it('returns form-2 (plural) for 0, 5-20, 25', () => {
    expect(pluralizeRu(0, FORMS)).toBe('задач')
    expect(pluralizeRu(5, FORMS)).toBe('задач')
    expect(pluralizeRu(11, FORMS)).toBe('задач')
    expect(pluralizeRu(14, FORMS)).toBe('задач')
    expect(pluralizeRu(20, FORMS)).toBe('задач')
    expect(pluralizeRu(25, FORMS)).toBe('задач')
  })

  it('handles teens (11-14) with form-2 not form-1', () => {
    expect(pluralizeRu(11, FORMS)).toBe('задач')
    expect(pluralizeRu(12, FORMS)).toBe('задач')
    expect(pluralizeRu(13, FORMS)).toBe('задач')
    expect(pluralizeRu(14, FORMS)).toBe('задач')
  })
})
