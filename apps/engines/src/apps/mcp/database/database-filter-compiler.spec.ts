import { describe, expect, it } from '@jest/globals'

import {
  DatabasePropertyType,
  type DatabaseGetByPageResult,
  type DatabasePropertyView,
} from '@repo/domain'

import {
  DATABASE_FIELD_CATALOG,
  GetDatabaseSchemaInput,
  QueryDatabaseRecordsInput,
  buildAgentDatabaseFields,
} from './database-query.schema.js'
import { compileDatabaseQuery } from './database-filter-compiler.js'

function property(
  id: string,
  name: string,
  type: DatabasePropertyType,
  settings: DatabasePropertyView['settings'] = null,
): DatabasePropertyView {
  return { id, name, type, position: 0, settings }
}

function databaseResult(properties: DatabasePropertyView[]): DatabaseGetByPageResult {
  return {
    source: {
      id: 'source-1',
      pageId: 'page-1',
      workspaceId: 'workspace-1',
      title: 'Доходы и расходы',
    },
    views: [],
    properties,
    systemTitleProperty: { key: 'title', name: 'Название' },
    myAccess: {
      canEditContent: false,
      canEditStructure: false,
      canManageExposure: false,
      structureLocked: false,
    },
  }
}

function getError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('expected action to throw')
}

const properties = [
  property('text-id', 'Описание', DatabasePropertyType.TEXT),
  property('number-id', 'Количество', DatabasePropertyType.NUMBER),
  property('money-id', 'Сумма', DatabasePropertyType.MONEY),
  property('date-id', 'Дата', DatabasePropertyType.DATE),
  property('status-id', 'Статус', DatabasePropertyType.STATUS, {
    options: [
      { id: 'income', label: 'Доход' },
      { id: 'expense', label: 'Расход' },
    ],
  }),
  property('tags-id', 'Теги', DatabasePropertyType.MULTI_SELECT, {
    options: [
      { id: 'food', label: 'Еда' },
      { id: 'home', label: 'Дом' },
    ],
  }),
  property('formula-id', 'Итого', DatabasePropertyType.FORMULA, {
    formula: 'prop("Сумма")',
  }),
]

const fields = buildAgentDatabaseFields(databaseResult(properties))

describe('database agent field catalog', () => {
  it('puts the system title first and maps SELECT/STATUS option labels to safe names', () => {
    const select = property('select-id', 'Тип', DatabasePropertyType.SELECT, {
      options: [
        { id: 'income', label: 'Доход', color: 'green' },
        { id: 'expense', label: 'Расход', color: null },
      ],
    })
    const status = property('status-id', 'Статус', DatabasePropertyType.STATUS, {
      options: [{ id: 'done', label: 'Готово' }],
    })

    const result = buildAgentDatabaseFields(databaseResult([select, status]))

    expect(result[0]).toEqual({
      id: '__title__',
      name: 'Название',
      type: 'TITLE',
      valueSchema: { type: 'string' },
      filterOperators: [
        'equals',
        'not_equals',
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'is_empty',
        'is_not_empty',
      ],
    })
    expect(result[1]?.options).toEqual([
      { id: 'income', name: 'Доход' },
      { id: 'expense', name: 'Расход' },
    ])
    expect(result[2]?.options).toEqual([{ id: 'done', name: 'Готово' }])
  })

  it('describes exact MONEY minor units and timezone-bearing DATE values', () => {
    const result = buildAgentDatabaseFields(
      databaseResult([
        property('money-id', 'Сумма', DatabasePropertyType.MONEY),
        property('date-id', 'Дата', DatabasePropertyType.DATE),
      ]),
    )

    expect(result[1]?.valueSchema).toEqual({
      type: 'object',
      properties: {
        kopecks: { type: 'integer' },
        rubles: { type: 'number' },
        currency: { type: 'string', const: 'RUB' },
      },
      required: ['kopecks', 'rubles', 'currency'],
      additionalProperties: false,
    })
    expect(result[2]?.valueSchema).toMatchObject({
      type: 'string',
      format: 'date-time',
      timezoneRequired: true,
    })
  })

  it('makes every property type catalog-driven and keeps unsupported computed fields unfilterable', () => {
    expect(Object.keys(DATABASE_FIELD_CATALOG).sort()).toEqual(
      ['TITLE', ...Object.values(DatabasePropertyType)].sort(),
    )

    const computed = buildAgentDatabaseFields(
      databaseResult([
        property('formula-id', 'Формула', DatabasePropertyType.FORMULA),
        property('rollup-id', 'Rollup', DatabasePropertyType.ROLLUP),
        property('created-id', 'Создано', DatabasePropertyType.CREATED_TIME),
      ]),
    )

    expect(computed.slice(1).map((field) => field.filterOperators)).toEqual([[], [], []])
  })

  it('never publishes internal compiler-normal-form operators', () => {
    const publicOperators = Object.values(DATABASE_FIELD_CATALOG).flatMap(
      (descriptor) => descriptor.filterOperators,
    )

    expect(publicOperators).not.toContain('not_starts_with')
    expect(publicOperators).not.toContain('not_ends_with')
  })

  it('keeps recursive filters as JSON dictionaries at the outer MCP boundary', () => {
    const workspaceId = '31d00f89-0a32-45be-9679-ca7c3e921925'
    const pageId = 'a351cddc-7a31-4f41-910a-492ef69ac07d'

    expect(GetDatabaseSchemaInput.parse({ workspaceId, pageId })).toEqual({ workspaceId, pageId })
    expect(
      QueryDatabaseRecordsInput.parse({
        workspaceId,
        pageId,
        filter: {
          conjunction: 'and',
          conditions: [{ propertyId: 'money-id', operator: 'gte', value: 100 }],
        },
      }),
    ).toMatchObject({
      workspaceId,
      pageId,
      filter: {
        conjunction: 'and',
        conditions: [{ propertyId: 'money-id', operator: 'gte', value: 100 }],
      },
      limit: 100,
    })
  })
})

describe('compileDatabaseQuery field resolution and typed validation', () => {
  it('resolves an exact propertyId', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: { propertyId: 'money-id', operator: 'gte', value: 10_000 },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [{ propertyId: 'money-id', operator: 'gte', value: 10_000 }],
      },
    })
  })

  it('resolves a unique field name case-insensitively', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: { propertyName: 'сУмМа', operator: 'equals', value: 10_000 },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [{ propertyId: 'money-id', operator: 'equals', value: 10_000 }],
      },
    })
  })

  it('rejects incompatible operators without including filter values in the error', () => {
    const error = getError(() =>
      compileDatabaseQuery(fields, {
        filter: {
          propertyName: 'сумма',
          operator: 'contains',
          value: 'sensitive-record-value',
        },
      }),
    )

    expect(error).toMatchObject({
      code: 'DATABASE_FILTER_OPERATOR_INVALID',
      allowedOperators: expect.not.arrayContaining(['contains']),
    })
    expect(JSON.stringify(error)).not.toContain('sensitive-record-value')
  })

  it.each([
    [
      'unknown name',
      { propertyName: 'Неизвестное поле', operator: 'equals', value: 'secret-unknown' },
      'DATABASE_FIELD_NOT_FOUND',
    ],
    [
      'both property references',
      {
        propertyId: 'money-id',
        propertyName: 'Сумма',
        operator: 'equals',
        value: 'secret-both',
      },
      'DATABASE_FILTER_VALUE_INVALID',
    ],
    [
      'no property reference',
      { operator: 'equals', value: 'secret-neither' },
      'DATABASE_FILTER_VALUE_INVALID',
    ],
  ])('rejects %s safely', (_name, filter, code) => {
    const error = getError(() => compileDatabaseQuery(fields, { filter }))

    expect(error).toMatchObject({ code })
    expect(JSON.stringify(error)).not.toContain(String(filter.value))
  })

  it('rejects duplicate case-folded names with only safe field metadata', () => {
    const duplicateFields = buildAgentDatabaseFields(
      databaseResult([
        property('amount-1', 'Сумма', DatabasePropertyType.MONEY),
        property('amount-2', 'сУмМа', DatabasePropertyType.NUMBER),
      ]),
    )
    const error = getError(() =>
      compileDatabaseQuery(duplicateFields, {
        filter: { propertyName: 'СУММА', operator: 'equals', value: 'secret-ambiguous' },
      }),
    )

    expect(error).toMatchObject({
      code: 'DATABASE_FIELD_AMBIGUOUS',
      fields: [
        { id: 'amount-1', name: 'Сумма', type: DatabasePropertyType.MONEY },
        { id: 'amount-2', name: 'сУмМа', type: DatabasePropertyType.NUMBER },
      ],
    })
    expect(JSON.stringify(error)).not.toContain('secret-ambiguous')
  })

  it('rejects unknown SELECT option ids', () => {
    const error = getError(() =>
      compileDatabaseQuery(fields, {
        filter: { propertyId: 'status-id', operator: 'is_any_of', value: ['not-an-option'] },
      }),
    )

    expect(error).toMatchObject({
      code: 'DATABASE_FILTER_VALUE_INVALID',
      valueSchema: fields.find((field) => field.id === 'status-id')?.valueSchema,
    })
  })

  it('normalizes MONEY wire values to integer kopecks and rejects fractional kopecks', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: {
          propertyId: 'money-id',
          operator: 'equals',
          value: { kopecks: 12_345, currency: 'RUB' },
        },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [{ propertyId: 'money-id', operator: 'equals', value: 12_345 }],
      },
    })

    const error = getError(() =>
      compileDatabaseQuery(fields, {
        filter: {
          propertyId: 'money-id',
          operator: 'equals',
          value: { kopecks: 12.5, currency: 'RUB' },
        },
      }),
    )
    expect(error).toMatchObject({ code: 'DATABASE_FILTER_VALUE_INVALID' })
  })

  it('rejects valid-looking DATE strings that omit an explicit timezone', () => {
    const error = getError(() =>
      compileDatabaseQuery(fields, {
        filter: { propertyId: 'date-id', operator: 'on', value: '2026-07-01T00:00:00' },
      }),
    )

    expect(error).toMatchObject({ code: 'DATABASE_DATE_INVALID' })
  })

  it('accepts advertised empty checks for FILE fields without a value', () => {
    const fileFields = buildAgentDatabaseFields(
      databaseResult([property('file-id', 'Файлы', DatabasePropertyType.FILE)]),
    )

    expect(
      compileDatabaseQuery(fileFields, {
        filter: { propertyId: 'file-id', operator: 'is_empty' },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [{ propertyId: 'file-id', operator: 'is_empty' }],
      },
    })
  })
})

describe('compileDatabaseQuery normal form', () => {
  it('pushes a three-level NOT through AND/OR and emits only leaf complements', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: {
          not: {
            conjunction: 'and',
            conditions: [
              { propertyId: '__title__', operator: 'starts_with', value: 'Аренда' },
              {
                conjunction: 'or',
                conditions: [
                  { propertyId: 'number-id', operator: 'gt', value: 10 },
                  { propertyId: 'status-id', operator: 'is_any_of', value: ['expense'] },
                ],
              },
            ],
          },
        },
      }),
    ).toEqual({
      filter: {
        conjunction: 'or',
        conditions: [
          {
            propertyId: '__title__',
            operator: 'not_starts_with',
            value: 'Аренда',
          },
          {
            conjunction: 'and',
            conditions: [
              { propertyId: 'number-id', operator: 'lte', value: 10 },
              { propertyId: 'status-id', operator: 'is_none_of', value: ['expense'] },
            ],
          },
        ],
      },
    })
  })

  it('expands inclusive NUMBER/MONEY between and not_between ranges', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              propertyId: 'number-id',
              operator: 'between',
              value: { min: 10, max: 20 },
            },
            {
              propertyId: 'money-id',
              operator: 'not_between',
              value: {
                min: { kopecks: 1_000, currency: 'RUB' },
                max: { kopecks: 2_000, currency: 'RUB' },
              },
            },
          ],
        },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [
          {
            conjunction: 'and',
            conditions: [
              { propertyId: 'number-id', operator: 'gte', value: 10 },
              { propertyId: 'number-id', operator: 'lte', value: 20 },
            ],
          },
          {
            conjunction: 'or',
            conditions: [
              { propertyId: 'money-id', operator: 'lt', value: 1_000 },
              { propertyId: 'money-id', operator: 'gt', value: 2_000 },
            ],
          },
        ],
      },
    })
  })

  it('expands DATE ranges as half-open intervals and normalizes inclusive bounds', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: {
          conjunction: 'and',
          conditions: [
            {
              propertyId: 'date-id',
              operator: 'between',
              value: {
                from: '2026-07-01T00:00:00+03:00',
                to: '2026-08-01T00:00:00+03:00',
              },
            },
            {
              propertyId: 'date-id',
              operator: 'on_or_before',
              value: '2026-07-31T23:59:59+03:00',
            },
            {
              propertyId: 'date-id',
              operator: 'on_or_after',
              value: '2026-07-01T00:00:00Z',
            },
          ],
        },
      }),
    ).toEqual({
      filter: {
        conjunction: 'and',
        conditions: [
          {
            conjunction: 'and',
            conditions: [
              {
                propertyId: 'date-id',
                operator: 'gte',
                value: '2026-06-30T21:00:00.000Z',
              },
              {
                propertyId: 'date-id',
                operator: 'lt',
                value: '2026-07-31T21:00:00.000Z',
              },
            ],
          },
          {
            propertyId: 'date-id',
            operator: 'lte',
            value: '2026-07-31T20:59:59.000Z',
          },
          {
            propertyId: 'date-id',
            operator: 'gte',
            value: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
    })
  })

  it('compiles NOT contains_all as a disjunction of missing members', () => {
    expect(
      compileDatabaseQuery(fields, {
        filter: {
          not: {
            propertyId: 'tags-id',
            operator: 'contains_all',
            value: ['food', 'home'],
          },
        },
      }),
    ).toEqual({
      filter: {
        conjunction: 'or',
        conditions: [
          { propertyId: 'tags-id', operator: 'is_none_of', value: ['food'] },
          { propertyId: 'tags-id', operator: 'is_none_of', value: ['home'] },
        ],
      },
    })
  })

  it('resolves field-name sorts to property ids', () => {
    expect(
      compileDatabaseQuery(fields, {
        sorts: [
          { propertyName: 'дАтА', direction: 'desc' },
          { propertyId: '__title__', direction: 'asc' },
        ],
      }),
    ).toEqual({
      sorts: [
        { propertyId: 'date-id', direction: 'desc' },
        { propertyId: '__title__', direction: 'asc' },
      ],
    })
  })

  it('limits filter depth to 10, conditions to 100, and sorts to 20', () => {
    let tooDeep: unknown = { propertyId: 'text-id', operator: 'equals', value: 'x' }
    for (let index = 0; index < 10; index += 1) {
      tooDeep = { not: tooDeep }
    }
    const tooManyConditions = Array.from({ length: 101 }, () => ({
      propertyId: 'text-id',
      operator: 'equals',
      value: 'x',
    }))
    const tooManySorts = Array.from({ length: 21 }, () => ({
      propertyId: 'text-id',
      direction: 'asc',
    }))

    expect(getError(() => compileDatabaseQuery(fields, { filter: tooDeep }))).toMatchObject({
      code: 'DATABASE_FILTER_VALUE_INVALID',
    })
    expect(
      getError(() =>
        compileDatabaseQuery(fields, {
          filter: { conjunction: 'and', conditions: tooManyConditions },
        }),
      ),
    ).toMatchObject({ code: 'DATABASE_FILTER_VALUE_INVALID' })
    expect(getError(() => compileDatabaseQuery(fields, { sorts: tooManySorts }))).toMatchObject({
      code: 'DATABASE_FILTER_VALUE_INVALID',
    })
  })
})
