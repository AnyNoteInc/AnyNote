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

import type {
  DatabaseRepository,
  EnabledAccessRule,
  RowWithPage,
} from '../repositories/database.repository.ts'
import type { FilterCondition, FilterGroup } from '../dto/database.dto.ts'
import { DatabasePropertyType } from '../dto/database.dto.ts'
import { normalizeFilterGroup } from './query-planner.ts'
import type { PropertyMeta } from './query-planner.ts'
import { resolveRowAccess, resolveRowAccessForRows } from './row-access-resolver.ts'
import type { AccessRule, RowAccessContext, RowAccessRow } from './row-access-resolver.ts'

/**
 * The minimal repository seam the relation post-filter needs: batched link,
 * target-row, source, rule, creator and share lookups plus one role lookup per
 * distinct workspace. Both the concrete `DatabaseRepository` and the
 * database/dashboard services' mocked repos satisfy this structurally.
 */
export type RelationLinkLookup = Pick<
  DatabaseRepository,
  | 'findRelationLinksForProperties'
  | 'findRowsAccessMetaByIds'
  | 'findEnabledAccessRulesForSources'
  | 'findSourceMetasByIds'
  | 'findWorkspaceRole'
  | 'findSourcePageIdsCreatedBy'
  | 'findItemPageShareLevels'
>

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
  return repo.findRelationLinksForProperties([...propertyIds], rowIds)
}

/**
 * Mutate a batched relation-link projection to contain only live target rows
 * the actor can view, and return the surviving target ids. The same projection
 * feeds residual RELATION predicates and computed RELATION/ROLLUP values.
 */
export async function pruneRelationLinksForActor(
  repo: RelationLinkLookup,
  actorUserId: string,
  linksByProperty: LinksByProperty,
): Promise<Set<string>> {
  const linkedTargetIds = new Set<string>()
  for (const byRow of linksByProperty.values()) {
    for (const targetIds of byRow.values()) {
      for (const targetId of targetIds) linkedTargetIds.add(targetId)
    }
  }
  if (linkedTargetIds.size === 0) return linkedTargetIds

  // Missing metadata means the target row is missing or soft-deleted and must
  // be absent from both predicates and returned computed values.
  const targetRows = await repo.findRowsAccessMetaByIds([...linkedTargetIds])
  const targetSourceIds = [...new Set(targetRows.map(({ sourceId }) => sourceId))]
  const sourceMetas = await repo.findSourceMetasByIds(targetSourceIds)
  const sourcePageIds = [...sourceMetas.values()].map(({ pageId }) => pageId)
  const itemPageIds = targetRows.map(({ pageId }) => pageId)
  const workspaceIds = [...new Set(targetRows.map(({ workspaceId }) => workspaceId))]

  const [rulesBySource, creatorPageIds, shareLevels, roleEntries] = await Promise.all([
    repo.findEnabledAccessRulesForSources(targetSourceIds),
    repo.findSourcePageIdsCreatedBy(sourcePageIds, actorUserId),
    repo.findItemPageShareLevels(itemPageIds, actorUserId),
    Promise.all(
      workspaceIds.map(
        async (workspaceId) =>
          [workspaceId, await repo.findWorkspaceRole(actorUserId, workspaceId)] as const,
      ),
    ),
  ])
  const roleByWorkspace = new Map(roleEntries)
  const accessibleTargetIds = new Set<string>()

  for (const targetRow of targetRows) {
    const source = sourceMetas.get(targetRow.sourceId)
    if (!source || source.workspaceId !== targetRow.workspaceId) continue
    const context: RowAccessContext = {
      viewerId: actorUserId,
      workspaceRole: roleByWorkspace.get(targetRow.workspaceId) ?? null,
      isSourcePageCreator: creatorPageIds.has(source.pageId),
      pageShareLevel: shareLevels.get(targetRow.pageId) ?? null,
    }
    const level = resolveRowAccess(
      context,
      toResolverRules(rulesBySource.get(targetRow.sourceId) ?? []),
      {
        rowCreatedById: targetRow.createdById,
        cellsByProperty: targetRow.cellsByProperty,
      },
    )
    if (level !== null) accessibleTargetIds.add(targetRow.id)
  }

  for (const byRow of linksByProperty.values()) {
    for (const [rowId, targetIds] of byRow) {
      byRow.set(
        rowId,
        targetIds.filter((targetId) => accessibleTargetIds.has(targetId)),
      )
    }
  }
  return accessibleTargetIds
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
  actorUserId: string,
  rows: RowWithPage[],
  properties: PropertyMeta[],
  filter: FilterGroup,
): Promise<RowWithPage[]> {
  if (rows.length === 0) return rows
  const metaById = new Map(properties.map((property) => [property.id, property]))
  const normalizedFilter = normalizeFilterGroup(filter, metaById)
  const relationPropertyIds = collectRelationPropertyIds(normalizedFilter, metaById)
  const linksByProperty = await loadRelationLinks(
    repo,
    relationPropertyIds,
    rows.map((row) => row.id),
  )
  await pruneRelationLinksForActor(repo, actorUserId, linksByProperty)
  return rows.filter((row) => evaluateGroup(row, normalizedFilter, metaById, linksByProperty))
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
