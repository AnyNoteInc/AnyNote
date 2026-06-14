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
import type { MultiSelectPostFilter, RelationPostFilter } from './query-planner.ts'
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

/**
 * Apply MULTI_SELECT post-filters: a row passes `is_any_of` when its option ids
 * intersect the wanted set, and `is_none_of` when they are disjoint. The
 * containment can't be expressed in the Prisma `where` (the cell is a JSON
 * array), so it is resolved in JS over the page of fetched rows.
 */
export function applyMultiSelectPostFilters(
  rows: RowWithPage[],
  postFilters: MultiSelectPostFilter[],
): RowWithPage[] {
  if (postFilters.length === 0) return rows
  return rows.filter((row) =>
    postFilters.every((pf) => {
      const cell = row.cells.find((c) => c.propertyId === pf.propertyId)
      const values = Array.isArray(cell?.value) ? (cell.value as string[]) : []
      const intersects = pf.optionIds.some((id) => values.includes(id))
      return pf.op === 'is_any_of' ? intersects : !intersects
    }),
  )
}

/**
 * Apply RELATION post-filters: a row passes `is_any_of` when its linked target
 * ids (for the filtered RELATION property) intersect the wanted set, and
 * `is_none_of` when they are disjoint. The links can't be expressed in the
 * Prisma `where` (they live in DatabaseRelationLink), so they are resolved in
 * one batched query per filter for the page of fetched rows (no per-row query).
 */
export async function applyRelationPostFilters(
  repo: RelationLinkLookup,
  rows: RowWithPage[],
  postFilters: RelationPostFilter[],
): Promise<RowWithPage[]> {
  if (postFilters.length === 0 || rows.length === 0) return rows
  const rowIds = rows.map((r) => r.id)
  let surviving = rows
  for (const pf of postFilters) {
    const linksByRow = await repo.findRelationLinks(pf.propertyId, rowIds)
    const wanted = new Set(pf.targetRowIds)
    surviving = surviving.filter((row) => {
      const links = linksByRow.get(row.id) ?? []
      const intersects = links.some((id) => wanted.has(id))
      return pf.op === 'is_any_of' ? intersects : !intersects
    })
  }
  return surviving
}
