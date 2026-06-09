import { describe, expect, it } from 'vitest'

import {
  actionLabel,
  groupRevisionsByDate,
  revisionSummary,
  type RevisionItem,
} from '@/components/page/history/revision-list'

function rev(id: string, createdAt: string, over: Partial<RevisionItem> = {}): RevisionItem {
  return { id, actorId: 'u1', action: 'EDIT', metadata: null, createdAt, ...over }
}

describe('groupRevisionsByDate', () => {
  it('buckets revisions that fall on the same calendar day into one group', () => {
    // Use local Date constructors so the grouping (which is local-day based) is
    // asserted independent of the runner's timezone.
    const groups = groupRevisionsByDate([
      rev('a', new Date(2026, 5, 9, 14, 0).toISOString()),
      rev('b', new Date(2026, 5, 9, 9, 0).toISOString()),
      rev('c', new Date(2026, 5, 7, 12, 0).toISOString()),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.items.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups[1]!.items.map((r) => r.id)).toEqual(['c'])
  })

  it('preserves the newest-first order it is given', () => {
    const groups = groupRevisionsByDate([
      rev('new', new Date(2026, 5, 9, 12, 0).toISOString()),
      rev('old', new Date(2026, 5, 1, 12, 0).toISOString()),
    ])
    expect(groups.map((g) => g.items[0]!.id)).toEqual(['new', 'old'])
  })

  it('returns no groups for an empty list', () => {
    expect(groupRevisionsByDate([])).toEqual([])
  })
})

describe('revisionSummary', () => {
  it('quotes a title from metadata', () => {
    expect(revisionSummary({ title: 'Новое имя' })).toBe('«Новое имя»')
    expect(revisionSummary({ toTitle: 'Другое' })).toBe('«Другое»')
  })

  it('falls back to a free-form summary string', () => {
    expect(revisionSummary({ summary: 'переместили' })).toBe('переместили')
  })

  it('returns null when metadata carries nothing useful', () => {
    expect(revisionSummary(null)).toBeNull()
    expect(revisionSummary({})).toBeNull()
    expect(revisionSummary('nope')).toBeNull()
  })
})

describe('actionLabel', () => {
  it('maps known actions to Russian labels', () => {
    expect(actionLabel('TITLE_CHANGE')).toBe('Переименование')
    expect(actionLabel('RESTORE')).toBe('Восстановление')
  })

  it('passes through an unknown action verbatim', () => {
    expect(actionLabel('SOMETHING')).toBe('SOMETHING')
  })
})
