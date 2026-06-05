import { describe, it, expect } from 'vitest'

import { SUBTASK_FORMS } from '@/components/kanban/components/parent-badge'
import { pluralizeRu } from '@/components/kanban/lib/pluralize-ru'

describe('SUBTASK_FORMS', () => {
  it('produces correct Russian plural forms via pluralizeRu', () => {
    expect(pluralizeRu(1, SUBTASK_FORMS)).toBe('подзадача')
    expect(pluralizeRu(2, SUBTASK_FORMS)).toBe('подзадачи')
    expect(pluralizeRu(3, SUBTASK_FORMS)).toBe('подзадачи')
    expect(pluralizeRu(5, SUBTASK_FORMS)).toBe('подзадач')
    expect(pluralizeRu(11, SUBTASK_FORMS)).toBe('подзадач')
    expect(pluralizeRu(21, SUBTASK_FORMS)).toBe('подзадача')
    expect(pluralizeRu(22, SUBTASK_FORMS)).toBe('подзадачи')
    expect(pluralizeRu(25, SUBTASK_FORMS)).toBe('подзадач')
  })
})
