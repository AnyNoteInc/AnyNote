import { z } from 'zod'

import type { FilterCondition, FilterGroup, Sort } from '@repo/domain'

import {
  DatabaseDateInvalidError,
  DatabaseFieldAmbiguousError,
  DatabaseFieldNotFoundError,
  DatabaseFilterOperatorInvalidError,
  DatabaseFilterValueInvalidError,
} from '../errors/mcp.errors.js'
import {
  DATABASE_FIELD_CATALOG,
  type AgentDatabaseField,
  type AgentDatabaseFilterOperator,
} from './database-query.schema.js'

const MAX_FILTER_DEPTH = 10
const MAX_FILTER_CONDITIONS = 100
const MAX_SORTS = 20
const FILTER_EXPRESSION_SCHEMA = {
  type: 'object',
  description: 'A valid database filter condition, and/or group, or not node',
} as const
const FIELD_REFERENCE_SCHEMA = {
  type: 'object',
  properties: {
    propertyId: { type: 'string' },
    propertyName: { type: 'string' },
  },
  description: 'Exactly one of propertyId or propertyName is required',
} as const
const SORTS_SCHEMA = {
  type: 'array',
  maxItems: MAX_SORTS,
} as const

interface AgentFilterCondition {
  propertyId?: string
  propertyName?: string
  operator: string
  value?: unknown
}

interface AgentFilterGroup {
  conjunction: 'and' | 'or'
  conditions: AgentFilterNode[]
}

interface AgentNotNode {
  not: AgentFilterNode
}

type AgentFilterNode = AgentFilterCondition | AgentFilterGroup | AgentNotNode

interface AgentSort {
  propertyId?: string
  propertyName?: string
  direction: 'asc' | 'desc'
}

type CompiledNode = FilterCondition | FilterGroup

export interface CompiledDatabaseQuery {
  filter?: FilterGroup
  sorts?: Sort[]
}

const conditionSchema = z
  .object({
    propertyId: z.string().min(1).optional(),
    propertyName: z.string().min(1).optional(),
    operator: z.string().min(1),
    value: z.unknown().optional(),
  })
  .strict()

const filterNodeSchema: z.ZodType<AgentFilterNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z
      .object({
        conjunction: z.enum(['and', 'or']),
        conditions: z.array(filterNodeSchema).max(MAX_FILTER_CONDITIONS),
      })
      .strict(),
    z.object({ not: filterNodeSchema }).strict(),
  ]),
)

const sortSchema = z
  .object({
    propertyId: z.string().min(1).optional(),
    propertyName: z.string().min(1).optional(),
    direction: z.enum(['asc', 'desc']),
  })
  .strict()

const sortsSchema = z.array(sortSchema).max(MAX_SORTS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAgentGroup(node: AgentFilterNode): node is AgentFilterGroup {
  return 'conjunction' in node
}

function isAgentNot(node: AgentFilterNode): node is AgentNotNode {
  return 'not' in node
}

function isCompiledGroup(node: CompiledNode): node is FilterGroup {
  return 'conjunction' in node
}

function assertFilterComplexity(filter: unknown): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: filter, depth: 1 }]
  const seen = new Set<object>()
  let conditions = 0

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) break
    if (current.depth > MAX_FILTER_DEPTH) {
      throw new DatabaseFilterValueInvalidError(FILTER_EXPRESSION_SCHEMA)
    }
    if (!isRecord(current.node)) continue
    if (seen.has(current.node)) {
      throw new DatabaseFilterValueInvalidError(FILTER_EXPRESSION_SCHEMA)
    }
    seen.add(current.node)

    if ('operator' in current.node) {
      conditions += 1
      if (conditions > MAX_FILTER_CONDITIONS) {
        throw new DatabaseFilterValueInvalidError(FILTER_EXPRESSION_SCHEMA)
      }
      continue
    }
    if ('not' in current.node) {
      stack.push({ node: current.node.not, depth: current.depth + 1 })
      continue
    }
    if (Array.isArray(current.node.conditions)) {
      if (current.node.conditions.length > MAX_FILTER_CONDITIONS) {
        throw new DatabaseFilterValueInvalidError(FILTER_EXPRESSION_SCHEMA)
      }
      for (const child of current.node.conditions) {
        stack.push({ node: child, depth: current.depth + 1 })
      }
    }
  }
}

function parseFilter(filter: unknown): AgentFilterNode {
  assertFilterComplexity(filter)
  const parsed = filterNodeSchema.safeParse(filter)
  if (!parsed.success) {
    throw new DatabaseFilterValueInvalidError(FILTER_EXPRESSION_SCHEMA)
  }
  return parsed.data
}

function parseSorts(sorts: unknown): AgentSort[] {
  const parsed = sortsSchema.safeParse(sorts)
  if (!parsed.success) {
    throw new DatabaseFilterValueInvalidError(SORTS_SCHEMA)
  }
  return parsed.data
}

function safeField(field: AgentDatabaseField): {
  id: string
  name: string
  type: AgentDatabaseField['type']
} {
  return { id: field.id, name: field.name, type: field.type }
}

function resolveField(
  fields: AgentDatabaseField[],
  reference: { propertyId?: string; propertyName?: string },
): AgentDatabaseField {
  const hasId = reference.propertyId !== undefined
  const hasName = reference.propertyName !== undefined
  if (hasId === hasName) {
    throw new DatabaseFilterValueInvalidError(FIELD_REFERENCE_SCHEMA)
  }

  const matches = hasId
    ? fields.filter((field) => field.id === reference.propertyId)
    : fields.filter(
        (field) => field.name.toLocaleLowerCase() === reference.propertyName?.toLocaleLowerCase(),
      )

  if (matches.length === 0) throw new DatabaseFieldNotFoundError()
  if (matches.length > 1) {
    throw new DatabaseFieldAmbiguousError(matches.map(safeField))
  }
  return matches[0] as AgentDatabaseField
}

function validateAndNormalizeValue(
  field: AgentDatabaseField,
  operator: string,
  value: unknown,
): { operator: AgentDatabaseFilterOperator; value: unknown } {
  const descriptor = DATABASE_FIELD_CATALOG[field.type]
  const allowedOperators = descriptor?.filterOperators ?? []
  if (!descriptor || !allowedOperators.includes(operator as AgentDatabaseFilterOperator)) {
    throw new DatabaseFilterOperatorInvalidError([...allowedOperators])
  }
  const publicOperator = operator as AgentDatabaseFilterOperator
  const normalized = descriptor.normalizeFilterValue(publicOperator, value, field)
  if (!normalized.success) {
    if (normalized.reason === 'date') throw new DatabaseDateInvalidError()
    throw new DatabaseFilterValueInvalidError(field.valueSchema)
  }
  return { operator: publicOperator, value: normalized.value }
}

function leaf(
  field: AgentDatabaseField,
  operator: FilterCondition['operator'],
  value: unknown,
): FilterCondition {
  return value === undefined
    ? { propertyId: field.id, operator }
    : { propertyId: field.id, operator, value }
}

function invertOperator(
  operator: Exclude<FilterCondition['operator'], 'contains_all'>,
): FilterCondition['operator'] {
  const inverse: Record<
    Exclude<FilterCondition['operator'], 'contains_all'>,
    FilterCondition['operator']
  > = {
    equals: 'not_equals',
    not_equals: 'equals',
    contains: 'not_contains',
    not_contains: 'contains',
    starts_with: 'not_starts_with',
    ends_with: 'not_ends_with',
    not_starts_with: 'starts_with',
    not_ends_with: 'ends_with',
    is_empty: 'is_not_empty',
    is_not_empty: 'is_empty',
    gt: 'lte',
    gte: 'lt',
    lt: 'gte',
    lte: 'gt',
    before: 'gte',
    after: 'lte',
    on: 'not_equals',
    is_checked: 'is_not_checked',
    is_not_checked: 'is_checked',
    is_any_of: 'is_none_of',
    is_none_of: 'is_any_of',
  }
  return inverse[operator]
}

function compileRange(
  field: AgentDatabaseField,
  operator: 'between' | 'not_between',
  value: unknown,
  negate: boolean,
): FilterGroup {
  const isDate = field.type === 'DATE'
  const bounds = value as { min?: unknown; max?: unknown; from?: unknown; to?: unknown }
  const lower = isDate ? bounds.from : bounds.min
  const upper = isDate ? bounds.to : bounds.max
  const outside = (operator === 'not_between') !== negate

  if (outside) {
    return {
      conjunction: 'or',
      conditions: [leaf(field, 'lt', lower), leaf(field, isDate ? 'gte' : 'gt', upper)],
    }
  }
  return {
    conjunction: 'and',
    conditions: [leaf(field, 'gte', lower), leaf(field, isDate ? 'lt' : 'lte', upper)],
  }
}

function compileCondition(
  fields: AgentDatabaseField[],
  condition: AgentFilterCondition,
  negate: boolean,
): CompiledNode {
  const field = resolveField(fields, condition)
  const normalized = validateAndNormalizeValue(field, condition.operator, condition.value)

  if (normalized.operator === 'between' || normalized.operator === 'not_between') {
    return compileRange(field, normalized.operator, normalized.value, negate)
  }

  if (normalized.operator === 'contains_all' && negate) {
    const values = normalized.value as unknown[]
    return {
      conjunction: 'or',
      conditions: values.map((value) => leaf(field, 'is_none_of', [value])),
    }
  }

  const aliases: Partial<Record<AgentDatabaseFilterOperator, FilterCondition['operator']>> = {
    on_or_before: 'lte',
    on_or_after: 'gte',
  }
  const domainOperator =
    aliases[normalized.operator] ??
    (normalized.operator as Exclude<
      AgentDatabaseFilterOperator,
      'between' | 'not_between' | 'on_or_before' | 'on_or_after'
    >)
  const finalOperator =
    negate && domainOperator !== 'contains_all' ? invertOperator(domainOperator) : domainOperator
  return leaf(field, finalOperator, normalized.value)
}

function compileNode(
  fields: AgentDatabaseField[],
  node: AgentFilterNode,
  negate = false,
): CompiledNode {
  if (isAgentNot(node)) return compileNode(fields, node.not, !negate)
  if (isAgentGroup(node)) {
    return {
      conjunction: negate ? (node.conjunction === 'and' ? 'or' : 'and') : node.conjunction,
      conditions: node.conditions.map((condition) => compileNode(fields, condition, negate)),
    }
  }
  return compileCondition(fields, node, negate)
}

export function compileDatabaseQuery(
  fields: AgentDatabaseField[],
  input: { filter?: unknown; sorts?: unknown },
): CompiledDatabaseQuery {
  const compiled: CompiledDatabaseQuery = {}

  if (input.filter !== undefined) {
    const node = compileNode(fields, parseFilter(input.filter))
    compiled.filter = isCompiledGroup(node) ? node : { conjunction: 'and', conditions: [node] }
  }

  if (input.sorts !== undefined) {
    compiled.sorts = parseSorts(input.sorts).map((sort) => ({
      propertyId: resolveField(fields, sort).id,
      direction: sort.direction,
    }))
  }

  return compiled
}
