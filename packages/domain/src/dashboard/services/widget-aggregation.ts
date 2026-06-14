// Dashboard widget aggregation — a THIN layer on top of the existing database
// read/access stack (spec §4). It reuses:
//  - the pure query planner (`buildRowQuery`) for the Prisma where/orderBy,
//  - the row-access resolver (`buildRowAccessWhere` pre-filter + the AUTHORITATIVE
//    `resolveRowAccessForRows` per-viewer post-filter),
//  - the database repository's capped grouping fetch + relation-link lookups,
//  - the computed-cells `aggregate` (the rollup aggregation menu) for the in-JS
//    reduce — VERBATIM, never re-implemented.
//
// It is NOT an extension of the pure planner: it composes those pieces. The
// service depends only on the `DatabaseRepository` (the testable seam, mirroring
// `DatabaseService`'s mocked-repo unit tests); a standalone `aggregateWidget`
// wrapper at the bottom constructs the repo from a Prisma client for callers.

import type { Prisma, PrismaClient } from '@repo/db'

import { PrismaUnitOfWork } from '../../shared/unit-of-work.ts'
// The dashboard module reaches the database read-stack ONLY through its barrel
// (the domain-module-isolation rule): the planner, the row-access resolver, the
// SHARED row post-filter authority (single-sourced with DatabaseService — no
// copy drift), the repository, the computed-cells aggregate, and the dto types.
import {
  aggregate,
  applyMultiSelectPostFilters,
  applyRelationPostFilters,
  buildRowAccessContext,
  buildRowAccessWhere,
  buildRowQuery,
  DatabasePropertyType,
  DatabaseRepository,
  filterViewableRows,
  TITLE_SENTINEL,
  toResolverRules,
} from '../../database/index.ts'
import type {
  FilterCondition,
  FilterGroup,
  PropertyMeta,
  PropertyRow,
  RollupAggregation,
  RowWithPage,
  ViewSettings,
} from '../../database/index.ts'
import {
  COUNT_SENTINEL,
  GROUPED_WIDGET_TYPES,
  MAX_WIDGET_ROWS,
  METRIC_WIDGET_TYPES,
} from '../dto/dashboard.dto.ts'
import type {
  AggregateWidgetInput,
  GlobalFilterInput,
  WidgetDataResult,
  WidgetGroup,
  WidgetTableProperty,
  WidgetTableRow,
} from '../dto/dashboard.dto.ts'

// Computed-on-read property types — never aggregated/grouped in the MVP (spec
// invariant 8). Mirrors the database service's READ_ONLY/COMPUTED sets + RELATION.
const COMPUTED_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  DatabasePropertyType.FORMULA,
  DatabasePropertyType.ROLLUP,
  DatabasePropertyType.CREATED_TIME,
  DatabasePropertyType.CREATED_BY,
  DatabasePropertyType.LAST_EDITED_TIME,
  DatabasePropertyType.LAST_EDITED_BY,
  DatabasePropertyType.RELATION,
])

// Sentinels always allowed past the visibility/computed gate.
const ALWAYS_ALLOWED: ReadonlySet<string> = new Set([COUNT_SENTINEL, TITLE_SENTINEL])

// Property types a SELECT-equality global filter is meaningful on (the bucketing
// + comparison treat the cell value as a scalar). Used to decide global-filter
// compatibility (invariant 4: only a visible property of compatible type).
const SCALAR_FILTER_TYPES: ReadonlySet<DatabasePropertyType> = new Set([
  DatabasePropertyType.TEXT,
  DatabasePropertyType.NUMBER,
  DatabasePropertyType.SELECT,
  DatabasePropertyType.STATUS,
  DatabasePropertyType.CHECKBOX,
  DatabasePropertyType.DATE,
  DatabasePropertyType.EMAIL,
  DatabasePropertyType.URL,
  DatabasePropertyType.PHONE,
])

function asViewSettings(raw: unknown): ViewSettings {
  if (raw && typeof raw === 'object') return raw as ViewSettings
  return {}
}

function asSettings(
  raw: unknown,
): { options?: { id: string; label: string; color?: string | null }[] } | null {
  if (raw && typeof raw === 'object') return raw as never
  return null
}

export class WidgetAggregationService {
  private readonly repo: DatabaseRepository
  constructor(repo: DatabaseRepository) {
    this.repo = repo
  }

  async aggregateWidget(
    actorUserId: string,
    input: AggregateWidgetInput,
  ): Promise<WidgetDataResult> {
    // ── 1. Access (object-hiding) ─────────────────────────────────────────────
    // Resolve the source by id, then assert the actor can READ its DATABASE page.
    // No access (non-member / missing source/page) → no_access, never content.
    const source = await this.repo.findSourceMetaById(input.sourceId)
    if (!source) return { status: 'no_access' }
    const page = await this.repo.findAccessiblePage(actorUserId, source.pageId)
    if (!page) return { status: 'no_access' }

    // ── 2. Resolve schema + the view's visible property set ───────────────────
    const fullProperties = await this.repo.listProperties(source.id)
    const propsById = new Map(fullProperties.map((p) => [p.id, p]))
    const propsByName = new Map<string, PropertyRow>()
    for (const p of fullProperties) {
      if (!propsByName.has(p.name)) propsByName.set(p.name, p)
    }

    let viewSettings: ViewSettings = {}
    let visibleIds: Set<string> | null = null // null = all properties visible
    if (input.viewId) {
      const views = await this.repo.listViews(source.id)
      const view = views.find((v) => v.id === input.viewId)
      if (!view) return { status: 'no_access' }
      viewSettings = asViewSettings(view.settings)
      if (viewSettings.visibleProperties) {
        visibleIds = new Set(viewSettings.visibleProperties)
      }
    }

    const isVisible = (propertyId: string): boolean => {
      if (ALWAYS_ALLOWED.has(propertyId)) return true
      if (visibleIds !== null && !visibleIds.has(propertyId)) return false
      return propsById.has(propertyId)
    }
    const isComputed = (propertyId: string): boolean => {
      if (ALWAYS_ALLOWED.has(propertyId)) return false
      const type = propsById.get(propertyId)?.type
      return type !== undefined && COMPUTED_TYPES.has(type)
    }

    // ── 3. Visibility + computed gate (invariants 2 + 8) ──────────────────────
    // REJECT a metric/groupBy property that is hidden OR computed → hidden_property
    // (a hidden property is "not available"; never aggregate over it).
    const metricProp = input.config.metric?.propertyId
    if (metricProp && (!isVisible(metricProp) || isComputed(metricProp))) {
      return { status: 'hidden_property', propertyId: metricProp }
    }
    const groupBy = input.config.groupByPropertyId
    if (groupBy && (!isVisible(groupBy) || isComputed(groupBy))) {
      return { status: 'hidden_property', propertyId: groupBy }
    }

    // ── 4. Build the synthetic ViewSettings (view + widget + global filters) ──
    const metas: PropertyMeta[] = fullProperties.map((p) => ({ id: p.id, type: p.type }))
    const mergedFilters = this.mergeFilters(
      viewSettings.filters,
      input.config.filters,
      this.resolveGlobalFilters(input.globalFilters, propsByName, visibleIds),
    )
    const plan = buildRowQuery({ filters: mergedFilters }, metas)

    // ── 5. Row-access (pre-filter optimization + authoritative post-filter) ──
    // List context: itemPageId = null (no per-row share — role + creator + rules
    // suffice), matching DatabaseService.listRows.
    const rules = toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    const accessCtx = await buildRowAccessContext(this.repo, actorUserId, source, null)
    const accessWhere = buildRowAccessWhere(accessCtx, rules)
    const effectiveWhere: Prisma.DatabaseRowWhereInput =
      accessWhere === null ? plan.where : { AND: [plan.where, accessWhere] }

    // ── 6. Fetch capped (MAX_WIDGET_ROWS + 1 to detect truncation) ───────────
    const fetched = await this.repo.findRowsForGrouping({
      sourceId: source.id,
      where: effectiveWhere,
      take: MAX_WIDGET_ROWS + 1,
    })
    const overfetched = fetched.length > MAX_WIDGET_ROWS
    const capped = overfetched ? fetched.slice(0, MAX_WIDGET_ROWS) : fetched

    // Post-filters: MULTI_SELECT containment + RELATION links + the AUTHORITATIVE
    // per-viewer row-access gate (the where-clause is only an optimization).
    const afterMulti = applyMultiSelectPostFilters(capped, plan.multiSelectPostFilters)
    const afterRelation = await applyRelationPostFilters(
      this.repo,
      afterMulti,
      plan.relationPostFilters,
    )
    const rows = filterViewableRows(accessCtx, rules, afterRelation)

    // Truncation is honest: the over-fetch probe tripped (more rows matched than
    // the cap). Post-filtering can only shrink the set, never reveal more.
    const truncated = overfetched

    // ── 7. Aggregate ─────────────────────────────────────────────────────────
    if (METRIC_WIDGET_TYPES.has(input.type)) {
      const value = this.reduceMeasure(rows, input.config.metric)
      const status = input.type === 'NUMBER' ? 'number' : 'metric'
      return { status, value, truncated }
    }

    if (GROUPED_WIDGET_TYPES.has(input.type)) {
      const groups = this.bucketAndReduce(rows, groupBy, input.config.metric, propsById)
      return { status: 'grouped', groups, truncated }
    }

    // TABLE: a capped read-only row slice + the VISIBLE property descriptors. No
    // aggregation (spec §4 step 6) — the widget renders a read-only table.
    return this.buildTableResult(rows, fullProperties, visibleIds, truncated)
  }

  // ── Aggregation helpers ──────────────────────────────────────────────────────

  /** Coerce an aggregate() result to a number|null (the chart/metric domain). */
  private toNumberResult(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    return null
  }

  /** Collect the measure values for a set of rows: cell values, or 1 per row for __count__. */
  private measureValues(rows: RowWithPage[], metricPropertyId: string): unknown[] {
    if (metricPropertyId === COUNT_SENTINEL) {
      // count_all over a `1` per row → the row count. Any count_* aggregation
      // operates on the per-row presence; non-count aggregations over __count__
      // (sum/avg of 1s) are still well-defined and harmless.
      return rows.map(() => 1)
    }
    if (metricPropertyId === TITLE_SENTINEL) {
      return rows.map((r) => r.page.title)
    }
    return rows.map((r) => r.cells.find((c) => c.propertyId === metricPropertyId)?.value ?? null)
  }

  /** One reduce over the surviving rows' measure (METRIC/NUMBER). */
  private reduceMeasure(
    rows: RowWithPage[],
    metric: { propertyId: string; aggregation: RollupAggregation } | undefined,
  ): number | null {
    // No metric configured → fall back to the row count.
    if (!metric) return rows.length
    const values = this.measureValues(rows, metric.propertyId)
    return this.toNumberResult(aggregate(metric.aggregation, values))
  }

  /**
   * Bucket rows by the groupBy property's cell value, then reduce each bucket's
   * measure. Generalizes `listGroupedRows`' bucketing: for a SELECT/STATUS the
   * buckets follow the option order (+ a trailing empty bucket); for any other
   * non-computed property type the buckets are the distinct stringified cell
   * values (+ an empty bucket).
   */
  private bucketAndReduce(
    rows: RowWithPage[],
    groupByPropertyId: string | undefined,
    metric: { propertyId: string; aggregation: RollupAggregation } | undefined,
    propsById: Map<string, PropertyRow>,
  ): WidgetGroup[] {
    if (!groupByPropertyId) {
      // No groupBy → a single bucket of everything.
      return [{ key: null, label: 'Все', value: this.reduceMeasure(rows, metric) }]
    }

    const groupProp = propsById.get(groupByPropertyId)
    const options =
      groupProp &&
      (groupProp.type === DatabasePropertyType.SELECT ||
        groupProp.type === DatabasePropertyType.STATUS)
        ? (asSettings(groupProp.settings)?.options ?? [])
        : []
    const optionById = new Map(options.map((o) => [o.id, o]))

    // Seed option buckets (in option order) + a trailing null bucket; for free
    // (non-option) property types, buckets accrete as values are encountered.
    const buckets = new Map<string | null, RowWithPage[]>()
    for (const o of options) buckets.set(o.id, [])
    buckets.set(null, [])
    const labelByKey = new Map<string | null, string>()
    for (const o of options) labelByKey.set(o.id, o.label)
    labelByKey.set(null, 'Без значения')

    for (const row of rows) {
      const raw = row.cells.find((c) => c.propertyId === groupByPropertyId)?.value
      const key = this.groupKey(raw, optionById.size > 0 ? optionById : null)
      if (!buckets.has(key)) {
        buckets.set(key, [])
        labelByKey.set(key, key ?? 'Без значения')
      }
      buckets.get(key)!.push(row)
    }

    return [...buckets.entries()].map(([key, bucketRows]) => ({
      key,
      label: labelByKey.get(key) ?? key ?? 'Без значения',
      value: this.reduceMeasure(bucketRows, metric),
    }))
  }

  /**
   * Derive a bucket key from a raw cell value. For an option-backed property a
   * value that is not a known option id falls into the null bucket. For a free
   * property the value is stringified (null/empty → the null bucket).
   */
  private groupKey(raw: unknown, optionById: Map<string, { id: string }> | null): string | null {
    if (raw === null || raw === undefined || raw === '') return null
    if (Array.isArray(raw)) return raw.length === 0 ? null : String(raw[0])
    if (optionById) {
      return typeof raw === 'string' && optionById.has(raw) ? raw : null
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return String(raw)
    }
    return null
  }

  private buildTableResult(
    rows: RowWithPage[],
    fullProperties: PropertyRow[],
    visibleIds: Set<string> | null,
    truncated: boolean,
  ): WidgetDataResult {
    const visible = fullProperties.filter((p) => visibleIds === null || visibleIds.has(p.id))
    const properties: WidgetTableProperty[] = visible.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
    }))
    const tableRows: WidgetTableRow[] = rows.map((r) => ({
      rowId: r.id,
      pageId: r.pageId,
      title: r.page.title,
      icon: r.page.icon,
      cells: Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value])),
    }))
    return { status: 'table', rows: tableRows, properties, truncated, nextCursor: null }
  }

  // ── Filter merge + global-filter resolution ──────────────────────────────────

  /** AND together the present filter groups into one synthetic group. */
  private mergeFilters(...groups: Array<FilterGroup | undefined>): FilterGroup | undefined {
    const present = groups.filter((g): g is FilterGroup => g !== undefined)
    if (present.length === 0) return undefined
    if (present.length === 1) return present[0]
    return { conjunction: 'and', conditions: present }
  }

  /**
   * Resolve global filters (by property NAME) into FilterConditions (by id) —
   * ONLY where this source has a VISIBLE property of that name AND a compatible
   * (scalar) type (invariant 4). A global filter targeting a missing / hidden /
   * incompatible property is ignored for this widget. Returns a FilterGroup (AND)
   * or undefined when nothing applies.
   */
  private resolveGlobalFilters(
    globalFilters: GlobalFilterInput[] | undefined,
    propsByName: Map<string, PropertyRow>,
    visibleIds: Set<string> | null,
  ): FilterGroup | undefined {
    if (!globalFilters || globalFilters.length === 0) return undefined
    const conditions: FilterCondition[] = []
    for (const gf of globalFilters) {
      const prop = propsByName.get(gf.propertyName)
      if (!prop) continue // no property of that name on this source
      if (visibleIds !== null && !visibleIds.has(prop.id)) continue // hidden
      if (!SCALAR_FILTER_TYPES.has(prop.type)) continue // incompatible type
      conditions.push({
        propertyId: prop.id,
        // `gf.operator` is the strict FilterOperator enum (dashboard dto) — the
        // same type as FilterCondition['operator'], so no cast is needed.
        operator: gf.operator,
        value: gf.value,
      })
    }
    if (conditions.length === 0) return undefined
    return { conjunction: 'and', conditions }
  }
}

/**
 * Standalone entry point (spec / plan signature). Constructs the database
 * repository from the Prisma client and delegates to the service. Callers that
 * already hold a repo should use `WidgetAggregationService` directly.
 */
export async function aggregateWidget(
  prisma: PrismaClient,
  actorUserId: string,
  input: AggregateWidgetInput,
): Promise<WidgetDataResult> {
  const repo = new DatabaseRepository(new PrismaUnitOfWork(prisma))
  return new WidgetAggregationService(repo).aggregateWidget(actorUserId, input)
}
