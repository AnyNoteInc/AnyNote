import { z } from 'zod'

import {
  DatabasePropertyType,
  type DatabaseGetByPageResult,
  type DatabasePropertyView,
} from '@repo/domain'

import { mcpInput, mcpUuid } from '../utils/mcp-input.js'

export const PUBLIC_DATABASE_FILTER_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'not_between',
  'before',
  'after',
  'on',
  'on_or_before',
  'on_or_after',
  'is_checked',
  'is_not_checked',
  'is_any_of',
  'is_none_of',
  'contains_all',
] as const

export type AgentDatabaseFilterOperator = (typeof PUBLIC_DATABASE_FILTER_OPERATORS)[number]
export type AgentDatabaseFieldType = 'TITLE' | DatabasePropertyType

export interface AgentDatabaseField {
  id: string
  name: string
  type: AgentDatabaseFieldType
  valueSchema: Record<string, unknown>
  filterOperators: AgentDatabaseFilterOperator[]
  options?: Array<{ id: string; name: string }>
}

export type AgentDatabaseWireMapperStrategy =
  | 'string'
  | 'number'
  | 'money'
  | 'date'
  | 'boolean'
  | 'option'
  | 'option-list'
  | 'person-list'
  | 'file-list'
  | 'relation-list'
  | 'page-link-list'
  | 'computed'

export type FilterValueNormalization =
  { success: true; value: unknown } | { success: false; reason: 'value' | 'date' }

export interface DatabaseFieldDescriptor {
  valueSchema: Record<string, unknown>
  filterOperators: readonly AgentDatabaseFilterOperator[]
  wireMapper: AgentDatabaseWireMapperStrategy
  normalizeFilterValue: (
    operator: AgentDatabaseFilterOperator,
    value: unknown,
    field: AgentDatabaseField,
  ) => FilterValueNormalization
}

const STRING_SCHEMA = { type: 'string' } as const
const NUMBER_SCHEMA = { type: 'number' } as const
const BOOLEAN_SCHEMA = { type: 'boolean' } as const
const DATE_SCHEMA = {
  type: 'string',
  format: 'date-time',
  timezoneRequired: true,
  description: 'ISO 8601 date-time with an explicit Z or ±HH:MM timezone',
} as const
const MONEY_SCHEMA = {
  type: 'object',
  properties: {
    kopecks: { type: 'integer' },
    rubles: { type: 'number' },
    currency: { type: 'string', const: 'RUB' },
  },
  required: ['kopecks', 'rubles', 'currency'],
  additionalProperties: false,
} as const
const OPTION_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
} as const
const OPTION_LIST_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['id', 'name'],
    additionalProperties: false,
  },
} as const
const SAFE_REFERENCE_LIST_SCHEMA = {
  type: 'array',
  items: { type: 'object' },
} as const
const COMPUTED_SCHEMA = {
  description: 'Computed value or ComputedCellError',
  oneOf: [{}, { type: 'object', required: ['__error'] }],
} as const

const STRING_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_empty',
  'is_not_empty',
] as const satisfies readonly AgentDatabaseFilterOperator[]
const NUMBER_OPERATORS = [
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
] as const satisfies readonly AgentDatabaseFilterOperator[]
const DATE_OPERATORS = [
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
] as const satisfies readonly AgentDatabaseFilterOperator[]
const SINGLE_OPTION_OPERATORS = [
  'equals',
  'not_equals',
  'is_any_of',
  'is_none_of',
  'is_empty',
  'is_not_empty',
] as const satisfies readonly AgentDatabaseFilterOperator[]
const MULTI_VALUE_OPERATORS = [
  'is_any_of',
  'is_none_of',
  'contains_all',
  'is_empty',
  'is_not_empty',
] as const satisfies readonly AgentDatabaseFilterOperator[]
const CHECKBOX_OPERATORS = [
  'equals',
  'not_equals',
  'is_checked',
  'is_not_checked',
  'is_empty',
  'is_not_empty',
] as const satisfies readonly AgentDatabaseFilterOperator[]
const EMPTY_OPERATORS = [
  'is_empty',
  'is_not_empty',
] as const satisfies readonly AgentDatabaseFilterOperator[]
const NO_OPERATORS = [] as const satisfies readonly AgentDatabaseFilterOperator[]

const NO_VALUE_OPERATORS = new Set<AgentDatabaseFilterOperator>([
  'is_empty',
  'is_not_empty',
  'is_checked',
  'is_not_checked',
])
const RANGE_OPERATORS = new Set<AgentDatabaseFilterOperator>(['between', 'not_between'])
const OPTION_ARRAY_OPERATORS = new Set<AgentDatabaseFilterOperator>([
  'is_any_of',
  'is_none_of',
  'contains_all',
])
const TIMEZONE_DATE_SCHEMA = z.iso.datetime({ offset: true })

function ok(value: unknown): FilterValueNormalization {
  return { success: true, value }
}

function invalid(reason: 'value' | 'date' = 'value'): FilterValueNormalization {
  return { success: false, reason }
}

function normalizeNoValue(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization | null {
  return NO_VALUE_OPERATORS.has(operator) ? (value === undefined ? ok(undefined) : invalid()) : null
}

function normalizeString(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  return normalizeNoValue(operator, value) ?? (typeof value === 'string' ? ok(value) : invalid())
}

function normalizeFiniteNumber(value: unknown): FilterValueNormalization {
  return typeof value === 'number' && Number.isFinite(value) ? ok(value) : invalid()
}

function normalizeNumeric(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  if (!RANGE_OPERATORS.has(operator)) return normalizeFiniteNumber(value)
  if (!isStrictRecord(value, ['min', 'max'])) return invalid()
  const min = normalizeFiniteNumber(value.min)
  const max = normalizeFiniteNumber(value.max)
  if (!min.success || !max.success || (min.value as number) > (max.value as number))
    return invalid()
  return ok({ min: min.value, max: max.value })
}

function normalizeMoneyScalar(value: unknown): FilterValueNormalization {
  if (typeof value === 'number') return Number.isInteger(value) ? ok(value) : invalid()
  if (!isRecord(value)) return invalid()
  const keys = Object.keys(value)
  if (
    keys.some((key) => !['kopecks', 'rubles', 'currency'].includes(key)) ||
    value.currency !== 'RUB' ||
    typeof value.kopecks !== 'number' ||
    !Number.isInteger(value.kopecks)
  ) {
    return invalid()
  }
  if (
    value.rubles !== undefined &&
    (typeof value.rubles !== 'number' ||
      !Number.isFinite(value.rubles) ||
      value.rubles !== value.kopecks / 100)
  ) {
    return invalid()
  }
  return ok(value.kopecks)
}

function normalizeMoney(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  if (!RANGE_OPERATORS.has(operator)) return normalizeMoneyScalar(value)
  if (!isStrictRecord(value, ['min', 'max'])) return invalid()
  const min = normalizeMoneyScalar(value.min)
  const max = normalizeMoneyScalar(value.max)
  if (!min.success || !max.success || (min.value as number) > (max.value as number))
    return invalid()
  return ok({ min: min.value, max: max.value })
}

function normalizeDateScalar(value: unknown): FilterValueNormalization {
  if (typeof value !== 'string' || !TIMEZONE_DATE_SCHEMA.safeParse(value).success) {
    return invalid('date')
  }
  return ok(new Date(value).toISOString())
}

function normalizeDate(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  if (!RANGE_OPERATORS.has(operator)) return normalizeDateScalar(value)
  if (!isStrictRecord(value, ['from', 'to'])) return invalid('date')
  const from = normalizeDateScalar(value.from)
  const to = normalizeDateScalar(value.to)
  if (
    !from.success ||
    !to.success ||
    Date.parse(from.value as string) >= Date.parse(to.value as string)
  ) {
    return invalid('date')
  }
  return ok({ from: from.value, to: to.value })
}

function normalizeCheckbox(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  return typeof value === 'boolean' ? ok(value) : invalid()
}

function normalizeOptionIds(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
  field: AgentDatabaseField,
  singleValue: boolean,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  const needsArray = OPTION_ARRAY_OPERATORS.has(operator) || !singleValue
  const ids = needsArray ? value : [value]
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return invalid()
  const allowedIds = new Set((field.options ?? []).map((option) => option.id))
  if (ids.some((id) => !allowedIds.has(id))) return invalid()
  return ok(needsArray ? ids : ids[0])
}

function normalizeReferenceIds(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || id.length === 0)) {
    return invalid()
  }
  return ok(value)
}

function normalizeScalarReference(
  operator: AgentDatabaseFilterOperator,
  value: unknown,
): FilterValueNormalization {
  const noValue = normalizeNoValue(operator, value)
  if (noValue) return noValue
  return typeof value === 'string' && value.length > 0 ? ok(value) : invalid()
}

function normalizeUnsupported(): FilterValueNormalization {
  return invalid()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStrictRecord(
  value: unknown,
  requiredKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === requiredKeys.length &&
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

export const DATABASE_FIELD_CATALOG: Record<AgentDatabaseFieldType, DatabaseFieldDescriptor> = {
  TITLE: {
    valueSchema: STRING_SCHEMA,
    filterOperators: STRING_OPERATORS,
    wireMapper: 'string',
    normalizeFilterValue: normalizeString,
  },
  [DatabasePropertyType.TEXT]: {
    valueSchema: STRING_SCHEMA,
    filterOperators: STRING_OPERATORS,
    wireMapper: 'string',
    normalizeFilterValue: normalizeString,
  },
  [DatabasePropertyType.NUMBER]: {
    valueSchema: NUMBER_SCHEMA,
    filterOperators: NUMBER_OPERATORS,
    wireMapper: 'number',
    normalizeFilterValue: normalizeNumeric,
  },
  [DatabasePropertyType.MONEY]: {
    valueSchema: MONEY_SCHEMA,
    filterOperators: NUMBER_OPERATORS,
    wireMapper: 'money',
    normalizeFilterValue: normalizeMoney,
  },
  [DatabasePropertyType.STATUS]: {
    valueSchema: OPTION_SCHEMA,
    filterOperators: SINGLE_OPTION_OPERATORS,
    wireMapper: 'option',
    normalizeFilterValue: (operator, value, field) =>
      normalizeOptionIds(operator, value, field, true),
  },
  [DatabasePropertyType.SELECT]: {
    valueSchema: OPTION_SCHEMA,
    filterOperators: SINGLE_OPTION_OPERATORS,
    wireMapper: 'option',
    normalizeFilterValue: (operator, value, field) =>
      normalizeOptionIds(operator, value, field, true),
  },
  [DatabasePropertyType.MULTI_SELECT]: {
    valueSchema: OPTION_LIST_SCHEMA,
    filterOperators: MULTI_VALUE_OPERATORS,
    wireMapper: 'option-list',
    normalizeFilterValue: (operator, value, field) =>
      normalizeOptionIds(operator, value, field, false),
  },
  [DatabasePropertyType.CHECKBOX]: {
    valueSchema: BOOLEAN_SCHEMA,
    filterOperators: CHECKBOX_OPERATORS,
    wireMapper: 'boolean',
    normalizeFilterValue: normalizeCheckbox,
  },
  [DatabasePropertyType.DATE]: {
    valueSchema: DATE_SCHEMA,
    filterOperators: DATE_OPERATORS,
    wireMapper: 'date',
    normalizeFilterValue: normalizeDate,
  },
  [DatabasePropertyType.PERSON]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: ['equals', 'not_equals', ...EMPTY_OPERATORS],
    wireMapper: 'person-list',
    normalizeFilterValue: normalizeScalarReference,
  },
  [DatabasePropertyType.FILE]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'file-list',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.URL]: {
    valueSchema: STRING_SCHEMA,
    filterOperators: STRING_OPERATORS,
    wireMapper: 'string',
    normalizeFilterValue: normalizeString,
  },
  [DatabasePropertyType.EMAIL]: {
    valueSchema: STRING_SCHEMA,
    filterOperators: STRING_OPERATORS,
    wireMapper: 'string',
    normalizeFilterValue: normalizeString,
  },
  [DatabasePropertyType.PHONE]: {
    valueSchema: STRING_SCHEMA,
    filterOperators: STRING_OPERATORS,
    wireMapper: 'string',
    normalizeFilterValue: normalizeString,
  },
  [DatabasePropertyType.FORMULA]: {
    valueSchema: COMPUTED_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'computed',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.RELATION]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: MULTI_VALUE_OPERATORS,
    wireMapper: 'relation-list',
    normalizeFilterValue: normalizeReferenceIds,
  },
  [DatabasePropertyType.ROLLUP]: {
    valueSchema: COMPUTED_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'computed',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.PAGE_LINK]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: ['equals', 'not_equals', ...EMPTY_OPERATORS],
    wireMapper: 'page-link-list',
    normalizeFilterValue: normalizeScalarReference,
  },
  [DatabasePropertyType.CREATED_TIME]: {
    valueSchema: DATE_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'date',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.CREATED_BY]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'person-list',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.LAST_EDITED_TIME]: {
    valueSchema: DATE_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'date',
    normalizeFilterValue: normalizeUnsupported,
  },
  [DatabasePropertyType.LAST_EDITED_BY]: {
    valueSchema: SAFE_REFERENCE_LIST_SCHEMA,
    filterOperators: NO_OPERATORS,
    wireMapper: 'person-list',
    normalizeFilterValue: normalizeUnsupported,
  },
}

function mapOptions(
  property: DatabasePropertyView,
): Array<{ id: string; name: string }> | undefined {
  if (
    property.type !== DatabasePropertyType.SELECT &&
    property.type !== DatabasePropertyType.STATUS &&
    property.type !== DatabasePropertyType.MULTI_SELECT
  ) {
    return undefined
  }
  return (property.settings?.options ?? []).map((option) => ({
    id: option.id,
    name: option.label,
  }))
}

export function buildAgentDatabaseFields(database: DatabaseGetByPageResult): AgentDatabaseField[] {
  const titleDescriptor = DATABASE_FIELD_CATALOG.TITLE
  const fields: AgentDatabaseField[] = [
    {
      id: '__title__',
      name: database.systemTitleProperty.name,
      type: 'TITLE',
      valueSchema: titleDescriptor.valueSchema,
      filterOperators: [...titleDescriptor.filterOperators],
    },
  ]

  for (const property of database.properties) {
    const descriptor = DATABASE_FIELD_CATALOG[property.type]
    const options = mapOptions(property)
    fields.push({
      id: property.id,
      name: property.name,
      type: property.type,
      valueSchema: descriptor.valueSchema,
      filterOperators: [...descriptor.filterOperators],
      ...(options ? { options } : {}),
    })
  }

  return fields
}

export const GetDatabaseSchemaInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})

export const QueryDatabaseRecordsInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  filter: mcpInput(z.record(z.string(), z.unknown()).optional()),
  sorts: mcpInput(z.array(z.record(z.string(), z.unknown())).max(20).optional()),
  cursor: mcpInput(z.string().uuid().optional()),
  limit: mcpInput(z.number().int().min(1).max(200).default(100)),
})
