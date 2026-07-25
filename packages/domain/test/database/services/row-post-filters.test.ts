import { describe, expect, it, vi } from 'vitest'

import { DatabasePropertyType } from '@repo/db'

import type { FilterGroup } from '../../../src/database/dto/database.dto.ts'
import type { RowWithPage } from '../../../src/database/repositories/database.repository.ts'
import { applyResidualFilter } from '../../../src/database/services/row-post-filters.ts'
import type { PropertyMeta } from '../../../src/database/services/query-planner.ts'

const properties: PropertyMeta[] = [
  { id: 'text', type: DatabasePropertyType.TEXT },
  { id: 'money', type: DatabasePropertyType.MONEY },
  { id: 'date', type: DatabasePropertyType.DATE },
  { id: 'tags', type: DatabasePropertyType.MULTI_SELECT },
  { id: 'relation', type: DatabasePropertyType.RELATION },
  { id: 'formula', type: DatabasePropertyType.FORMULA },
  { id: 'rollup', type: DatabasePropertyType.ROLLUP },
]

function row(id: string, title: string | null, values: Record<string, unknown> = {}): RowWithPage {
  return {
    id,
    pageId: `${id}-page`,
    position: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdById: 'owner',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedById: 'owner',
    page: { title, icon: null },
    cells: Object.entries(values).map(([propertyId, value]) => ({ propertyId, value })),
  }
}

function repo(links = new Map<string, string[]>()) {
  return {
    findRelationLinks: vi.fn(async () => links),
  }
}

describe('applyResidualFilter', () => {
  it('keeps OR semantics across scalar and MULTI_SELECT leaves', async () => {
    const rows = [
      row('rent-row', 'Аренда склада', { tags: ['business'] }),
      row('groceries-row', 'Покупки', { tags: ['food', 'home'] }),
      row('other-row', 'Заметка', { tags: ['home'] }),
    ]
    const filter: FilterGroup = {
      conjunction: 'or',
      conditions: [
        { propertyId: '__title__', operator: 'starts_with', value: 'Аренда' },
        { propertyId: 'tags', operator: 'contains_all', value: ['food', 'home'] },
      ],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['rent-row', 'groceries-row'])
  })

  it('prunes computed leaves without changing nested residual group semantics', async () => {
    const rows = [
      row('matching', 'Покупки', { tags: ['food', 'home'] }),
      row('not-matching', 'Заметка', { tags: ['home'] }),
    ]
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: 'formula', operator: 'equals', value: 'ignored' },
        {
          conjunction: 'or',
          conditions: [
            { propertyId: 'rollup', operator: 'equals', value: 'ignored' },
            { propertyId: 'tags', operator: 'contains_all', value: ['food', 'home'] },
          ],
        },
      ],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['matching'])
  })

  it('preserves nested AND/OR groups', async () => {
    const rows = [
      row('matching-number', 'Альфа', { text: 'draft', money: 15_000 }),
      row('matching-text', 'Бета', { text: 'ready', money: 500 }),
      row('wrong-title', 'Гамма', { text: 'ready', money: 15_000 }),
      row('wrong-leaves', 'Альфа 2', { text: 'draft', money: 500 }),
    ]
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: '__title__', operator: 'starts_with', value: 'Альфа' },
        {
          conjunction: 'or',
          conditions: [
            { propertyId: 'money', operator: 'gte', value: 10_000 },
            { propertyId: 'text', operator: 'equals', value: 'ready' },
          ],
        },
      ],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['matching-number'])
  })

  it('evaluates inverted string operators for titles and string cells', async () => {
    const rows = [
      row('keep', 'Документ 2026', { text: 'published' }),
      row('wrong-title', 'Черновик', { text: 'published' }),
      row('wrong-cell', 'Документ 2026', { text: 'draft-copy' }),
    ]
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: '__title__', operator: 'not_starts_with', value: 'Черн' },
        { propertyId: '__title__', operator: 'not_ends_with', value: '2025' },
        { propertyId: 'text', operator: 'not_starts_with', value: 'draft' },
        { propertyId: 'text', operator: 'not_ends_with', value: '-copy' },
      ],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['keep'])
  })

  it('evaluates empty and non-empty values without treating another property as a match', async () => {
    const rows = [
      row('missing', null, { money: 10 }),
      row('null-cell', '', { text: null }),
      row('present', 'Есть заголовок', { text: 'value' }),
    ]
    const emptyFilter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: '__title__', operator: 'is_empty' },
        { propertyId: 'text', operator: 'is_empty' },
      ],
    }
    const nonEmptyFilter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: '__title__', operator: 'is_not_empty' },
        { propertyId: 'text', operator: 'is_not_empty' },
      ],
    }

    const empty = await applyResidualFilter(repo(), rows, properties, emptyFilter)
    const nonEmpty = await applyResidualFilter(repo(), rows, properties, nonEmptyFilter)

    expect(empty.map((candidate) => candidate.id)).toEqual(['missing', 'null-cell'])
    expect(nonEmpty.map((candidate) => candidate.id)).toEqual(['present'])
  })

  it('compares MONEY as integer kopecks and DATE as ISO instants', async () => {
    const rows = [
      row('inside', 'A', { money: 12_345, date: '2026-07-25T09:00:00.000Z' }),
      row('too-cheap', 'B', { money: 12_344, date: '2026-07-25T09:00:00.000Z' }),
      row('too-late', 'C', { money: 12_345, date: '2026-07-26T09:00:00.000Z' }),
    ]
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        { propertyId: 'money', operator: 'gte', value: 12_345 },
        { propertyId: 'money', operator: 'lt', value: 20_000 },
        { propertyId: 'date', operator: 'after', value: '2026-07-25T08:00:00.000Z' },
        { propertyId: 'date', operator: 'before', value: '2026-07-26T00:00:00.000Z' },
      ],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['inside'])
  })

  it('requires every requested id for contains_all on string arrays', async () => {
    const rows = [
      row('all', 'A', { tags: ['food', 'home', 'urgent'] }),
      row('some', 'B', { tags: ['food'] }),
      row('none', 'C', { tags: [] }),
    ]
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [{ propertyId: 'tags', operator: 'contains_all', value: ['food', 'home'] }],
    }

    const result = await applyResidualFilter(repo(), rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['all'])
  })

  it('loads RELATION ids once per referenced property and cannot match an unlinked row', async () => {
    const rows = [row('linked', 'A'), row('unlinked', 'B'), row('other', 'C')]
    const relationRepo = repo(
      new Map([
        ['linked', ['target-a', 'target-b']],
        ['other', ['target-a']],
      ]),
    )
    const filter: FilterGroup = {
      conjunction: 'and',
      conditions: [
        {
          conjunction: 'or',
          conditions: [
            { propertyId: 'relation', operator: 'contains_all', value: ['target-a', 'target-b'] },
            { propertyId: 'relation', operator: 'is_any_of', value: ['target-c'] },
          ],
        },
      ],
    }

    const result = await applyResidualFilter(relationRepo, rows, properties, filter)

    expect(result.map((candidate) => candidate.id)).toEqual(['linked'])
    expect(relationRepo.findRelationLinks).toHaveBeenCalledTimes(1)
    expect(relationRepo.findRelationLinks).toHaveBeenCalledWith('relation', [
      'linked',
      'unlinked',
      'other',
    ])
  })
})
