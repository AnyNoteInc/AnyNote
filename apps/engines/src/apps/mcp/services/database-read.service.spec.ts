import { describe, expect, it, jest } from '@jest/globals'
import { HttpException } from '@nestjs/common'
import {
  DatabasePropertyType,
  DomainError,
  type DatabaseGetByPageResult,
  type DatabasePropertyView,
  type DatabaseRowView,
  type Domain,
} from '@repo/domain'

import { DatabaseFilterOperatorInvalidError, PageNotFoundError } from '../errors/mcp.errors.js'
import { makeFakeDomain } from './__testutils__/fake-domain.js'
import { DatabaseReadService } from './database-read.service.js'

const pageId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'
const workspaceId = '33333333-3333-4333-8333-333333333333'
const otherWorkspaceId = '44444444-4444-4444-8444-444444444444'
const rowId = '55555555-5555-4555-8555-555555555555'
const rowPageId = '66666666-6666-4666-8666-666666666666'
const typePropertyId = '77777777-7777-4777-8777-777777777777'
const amountPropertyId = '88888888-8888-4888-8888-888888888888'
const datePropertyId = '99999999-9999-4999-8999-999999999999'
const expenseOptionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const incomeOptionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const context = { userId: 'user-1', workspaceId, pageId }

function property(
  id: string,
  type: DatabasePropertyType,
  name: string,
  settings: DatabasePropertyView['settings'] = null,
): DatabasePropertyView {
  return { id, type, name, position: 1000, settings }
}

function databaseResult(
  properties: DatabasePropertyView[],
  overrides: Partial<DatabaseGetByPageResult['source']> = {},
): DatabaseGetByPageResult {
  return {
    source: {
      id: sourceId,
      pageId,
      workspaceId,
      title: 'Доходы и расходы',
      ...overrides,
    },
    views: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        type: 'TABLE',
        title: 'Служебное представление',
        position: 1000,
        settings: { hiddenPropertyIds: ['secret-property'] },
      },
    ],
    properties,
    systemTitleProperty: { key: 'title', name: 'Название' },
    myAccess: {
      canEditContent: true,
      canEditStructure: true,
      canManageExposure: true,
      structureLocked: false,
    },
  }
}

function row(cells: Record<string, unknown>): DatabaseRowView {
  return {
    rowId,
    pageId: rowPageId,
    title: 'Покупка',
    icon: '🧾',
    position: 1000,
    cells,
  }
}

function makeService(schema: DatabaseGetByPageResult, rows: DatabaseRowView[] = []) {
  const getByPage = jest.fn<Domain['database']['getByPage']>().mockResolvedValue(schema)
  const queryRows = jest
    .fn<Domain['database']['queryRows']>()
    .mockResolvedValue({ rows, nextCursor: null })
  const domain = makeFakeDomain({
    database: { getByPage, queryRows } as unknown as Domain['database'],
  })
  return { service: new DatabaseReadService(domain), getByPage, queryRows }
}

function getHttpError(error: unknown): HttpException {
  expect(error).toBeInstanceOf(HttpException)
  return error as HttpException
}

describe('DatabaseReadService.getSchema', () => {
  it('returns an exact self-contained schema without views, settings, or access metadata', async () => {
    const schema = databaseResult([
      property(typePropertyId, DatabasePropertyType.SELECT, 'Тип', {
        options: [
          { id: expenseOptionId, label: 'Расход', color: 'red' },
          { id: incomeOptionId, label: 'Доход', color: 'green' },
        ],
      }),
      property(amountPropertyId, DatabasePropertyType.MONEY, 'Сумма', {
        numberFormat: 'currency_rub',
      }),
      property(datePropertyId, DatabasePropertyType.DATE, 'Дата'),
    ])
    const { service, getByPage } = makeService(schema)

    await expect(service.getSchema(context)).resolves.toEqual({
      page: { id: pageId, title: 'Доходы и расходы' },
      sourceId,
      fields: [
        {
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
        },
        {
          id: typePropertyId,
          name: 'Тип',
          type: 'SELECT',
          valueSchema: {
            oneOf: [
              {
                type: 'object',
                properties: { id: { type: 'string' }, name: { type: 'string' } },
                required: ['id', 'name'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
          filterOperators: [
            'equals',
            'not_equals',
            'is_any_of',
            'is_none_of',
            'is_empty',
            'is_not_empty',
          ],
          options: [
            { id: expenseOptionId, name: 'Расход' },
            { id: incomeOptionId, name: 'Доход' },
          ],
        },
        {
          id: amountPropertyId,
          name: 'Сумма',
          type: 'MONEY',
          valueSchema: {
            type: 'object',
            properties: {
              kopecks: { type: 'integer' },
              rubles: { type: 'number' },
              currency: { type: 'string', const: 'RUB' },
            },
            required: ['kopecks', 'rubles', 'currency'],
            additionalProperties: false,
          },
          filterOperators: [
            'equals',
            'not_equals',
            'gt',
            'gte',
            'lt',
            'lte',
            'between',
            'not_between',
            'is_empty',
            'is_not_empty',
          ],
        },
        {
          id: datePropertyId,
          name: 'Дата',
          type: 'DATE',
          valueSchema: {
            type: 'string',
            format: 'date-time',
            timezoneRequired: true,
            description: 'ISO 8601 date-time with an explicit Z or ±HH:MM timezone',
          },
          filterOperators: [
            'equals',
            'not_equals',
            'before',
            'after',
            'on',
            'on_or_before',
            'on_or_after',
            'between',
            'not_between',
            'is_empty',
            'is_not_empty',
          ],
        },
      ],
    })
    expect(getByPage).toHaveBeenCalledWith('user-1', pageId)
  })
})

describe('DatabaseReadService.query', () => {
  it('compiles the filter, queries Domain.database, and maps typed records', async () => {
    const schema = databaseResult([
      property(typePropertyId, DatabasePropertyType.SELECT, 'Тип', {
        options: [{ id: expenseOptionId, label: 'Расход', color: 'red' }],
      }),
      property(amountPropertyId, DatabasePropertyType.MONEY, 'Сумма'),
      property(datePropertyId, DatabasePropertyType.DATE, 'Дата'),
    ])
    const { service, queryRows } = makeService(schema, [
      row({
        [amountPropertyId]: 3_000_000,
        [typePropertyId]: expenseOptionId,
        [datePropertyId]: '2026-07-02T00:00:00.000Z',
      }),
    ])

    const result = await service.query({
      ...context,
      filter: {
        conjunction: 'and',
        conditions: [
          { propertyId: typePropertyId, operator: 'is_any_of', value: [expenseOptionId] },
        ],
      },
    })

    expect(queryRows).toHaveBeenCalledWith('user-1', {
      pageId,
      filter: {
        conjunction: 'and',
        conditions: [
          { propertyId: typePropertyId, operator: 'is_any_of', value: [expenseOptionId] },
        ],
      },
      sorts: undefined,
      cursor: undefined,
      limit: 100,
    })
    expect(result).toMatchObject({
      page: { id: pageId, title: 'Доходы и расходы' },
      sourceId,
      records: [
        {
          rowId,
          pageId: rowPageId,
          title: 'Покупка',
          values: {
            [amountPropertyId]: { kopecks: 3_000_000, rubles: 30_000, currency: 'RUB' },
            [typePropertyId]: { id: expenseOptionId, name: 'Расход' },
            [datePropertyId]: '2026-07-02T00:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
    })
    expect(result.fields).toHaveLength(4)
  })

  it.each([
    ['TEXT', DatabasePropertyType.TEXT, 'текст', 'текст'],
    ['NUMBER', DatabasePropertyType.NUMBER, 12.5, 12.5],
    ['CHECKBOX', DatabasePropertyType.CHECKBOX, false, false],
  ] as const)(
    'maps %s scalar values and does not expose unknown cells',
    async (_name, type, raw, want) => {
      const propertyId = `${type.toLowerCase()}-property`
      const { service } = makeService(databaseResult([property(propertyId, type, _name)]), [
        row({ [propertyId]: raw, 'unknown-property': { secret: true } }),
      ])

      const result = await service.query(context)

      expect(result.records[0]!.values).toEqual({ [propertyId]: want })
    },
  )

  it('returns null for both null and missing cells', async () => {
    const nullPropertyId = 'null-property'
    const missingPropertyId = 'missing-property'
    const { service } = makeService(
      databaseResult([
        property(nullPropertyId, DatabasePropertyType.TEXT, 'Null'),
        property(missingPropertyId, DatabasePropertyType.NUMBER, 'Missing'),
      ]),
      [row({ [nullPropertyId]: null })],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [nullPropertyId]: null,
      [missingPropertyId]: null,
    })
  })

  it.each([DatabasePropertyType.SELECT, DatabasePropertyType.STATUS])(
    'maps %s ids through schema options and never trusts cell-provided labels',
    async (type) => {
      const knownPropertyId = `${type.toLowerCase()}-known`
      const unknownPropertyId = `${type.toLowerCase()}-unknown`
      const options = [{ id: expenseOptionId, label: 'Расход', color: 'red' }]
      const { service } = makeService(
        databaseResult([
          property(knownPropertyId, type, 'Known', { options }),
          property(unknownPropertyId, type, 'Unknown', { options }),
        ]),
        [
          row({
            [knownPropertyId]: { id: expenseOptionId, name: 'Поддельное имя', secret: true },
            [unknownPropertyId]: { id: 'unknown-option', name: 'Секретная метка' },
          }),
        ],
      )

      const result = await service.query(context)

      expect(result.records[0]!.values).toEqual({
        [knownPropertyId]: { id: expenseOptionId, name: 'Расход' },
        [unknownPropertyId]: null,
      })
    },
  )

  it('maps MULTI_SELECT ids to known option descriptors and drops unknown labels', async () => {
    const propertyId = 'multi-select-property'
    const { service } = makeService(
      databaseResult([
        property(propertyId, DatabasePropertyType.MULTI_SELECT, 'Tags', {
          options: [
            { id: expenseOptionId, label: 'Расход', color: 'red' },
            { id: incomeOptionId, label: 'Доход', color: 'green' },
          ],
        }),
      ]),
      [
        row({
          [propertyId]: [
            expenseOptionId,
            { id: incomeOptionId, name: 'Поддельное имя', access: 'owner' },
            { id: 'unknown-option', name: 'Секретная метка' },
          ],
        }),
      ],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [propertyId]: [
        { id: expenseOptionId, name: 'Расход' },
        { id: incomeOptionId, name: 'Доход' },
      ],
    })
  })

  it('maps only integer MONEY kopecks', async () => {
    const validPropertyId = 'valid-money'
    const invalidPropertyId = 'invalid-money'
    const { service } = makeService(
      databaseResult([
        property(validPropertyId, DatabasePropertyType.MONEY, 'Valid'),
        property(invalidPropertyId, DatabasePropertyType.MONEY, 'Invalid'),
      ]),
      [row({ [validPropertyId]: 845_050, [invalidPropertyId]: 12.5 })],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [validPropertyId]: { kopecks: 845_050, rubles: 8_450.5, currency: 'RUB' },
      [invalidPropertyId]: null,
    })
  })

  it('normalizes valid DATE values and rejects invalid dates', async () => {
    const validPropertyId = 'valid-date'
    const invalidPropertyId = 'invalid-date'
    const { service } = makeService(
      databaseResult([
        property(validPropertyId, DatabasePropertyType.DATE, 'Valid'),
        property(invalidPropertyId, DatabasePropertyType.DATE, 'Invalid'),
      ]),
      [row({ [validPropertyId]: '2026-07-02T03:00:00+03:00', [invalidPropertyId]: 'not-a-date' })],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [validPropertyId]: '2026-07-02T00:00:00.000Z',
      [invalidPropertyId]: null,
    })
  })

  it('returns safe RELATION chips without internal access metadata', async () => {
    const propertyId = 'relation-property'
    const { service } = makeService(
      databaseResult([property(propertyId, DatabasePropertyType.RELATION, 'Связь')]),
      [
        row({
          [propertyId]: [
            {
              rowId: 'target-row',
              pageId: 'target-page',
              title: 'Публичный заголовок',
              icon: '📄',
              sourceId: 'internal-source',
              workspaceId: 'internal-workspace',
              accessLevel: 'OWNER',
            },
            { rowId: 42, pageId: 'invalid', title: 'Invalid' },
          ],
        }),
      ],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [propertyId]: [
        {
          rowId: 'target-row',
          pageId: 'target-page',
          title: 'Публичный заголовок',
          icon: '📄',
        },
      ],
    })
  })

  it('returns safe FILE descriptors without storage or access metadata', async () => {
    const propertyId = 'file-property'
    const { service } = makeService(
      databaseResult([property(propertyId, DatabasePropertyType.FILE, 'Файлы')]),
      [
        row({
          [propertyId]: [
            'file-id-only',
            {
              id: 'file-with-metadata',
              name: 'receipt.pdf',
              mimeType: 'application/pdf',
              fileSize: '1234',
              path: 'private/storage/key',
              workspaceId: 'internal-workspace',
              accessToken: 'secret',
            },
            { id: 42, name: 'invalid' },
          ],
        }),
      ],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [propertyId]: [
        { id: 'file-id-only' },
        {
          id: 'file-with-metadata',
          name: 'receipt.pdf',
          mimeType: 'application/pdf',
          fileSize: '1234',
        },
      ],
    })
  })

  it.each([DatabasePropertyType.FORMULA, DatabasePropertyType.ROLLUP])(
    'returns a safe %s ComputedCellError sentinel',
    async (type) => {
      const propertyId = `${type.toLowerCase()}-property`
      const { service } = makeService(databaseResult([property(propertyId, type, 'Computed')]), [
        row({
          [propertyId]: {
            __error: 'circular reference',
            stack: 'internal stack',
            details: { formula: 'secret' },
          },
        }),
      ])

      const result = await service.query(context)

      expect(result.records[0]!.values).toEqual({
        [propertyId]: { __error: 'circular reference' },
      })
    },
  )

  it.each([
    ['string', 'готово', 'готово'],
    ['finite number', 12.5, 12.5],
    ['boolean', false, false],
    ['null', null, null],
  ] as const)('preserves an ordinary safe FORMULA %s value', async (_case, raw, expected) => {
    const propertyId = 'formula-safe-value'
    const { service } = makeService(
      databaseResult([property(propertyId, DatabasePropertyType.FORMULA, 'Formula')]),
      [row({ [propertyId]: raw })],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({ [propertyId]: expected })
  })

  it('recursively sanitizes ROLLUP show_original values and rejects arbitrary objects', async () => {
    const propertyId = 'rollup-show-original'
    const { service } = makeService(
      databaseResult([property(propertyId, DatabasePropertyType.ROLLUP, 'Original values')]),
      [
        row({
          [propertyId]: [
            'безопасно',
            12.5,
            false,
            null,
            new Date('2026-07-02T03:00:00+03:00'),
            ['вложено', { __error: 'circular reference', stack: 'internal stack' }],
            { secret: true, accessLevel: 'OWNER' },
            Number.NaN,
            Number.POSITIVE_INFINITY,
            1n,
          ],
        }),
      ],
    )

    const result = await service.query(context)

    expect(result.records[0]!.values).toEqual({
      [propertyId]: [
        'безопасно',
        12.5,
        false,
        null,
        '2026-07-02T00:00:00.000Z',
        ['вложено', { __error: 'circular reference' }],
        null,
        null,
        null,
        null,
      ],
    })
  })
})

describe('DatabaseReadService domain boundary', () => {
  it('maps an inaccessible page to safe PAGE_NOT_FOUND', async () => {
    const getByPage = jest
      .fn<Domain['database']['getByPage']>()
      .mockRejectedValue(new DomainError('NOT_FOUND', 'Скрытое внутреннее сообщение', 404))
    const domain = makeFakeDomain({
      database: { getByPage } as unknown as Domain['database'],
    })

    const error = await new DatabaseReadService(domain).getSchema(context).catch((cause) => cause)

    expect(error).toBeInstanceOf(PageNotFoundError)
    expect(getHttpError(error).getResponse()).toEqual({
      code: 'PAGE_NOT_FOUND',
      message: `PAGE_NOT_FOUND: page ${pageId} not found`,
    })
  })

  it('preserves PAGE_IS_NOT_DATABASE code and status for a TEXT page', async () => {
    const getByPage = jest
      .fn<Domain['database']['getByPage']>()
      .mockRejectedValue(
        new DomainError('PAGE_IS_NOT_DATABASE', 'Страница не является базой данных', 400),
      )
    const domain = makeFakeDomain({
      database: { getByPage } as unknown as Domain['database'],
    })

    const error = await new DatabaseReadService(domain).getSchema(context).catch((cause) => cause)

    expect(getHttpError(error).getStatus()).toBe(400)
    expect(getHttpError(error).getResponse()).toEqual({
      code: 'PAGE_IS_NOT_DATABASE',
      message: 'Страница не является базой данных',
    })
  })

  it.each([
    ['another workspace', { workspaceId: otherWorkspaceId }],
    ['another database page', { pageId: 'other-page-id' }],
  ])('returns safe not found when Domain schema belongs to %s', async (_case, overrides) => {
    const { service, queryRows } = makeService(databaseResult([], overrides))

    const error = await service.query(context).catch((cause) => cause)

    expect(error).toBeInstanceOf(PageNotFoundError)
    expect(queryRows).not.toHaveBeenCalled()
  })

  it('preserves a structured DomainError code, message, and status without details', async () => {
    const schema = databaseResult([])
    const { service, queryRows } = makeService(schema)
    queryRows.mockRejectedValue(
      new DomainError('DATABASE_FILTER_INVALID', 'Фильтр отклонён', 422, {
        internalQuery: { secret: true },
      }),
    )

    const error = await service.query(context).catch((cause) => cause)

    expect(getHttpError(error).getStatus()).toBe(422)
    expect(getHttpError(error).getResponse()).toEqual({
      code: 'DATABASE_FILTER_INVALID',
      message: 'Фильтр отклонён',
    })
  })

  it('does not call queryRows when the compiler rejects the filter', async () => {
    const textPropertyId = 'text-property'
    const { service, queryRows } = makeService(
      databaseResult([property(textPropertyId, DatabasePropertyType.TEXT, 'Описание')]),
    )

    const error = await service
      .query({
        ...context,
        filter: {
          conjunction: 'and',
          conditions: [{ propertyId: textPropertyId, operator: 'gt', value: 3 }],
        },
      })
      .catch((cause) => cause)

    expect(error).toBeInstanceOf(DatabaseFilterOperatorInvalidError)
    expect(queryRows).not.toHaveBeenCalled()
  })
})
