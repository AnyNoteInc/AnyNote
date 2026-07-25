import { describe, it, expect } from 'vitest'

import { DatabasePropertyType } from '@repo/db'

import { buildRowQuery } from '../../../src/database/services/query-planner.ts'
import type { FilterGroup, ViewSettings } from '../../../src/database/dto/database.dto.ts'

// Property meta the planner needs to choose the right value comparison per type.
const props = [
  { id: 'p-text', type: DatabasePropertyType.TEXT },
  { id: 'p-num', type: DatabasePropertyType.NUMBER },
  { id: 'p-check', type: DatabasePropertyType.CHECKBOX },
  { id: 'p-select', type: DatabasePropertyType.SELECT },
  { id: 'p-status', type: DatabasePropertyType.STATUS },
  { id: 'p-multi', type: DatabasePropertyType.MULTI_SELECT },
  { id: 'p-date', type: DatabasePropertyType.DATE },
  { id: 'p-rel', type: DatabasePropertyType.RELATION },
  { id: 'p-formula', type: DatabasePropertyType.FORMULA },
  { id: 'p-rollup', type: DatabasePropertyType.ROLLUP },
  { id: 'p-ct', type: DatabasePropertyType.CREATED_TIME },
  { id: 'p-cb', type: DatabasePropertyType.CREATED_BY },
  { id: 'p-lt', type: DatabasePropertyType.LAST_EDITED_TIME },
  { id: 'p-lb', type: DatabasePropertyType.LAST_EDITED_BY },
]

describe('buildRowQuery — empty settings', () => {
  it('returns an empty where and a position-only orderBy', () => {
    const plan = buildRowQuery({}, props)
    expect(plan.where).toEqual({})
    expect(plan.orderBy).toEqual([{ position: 'asc' }])
    expect(plan.residualFilter).toBeNull()
  })
})

describe('buildRowQuery — TEXT filters', () => {
  it('contains → cells.some with string_contains on the cell value', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-text', operator: 'contains', value: 'foo' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-text', value: { string_contains: 'foo' } } } }],
    })
  })

  it('not_contains → NOT around the cells.some string_contains', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-text', operator: 'not_contains', value: 'foo' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [
        { NOT: { cells: { some: { propertyId: 'p-text', value: { string_contains: 'foo' } } } } },
      ],
    })
  })

  it('equals → cells.some with value.equals', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-text', operator: 'equals', value: 'bar' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-text', value: { equals: 'bar' } } } }],
    })
  })

  for (const [operator, prismaOperator] of [
    ['starts_with', 'string_starts_with'],
    ['ends_with', 'string_ends_with'],
  ] as const) {
    it(`${operator} → cells.some with ${prismaOperator}`, () => {
      const settings: ViewSettings = {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: 'p-text', operator, value: 'foo' }],
        },
      }
      const plan = buildRowQuery(settings, props)
      expect(plan.where).toEqual({
        AND: [{ cells: { some: { propertyId: 'p-text', value: { [prismaOperator]: 'foo' } } } }],
      })
      expect(plan.residualFilter).toBeNull()
    })
  }

  for (const [operator, prismaOperator] of [
    ['not_starts_with', 'string_starts_with'],
    ['not_ends_with', 'string_ends_with'],
  ] as const) {
    it(`${operator} → NOT around cells.some with ${prismaOperator}`, () => {
      const settings: ViewSettings = {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: 'p-text', operator, value: 'foo' }],
        },
      }
      const plan = buildRowQuery(settings, props)
      expect(plan.where).toEqual({
        AND: [
          {
            NOT: {
              cells: { some: { propertyId: 'p-text', value: { [prismaOperator]: 'foo' } } },
            },
          },
        ],
      })
      expect(plan.residualFilter).toBeNull()
    })
  }
})

describe('buildRowQuery — __title__ filters', () => {
  it('contains → page.is.title contains (case-insensitive)', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: '__title__', operator: 'contains', value: 'hello' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ page: { is: { title: { contains: 'hello', mode: 'insensitive' } } } }],
    })
  })

  it('equals → page.is.title equals', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: '__title__', operator: 'equals', value: 'Exact' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ page: { is: { title: { equals: 'Exact' } } } }],
    })
  })

  it('is_not_empty → excludes BOTH null and the empty string (complement of is_empty)', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: '__title__', operator: 'is_not_empty' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [
        {
          AND: [
            { page: { is: { title: { not: null } } } },
            { NOT: { page: { is: { title: { equals: '' } } } } },
          ],
        },
      ],
    })
  })

  for (const [operator, prismaOperator] of [
    ['starts_with', 'startsWith'],
    ['ends_with', 'endsWith'],
  ] as const) {
    it(`${operator} → page.is.title ${prismaOperator}`, () => {
      const settings: ViewSettings = {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: '__title__', operator, value: 'А' }],
        },
      }
      const plan = buildRowQuery(settings, props)
      expect(plan.where).toEqual({
        AND: [{ page: { is: { title: { [prismaOperator]: 'А', mode: 'insensitive' } } } }],
      })
      expect(plan.residualFilter).toBeNull()
    })
  }

  for (const [operator, prismaOperator] of [
    ['not_starts_with', 'startsWith'],
    ['not_ends_with', 'endsWith'],
  ] as const) {
    it(`${operator} → NOT around page.is.title ${prismaOperator}`, () => {
      const settings: ViewSettings = {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: '__title__', operator, value: 'А' }],
        },
      }
      const plan = buildRowQuery(settings, props)
      expect(plan.where).toEqual({
        AND: [
          {
            NOT: {
              page: { is: { title: { [prismaOperator]: 'А', mode: 'insensitive' } } },
            },
          },
        ],
      })
      expect(plan.residualFilter).toBeNull()
    })
  }
})

describe('buildRowQuery — NUMBER filters', () => {
  it('gt → cells.some with value.gt', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-num', operator: 'gt', value: 10 }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-num', value: { gt: 10 } } } }],
    })
  })

  it('lte → cells.some with value.lte', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-num', operator: 'lte', value: 5 }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-num', value: { lte: 5 } } } }],
    })
  })
})

describe('buildRowQuery — CHECKBOX filters', () => {
  it('is_checked → value.equals true', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-check', operator: 'is_checked' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-check', value: { equals: true } } } }],
    })
  })

  it('is_not_checked → no checked cell (none-or-false)', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-check', operator: 'is_not_checked' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ NOT: { cells: { some: { propertyId: 'p-check', value: { equals: true } } } } }],
    })
  })
})

describe('buildRowQuery — is_empty / is_not_empty', () => {
  it('is_empty → no cell row OR a null-valued cell', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-text', operator: 'is_empty' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [
        {
          OR: [
            { cells: { none: { propertyId: 'p-text' } } },
            { cells: { some: { propertyId: 'p-text', value: { equals: null } } } },
          ],
        },
      ],
    })
  })

  it('is_not_empty → a present, non-null cell exists', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-text', operator: 'is_not_empty' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-text', NOT: { value: { equals: null } } } } }],
    })
  })
})

describe('buildRowQuery — DATE filters', () => {
  it('before → cells.some value.lt', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-date', operator: 'before', value: '2026-06-08' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-date', value: { lt: '2026-06-08' } } } }],
    })
  })

  it('after → cells.some value.gt', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-date', operator: 'after', value: '2026-06-08' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-date', value: { gt: '2026-06-08' } } } }],
    })
  })

  it('on → cells.some value.equals', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-date', operator: 'on', value: '2026-06-08' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-date', value: { equals: '2026-06-08' } } } }],
    })
  })
})

describe('buildRowQuery — SELECT / STATUS equality', () => {
  it('SELECT equals → value.equals optionId', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-select', operator: 'equals', value: 'opt-1' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [{ cells: { some: { propertyId: 'p-select', value: { equals: 'opt-1' } } } }],
    })
  })

  it('SELECT is_any_of → OR of equals (in Prisma where, not a post-filter)', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-select', operator: 'is_any_of', value: ['opt-1', 'opt-2'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.residualFilter).toBeNull()
    expect(plan.where).toEqual({
      AND: [
        {
          OR: [
            { cells: { some: { propertyId: 'p-select', value: { equals: 'opt-1' } } } },
            { cells: { some: { propertyId: 'p-select', value: { equals: 'opt-2' } } } },
          ],
        },
      ],
    })
  })

  it('SELECT is_none_of → NOT(OR of equals)', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-select', operator: 'is_none_of', value: ['opt-1'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [
        {
          NOT: {
            OR: [{ cells: { some: { propertyId: 'p-select', value: { equals: 'opt-1' } } } }],
          },
        },
      ],
    })
  })
})

describe('buildRowQuery — nested AND/OR groups', () => {
  it('preserves nested conjunctions', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [
          { propertyId: 'p-text', operator: 'contains', value: 'a' },
          {
            conjunction: 'or',
            conditions: [
              { propertyId: 'p-num', operator: 'gt', value: 1 },
              { propertyId: 'p-num', operator: 'lt', value: 0 },
            ],
          },
        ],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({
      AND: [
        { cells: { some: { propertyId: 'p-text', value: { string_contains: 'a' } } } },
        {
          OR: [
            { cells: { some: { propertyId: 'p-num', value: { gt: 1 } } } },
            { cells: { some: { propertyId: 'p-num', value: { lt: 0 } } } },
          ],
        },
      ],
    })
  })
})

describe('buildRowQuery — MULTI_SELECT residual filter', () => {
  it('preserves the full boolean tree when one branch needs post-filtering', () => {
    const filters: FilterGroup = {
      conjunction: 'or',
      conditions: [
        { propertyId: '__title__', operator: 'starts_with', value: 'А' },
        { propertyId: 'p-multi', operator: 'contains_all', value: ['food', 'home'] },
      ],
    }

    const plan = buildRowQuery({ filters }, [
      { id: 'p-multi', type: DatabasePropertyType.MULTI_SELECT },
    ])

    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(filters)
  })

  it('is_any_of keeps the full filter tree out of Prisma', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-multi', operator: 'is_any_of', value: ['a', 'b'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    // No cell predicate emitted for the multi-select condition.
    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(settings.filters)
  })

  it('is_none_of keeps the full filter tree out of Prisma', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-multi', operator: 'is_none_of', value: ['x'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(settings.filters)
  })
})

describe('buildRowQuery — sorts', () => {
  it('__title__ sort → page.title, with position tiebreak appended last', () => {
    const settings: ViewSettings = {
      sorts: [{ propertyId: '__title__', direction: 'desc' }],
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.orderBy).toEqual([{ page: { title: 'desc' } }, { position: 'asc' }])
  })

  it('a cell-property sort falls back to the stable position order (Prisma cannot order by JSON cell value)', () => {
    const settings: ViewSettings = {
      sorts: [{ propertyId: 'p-num', direction: 'asc' }],
    }
    const plan = buildRowQuery(settings, props)
    // Cell-value ordering is not expressible via Prisma relation orderBy in
    // Prisma 7; the planner emits only the stable position tiebreak.
    expect(plan.orderBy).toEqual([{ position: 'asc' }])
  })

  it('always appends the position tiebreak even with no sorts', () => {
    const plan = buildRowQuery({ sorts: [] }, props)
    expect(plan.orderBy).toEqual([{ position: 'asc' }])
  })
})

// ── C4: RELATION residual filter + computed columns non-filterable ───────────

describe('buildRowQuery — RELATION residual filter', () => {
  it('is_any_of keeps the full filter tree out of Prisma', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-rel', operator: 'is_any_of', value: ['t1', 't2'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(settings.filters)
  })

  it('is_none_of keeps the full filter tree out of Prisma', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-rel', operator: 'is_none_of', value: ['t1'] }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(settings.filters)
  })

  it('a non-membership RELATION operator also requires residual evaluation', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [{ propertyId: 'p-rel', operator: 'contains', value: 'x' }],
      },
    }
    const plan = buildRowQuery(settings, props)
    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual(settings.filters)
  })
})

describe('buildRowQuery — computed columns are not filterable', () => {
  for (const id of ['p-formula', 'p-rollup', 'p-ct', 'p-cb', 'p-lt', 'p-lb']) {
    it(`a condition on ${id} is dropped from where (returns null)`, () => {
      const settings: ViewSettings = {
        filters: {
          conjunction: 'and',
          conditions: [{ propertyId: id, operator: 'equals', value: 'x' }],
        },
      }
      const plan = buildRowQuery(settings, props)
      expect(plan.where).toEqual({ AND: [] })
      expect(plan.residualFilter).toBeNull()
    })
  }

  it('prunes computed leaves before preserving a mixed residual boolean tree', () => {
    const settings: ViewSettings = {
      filters: {
        conjunction: 'and',
        conditions: [
          { propertyId: 'p-formula', operator: 'equals', value: 'ignored' },
          {
            conjunction: 'or',
            conditions: [
              { propertyId: 'p-rollup', operator: 'equals', value: 'ignored' },
              { propertyId: 'p-multi', operator: 'contains_all', value: ['food', 'home'] },
            ],
          },
        ],
      },
    }

    const plan = buildRowQuery(settings, props)

    expect(plan.where).toEqual({})
    expect(plan.residualFilter).toEqual({
      conjunction: 'and',
      conditions: [
        {
          conjunction: 'or',
          conditions: [
            { propertyId: 'p-multi', operator: 'contains_all', value: ['food', 'home'] },
          ],
        },
      ],
    })
  })
})
