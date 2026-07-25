// Shared row post-filter + per-viewer row-access authority for the database
// read stack. These are the load-bearing functions that turn a capped Prisma
// fetch into the AUTHORITATIVE viewable set: the MULTI_SELECT/RELATION post-
// filters (links the planner can't express in a `where`) plus the per-viewer
// row-access gate (the `buildRowAccessWhere` predicate is only an optimization;
// `filterViewableRows` is the real boundary).
//
// SINGLE-SOURCED: `DatabaseService` (its private methods delegate here) AND the
// dashboard `WidgetAggregationService` both consume these. A future fix to the
// row-access boundary lands once and reaches both — no byte-for-byte copy drift.

import type { EnabledAccessRule, RowWithPage } from '../repositories/database.repository.ts'
import type { FilterCondition, FilterGroup } from '../dto/database.dto.ts'
import { DatabasePropertyType } from '../dto/database.dto.ts'
import type { PropertyMeta } from './query-planner.ts'
import { resolveRowAccessForRows } from './row-access-resolver.ts'
import type { AccessRule, RowAccessContext, RowAccessRow } from './row-access-resolver.ts'

/**
 * The minimal repository seam the relation post-filter needs: a batched
 * relation-link lookup for a page of fetched rows (no per-row query). Both the
 * concrete `DatabaseRepository` and the database/dashboard services' mocked
 * repos satisfy this structurally.
 */
export interface RelationLinkLookup {
  findRelationLinks(propertyId: string, rowIds: string[]): Promise<Map<string, string[]>>
}

type LinksByProperty = Map<string, Map<string, string[]>>

function isGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'conjunction' in node && 'conditions' in node
}

function collectRelationPropertyIds(
  filter: FilterGroup,
  metaById: Map<string, PropertyMeta>,
  result = new Set<string>(),
): Set<string> {
  for (const node of filter.conditions) {
    if (isGroup(node)) {
      collectRelationPropertyIds(node, metaById, result)
    } else if (metaById.get(node.propertyId)?.type === DatabasePropertyType.RELATION) {
      result.add(node.propertyId)
    }
  }
  return result
}

async function loadRelationLinks(
  repo: RelationLinkLookup,
  propertyIds: Set<string>,
  rowIds: string[],
): Promise<LinksByProperty> {
  const entries = await Promise.all(
    [...propertyIds].map(
      async (propertyId) => [propertyId, await repo.findRelationLinks(propertyId, rowIds)] as const,
    ),
  )
  return new Map(entries)
}

function cellValue(row: RowWithPage, propertyId: string): unknown {
  return row.cells.find((cell) => cell.propertyId === propertyId)?.value
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function compareValues(
  left: unknown,
  right: unknown,
  type: DatabasePropertyType | undefined,
): number | null {
  if (type === DatabasePropertyType.DATE) {
    const leftTime = typeof left === 'string' ? Date.parse(left) : Number.NaN
    const rightTime = typeof right === 'string' ? Date.parse(right) : Number.NaN
    return Number.isNaN(leftTime) || Number.isNaN(rightTime) ? null : leftTime - rightTime
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'string' && typeof right === 'string') return left.localeCompare(right)
  return null
}

function scalarEquals(left: unknown, right: unknown): boolean {
  return left === right
}

function evaluateCondition(
  row: RowWithPage,
  condition: FilterCondition,
  metaById: Map<string, PropertyMeta>,
  linksByProperty: LinksByProperty,
): boolean {
  const { propertyId, operator } = condition
  const type = metaById.get(propertyId)?.type
  const title = propertyId === '__title__'
  const relation = type === DatabasePropertyType.RELATION
  const actual = title
    ? row.page.title
    : relation
      ? (linksByProperty.get(propertyId)?.get(row.id) ?? [])
      : cellValue(row, propertyId)
  const expected = condition.value
  const stringActual = typeof actual === 'string' ? actual : null
  const stringExpected = String(expected ?? '')
  const normalizedActual = title ? stringActual?.toLocaleLowerCase() : stringActual
  const normalizedExpected = title ? stringExpected.toLocaleLowerCase() : stringExpected

  switch (operator) {
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected)
      return normalizedActual?.includes(normalizedExpected) ?? false
    case 'not_contains':
      if (Array.isArray(actual)) return !actual.includes(expected)
      return !(normalizedActual?.includes(normalizedExpected) ?? false)
    case 'starts_with':
      return normalizedActual?.startsWith(normalizedExpected) ?? false
    case 'not_starts_with':
      return !(normalizedActual?.startsWith(normalizedExpected) ?? false)
    case 'ends_with':
      return normalizedActual?.endsWith(normalizedExpected) ?? false
    case 'not_ends_with':
      return !(normalizedActual?.endsWith(normalizedExpected) ?? false)
    case 'equals':
      return scalarEquals(actual, expected)
    case 'not_equals':
      return !scalarEquals(actual, expected)
    case 'is_empty':
      return isEmptyValue(actual)
    case 'is_not_empty':
      return !isEmptyValue(actual)
    case 'is_checked':
      return actual === true
    case 'is_not_checked':
      return actual !== true
    case 'is_any_of': {
      const wanted = Array.isArray(expected) ? expected : []
      return Array.isArray(actual)
        ? wanted.some((candidate) => actual.includes(candidate))
        : wanted.includes(actual)
    }
    case 'is_none_of': {
      const wanted = Array.isArray(expected) ? expected : []
      return Array.isArray(actual)
        ? wanted.every((candidate) => !actual.includes(candidate))
        : !wanted.includes(actual)
    }
    case 'contains_all': {
      const wanted = Array.isArray(expected) ? expected : []
      return Array.isArray(actual) && wanted.every((candidate) => actual.includes(candidate))
    }
    case 'gt':
    case 'after':
      return (compareValues(actual, expected, type) ?? 0) > 0
    case 'gte':
      return (compareValues(actual, expected, type) ?? -1) >= 0
    case 'lt':
    case 'before':
      return (compareValues(actual, expected, type) ?? 0) < 0
    case 'lte':
      return (compareValues(actual, expected, type) ?? 1) <= 0
    case 'on':
      return type === DatabasePropertyType.DATE
        ? compareValues(actual, expected, type) === 0
        : scalarEquals(actual, expected)
  }
}

function evaluateGroup(
  row: RowWithPage,
  filter: FilterGroup,
  metaById: Map<string, PropertyMeta>,
  linksByProperty: LinksByProperty,
): boolean {
  const results = filter.conditions.map((node) =>
    isGroup(node)
      ? evaluateGroup(row, node, metaById, linksByProperty)
      : evaluateCondition(row, node, metaById, linksByProperty),
  )
  return filter.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * Evaluate a complete filter tree against raw stored row values. The planner
 * deliberately hands over the whole tree whenever one leaf cannot be pushed
 * into Prisma, preserving nested AND/OR and inverted-operator semantics.
 */
export async function applyResidualFilter(
  repo: RelationLinkLookup,
  rows: RowWithPage[],
  properties: PropertyMeta[],
  filter: FilterGroup,
): Promise<RowWithPage[]> {
  if (rows.length === 0) return rows
  const metaById = new Map(properties.map((property) => [property.id, property]))
  const relationPropertyIds = collectRelationPropertyIds(filter, metaById)
  const linksByProperty = await loadRelationLinks(
    repo,
    relationPropertyIds,
    rows.map((row) => row.id),
  )
  return rows.filter((row) => evaluateGroup(row, filter, metaById, linksByProperty))
}

/** Map the enabled access rules (repo shape) to the resolver's `AccessRule` shape. */
export function toResolverRules(rules: EnabledAccessRule[]): AccessRule[] {
  return rules.map((r) => ({
    propertyId: r.propertyId,
    propertyType: r.propertyType,
    accessLevel: r.accessLevel,
    enabled: r.enabled,
  }))
}

/**
 * Build a RowAccessRow (createdBy + the cells keyed by propertyId) from a
 * fetched RowWithPage — the shape the resolver matches PERSON/CREATED_BY rules
 * against.
 */
export function toAccessRow(row: RowWithPage): { id: string } & RowAccessRow {
  const cellsByProperty = new Map<string, unknown>()
  for (const c of row.cells) cellsByProperty.set(c.propertyId, c.value)
  return { id: row.id, rowCreatedById: row.createdById, cellsByProperty }
}

/**
 * Build the viewer's RowAccessContext for a source. `pageShareLevel` is the
 * per-ITEM-page share grant, only meaningful for a single known item page; for
 * list reads pass `itemPageId = null` (no per-row share, broad/role + rules
 * suffice). The resolver raises with the share level when present.
 */
export async function buildRowAccessContext(
  repo: {
    findWorkspaceRole(
      actorUserId: string,
      workspaceId: string,
    ): Promise<RowAccessContext['workspaceRole']>
    isSourcePageCreatedBy(pageId: string, actorUserId: string): Promise<boolean>
    findItemPageShareLevel(
      itemPageId: string,
      actorUserId: string,
    ): Promise<RowAccessContext['pageShareLevel']>
  },
  actorUserId: string | null,
  source: { id: string; workspaceId: string; pageId: string },
  itemPageId: string | null,
): Promise<RowAccessContext> {
  if (actorUserId === null) {
    return { viewerId: null, workspaceRole: null, isSourcePageCreator: false, pageShareLevel: null }
  }
  const [workspaceRole, isSourcePageCreator, pageShareLevel] = await Promise.all([
    repo.findWorkspaceRole(actorUserId, source.workspaceId),
    repo.isSourcePageCreatedBy(source.pageId, actorUserId),
    itemPageId ? repo.findItemPageShareLevel(itemPageId, actorUserId) : Promise.resolve(null),
  ])
  return { viewerId: actorUserId, workspaceRole, isSourcePageCreator, pageShareLevel }
}

/**
 * The AUTHORITATIVE per-row read gate: drop every fetched row the viewer can't
 * view (`resolveRowAccessForRows → null`). When there are no enabled rules and
 * the viewer is a member this keeps every row. The DB `buildRowAccessWhere`
 * predicate is only an optimization — this post-filter is the real boundary.
 */
export function filterViewableRows(
  ctx: RowAccessContext,
  rules: AccessRule[],
  rows: RowWithPage[],
): RowWithPage[] {
  if (rules.length === 0 && ctx.viewerId !== null && ctx.workspaceRole !== null) {
    // Fast path: no rules + a workspace member → every row is viewable.
    return rows
  }
  const levels = resolveRowAccessForRows(
    ctx,
    rules,
    rows.map((r) => toAccessRow(r)),
  )
  return rows.filter((r) => levels.get(r.id) != null)
}
