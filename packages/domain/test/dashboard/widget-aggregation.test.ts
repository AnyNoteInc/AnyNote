import { describe, it, expect, beforeEach, vi } from 'vitest'

import { WidgetAggregationService } from '../../src/dashboard/services/widget-aggregation.ts'
import { MAX_WIDGET_ROWS } from '../../src/dashboard/dto/dashboard.dto.ts'
import type { AggregateWidgetInput } from '../../src/dashboard/dto/dashboard.dto.ts'
import type {
  DatabaseRepository,
  RowWithPage,
} from '../../src/database/repositories/database.repository.ts'

// ── Fixtures ──────────────────────────────────────────────────────────────────
// A source with two properties: a NUMBER ("Оценка") + a STATUS ("Статус", 3
// options). Rows carry NUMBER + STATUS cells. The repo is mocked exactly like
// database.service.test.ts (the established domain test pattern).

const SRC = { id: 'src1', workspaceId: 'w1', pageId: 'db-page' }

const NUMBER_PROP = { id: 'prop-num', type: 'NUMBER', name: 'Оценка', position: 0, settings: null }
const STATUS_OPTIONS = [
  { id: 'opt-todo', label: 'Не начато', color: '#9CA3AF' },
  { id: 'opt-doing', label: 'В работе', color: '#3B82F6' },
  { id: 'opt-done', label: 'Готово', color: '#10B981' },
]
const STATUS_PROP = {
  id: 'prop-status',
  type: 'STATUS',
  name: 'Статус',
  position: 1,
  settings: { options: STATUS_OPTIONS },
}
const FORMULA_PROP = {
  id: 'prop-formula',
  type: 'FORMULA',
  name: 'Формула',
  position: 2,
  settings: { formula: '1 + 1' },
}

// Build a RowWithPage with the given NUMBER + STATUS cell values.
let rowSeq = 0
function row(opts: {
  num?: number | null
  status?: string | null
  createdById?: string | null
  id?: string
}): RowWithPage {
  const id = opts.id ?? `row-${++rowSeq}`
  const cells: { propertyId: string; value: unknown }[] = []
  if (opts.num !== undefined && opts.num !== null) {
    cells.push({ propertyId: NUMBER_PROP.id, value: opts.num })
  }
  if (opts.status !== undefined && opts.status !== null) {
    cells.push({ propertyId: STATUS_PROP.id, value: opts.status })
  }
  return {
    id,
    pageId: `${id}-page`,
    position: rowSeq,
    createdAt: new Date('2026-01-01'),
    createdById: opts.createdById ?? 'u1',
    updatedAt: new Date('2026-01-01'),
    updatedById: opts.createdById ?? 'u1',
    page: { title: `Title ${id}`, icon: null },
    cells,
  } as RowWithPage
}

function makeRepo(
  rows: RowWithPage[],
  overrides: Partial<DatabaseRepository> = {},
): DatabaseRepository {
  return {
    // ── Access surface ──────────────────────────────────────────────────────
    findAccessiblePage: vi.fn(async () => ({
      id: 'db-page',
      workspaceId: 'w1',
      createdById: 'u1',
    })),
    findSourceMetaById: vi.fn(async () => ({ ...SRC })),
    findSourceMetaByPageId: vi.fn(async () => ({ ...SRC })),
    findWorkspaceRole: vi.fn(async () => 'OWNER'),
    isSourcePageCreatedBy: vi.fn(async () => true),
    findItemPageShareLevel: vi.fn(async () => null),
    findEnabledAccessRules: vi.fn(async () => []),
    findRowForAccess: vi.fn(async () => null),
    findRowsAccessMetaByIds: vi.fn(async () => []),
    // ── Schema surface ──────────────────────────────────────────────────────
    listProperties: vi.fn(async () => [NUMBER_PROP, STATUS_PROP]),
    listViews: vi.fn(async () => [
      { id: 'view1', type: 'TABLE', title: 'Таблица', position: 0, settings: null },
    ]),
    // ── Row fetch + relation links ──────────────────────────────────────────
    findRowsForGrouping: vi.fn(async () => rows),
    findRelationLinks: vi.fn(async () => new Map()),
    ...overrides,
  } as unknown as DatabaseRepository
}

function makeService(repo: DatabaseRepository) {
  return new WidgetAggregationService(repo)
}

function metricInput(over: Partial<AggregateWidgetInput> = {}): AggregateWidgetInput {
  return {
    sourceId: SRC.id,
    type: 'METRIC',
    config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  rowSeq = 0
})

// ─────────────────────────────────────────────────────────────────────────────

describe('WidgetAggregationService.aggregateWidget — METRIC over a NUMBER property', () => {
  const rows = [{ num: 10 }, { num: 20 }, { num: 30 }].map((o) => row(o))

  it('sum', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } } }),
    )
    expect(r).toEqual({ status: 'metric', value: 60, truncated: false })
  })

  it('average', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'average' } } }),
    )
    expect(r).toMatchObject({ status: 'metric', value: 20 })
  })

  it('min', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'min' } } }),
    )
    expect(r).toMatchObject({ status: 'metric', value: 10 })
  })

  it('max', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'max' } } }),
    )
    expect(r).toMatchObject({ status: 'metric', value: 30 })
  })

  it('count_values', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({
        config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'count_values' } },
      }),
    )
    expect(r).toMatchObject({ status: 'metric', value: 3 })
  })

  it('NUMBER widget type returns status:number', async () => {
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({
        type: 'NUMBER',
        config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } },
      }),
    )
    expect(r).toEqual({ status: 'number', value: 60, truncated: false })
  })
})

describe('WidgetAggregationService.aggregateWidget — __count__ metric', () => {
  it('returns the surviving row count', async () => {
    const rows = [{ num: 1 }, { num: 2 }, {}].map((o) => row(o))
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: '__count__', aggregation: 'count_all' } } }),
    )
    expect(r).toEqual({ status: 'metric', value: 3, truncated: false })
  })
})

describe('WidgetAggregationService.aggregateWidget — GROUPED by a STATUS property', () => {
  it('one {key,label,value} per option (+ empty bucket) reducing the measure', async () => {
    const rows = [
      { status: 'opt-todo', num: 5 },
      { status: 'opt-todo', num: 5 },
      { status: 'opt-doing', num: 100 },
      { status: null, num: 7 }, // no status → empty bucket
    ].map((o) => row(o))

    const r = await makeService(makeRepo(rows)).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'GROUPED',
      config: {
        metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' },
        groupByPropertyId: STATUS_PROP.id,
      },
    })

    expect(r.status).toBe('grouped')
    if (r.status !== 'grouped') throw new Error('unreachable')
    const byKey = new Map(r.groups.map((g) => [g.key, g]))
    expect(byKey.get('opt-todo')).toMatchObject({ label: 'Не начато', value: 10 })
    expect(byKey.get('opt-doing')).toMatchObject({ label: 'В работе', value: 100 })
    // An empty option bucket has no values → the numeric aggregate is null (the
    // computed-cells `aggregate` is reused verbatim; the chart coalesces null→0).
    expect(byKey.get('opt-done')).toMatchObject({ label: 'Готово', value: null })
    expect(byKey.get(null)).toMatchObject({ value: 7 })
    expect(r.truncated).toBe(false)
  })

  it('__count__ measure counts rows per group', async () => {
    const rows = [{ status: 'opt-todo' }, { status: 'opt-todo' }, { status: 'opt-doing' }].map(
      (o) => row(o),
    )

    const r = await makeService(makeRepo(rows)).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'BAR',
      config: {
        metric: { propertyId: '__count__', aggregation: 'count_all' },
        groupByPropertyId: STATUS_PROP.id,
      },
    })
    if (r.status !== 'grouped') throw new Error('expected grouped')
    const byKey = new Map(r.groups.map((g) => [g.key, g.value]))
    expect(byKey.get('opt-todo')).toBe(2)
    expect(byKey.get('opt-doing')).toBe(1)
  })
})

describe('WidgetAggregationService.aggregateWidget — TABLE', () => {
  it('returns a capped row slice + property descriptors (no aggregation)', async () => {
    const rows = [{ num: 1 }, { num: 2 }].map((o) => row(o))
    const r = await makeService(makeRepo(rows)).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'TABLE',
      config: {},
    })
    if (r.status !== 'table') throw new Error('expected table')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ rowId: rows[0]!.id, title: rows[0]!.page.title })
    expect(r.properties.map((p) => p.id)).toContain(NUMBER_PROP.id)
    expect(r.truncated).toBe(false)
  })
})

describe('WidgetAggregationService.aggregateWidget — visibility gate', () => {
  it('rejects a metric on a HIDDEN property (not in the view visibleProperties)', async () => {
    // The view hides the NUMBER property (only STATUS visible).
    const repo = makeRepo([], {
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'TABLE',
          title: 'V',
          position: 0,
          settings: { visibleProperties: [STATUS_PROP.id] },
        },
      ]),
    })
    const r = await makeService(repo).aggregateWidget(
      'u1',
      metricInput({
        viewId: 'view1',
        config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } },
      }),
    )
    expect(r).toEqual({ status: 'hidden_property', propertyId: NUMBER_PROP.id })
  })

  it('rejects a HIDDEN groupBy property', async () => {
    const repo = makeRepo([], {
      listViews: vi.fn(async () => [
        {
          id: 'view1',
          type: 'TABLE',
          title: 'V',
          position: 0,
          settings: { visibleProperties: [NUMBER_PROP.id] },
        },
      ]),
    })
    const r = await makeService(repo).aggregateWidget('u1', {
      sourceId: SRC.id,
      viewId: 'view1',
      type: 'GROUPED',
      config: {
        metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' },
        groupByPropertyId: STATUS_PROP.id,
      },
    })
    expect(r).toEqual({ status: 'hidden_property', propertyId: STATUS_PROP.id })
  })

  it('__count__ is always allowed even when no view (all props visible)', async () => {
    const rows = [{ num: 1 }, { num: 2 }].map((o) => row(o))
    const r = await makeService(makeRepo(rows)).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: '__count__', aggregation: 'count_all' } } }),
    )
    expect(r.status).toBe('metric')
  })
})

describe('WidgetAggregationService.aggregateWidget — computed-property rejection', () => {
  it('rejects a metric on a FORMULA (computed) property', async () => {
    const repo = makeRepo([], {
      listProperties: vi.fn(async () => [NUMBER_PROP, STATUS_PROP, FORMULA_PROP]),
    })
    const r = await makeService(repo).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: FORMULA_PROP.id, aggregation: 'sum' } } }),
    )
    expect(r).toEqual({ status: 'hidden_property', propertyId: FORMULA_PROP.id })
  })

  it('rejects a groupBy on a computed property', async () => {
    const repo = makeRepo([], {
      listProperties: vi.fn(async () => [NUMBER_PROP, STATUS_PROP, FORMULA_PROP]),
    })
    const r = await makeService(repo).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'GROUPED',
      config: {
        metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' },
        groupByPropertyId: FORMULA_PROP.id,
      },
    })
    expect(r).toEqual({ status: 'hidden_property', propertyId: FORMULA_PROP.id })
  })
})

describe('WidgetAggregationService.aggregateWidget — access (object-hiding)', () => {
  it('returns no_access when the viewer cannot read the source page', async () => {
    const repo = makeRepo([], {
      findAccessiblePage: vi.fn(async () => null), // non-member
    })
    const r = await makeService(repo).aggregateWidget('intruder', metricInput())
    expect(r).toEqual({ status: 'no_access' })
  })

  it('returns no_access when the source does not exist', async () => {
    const repo = makeRepo([], {
      findSourceMetaById: vi.fn(async () => null),
    })
    const r = await makeService(repo).aggregateWidget('u1', metricInput())
    expect(r).toEqual({ status: 'no_access' })
  })
})

describe('WidgetAggregationService.aggregateWidget — per-viewer row access', () => {
  it('a row the viewer cannot see (access rule) is NOT in the aggregate', async () => {
    // A PERSON access rule on "owner" property: a viewer sees only rows where the
    // person cell === their id. The non-broad viewer "v2" matches only one row.
    const PERSON_PROP = {
      id: 'prop-person',
      type: 'PERSON',
      name: 'Owner',
      position: 3,
      settings: null,
    }
    const rows = [
      { id: 'r1', num: 10, ownerId: 'v2' },
      { id: 'r2', num: 999, ownerId: 'other' },
    ].map((o) => {
      const base = row({ id: o.id, num: o.num })
      base.cells.push({ propertyId: PERSON_PROP.id, value: o.ownerId })
      base.createdById = 'creator'
      return base
    })

    const repo = makeRepo(rows, {
      listProperties: vi.fn(async () => [NUMBER_PROP, STATUS_PROP, PERSON_PROP]),
      findWorkspaceRole: vi.fn(async () => 'VIEWER'), // non-broad
      isSourcePageCreatedBy: vi.fn(async () => false),
      findEnabledAccessRules: vi.fn(async () => [
        {
          propertyId: PERSON_PROP.id,
          propertyType: 'PERSON',
          accessLevel: 'CAN_VIEW',
          enabled: true,
        },
      ]),
      // findRowsForGrouping only returns v2's row when the DB pre-filter is applied;
      // but to prove the AUTHORITATIVE post-filter, return BOTH rows here.
      findRowsForGrouping: vi.fn(async () => rows),
    })

    const r = await makeService(repo).aggregateWidget(
      'v2',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } } }),
    )
    // Only r1 (value 10) is viewable by v2 → the 999 row is excluded.
    expect(r).toMatchObject({ status: 'metric', value: 10 })
  })
})

describe('WidgetAggregationService.aggregateWidget — row cap + truncation', () => {
  it('caps at MAX_WIDGET_ROWS and flags truncated when more match', async () => {
    // The repo returns MAX_WIDGET_ROWS + 1 rows (the over-fetch probe), each num=1.
    const many = Array.from({ length: MAX_WIDGET_ROWS + 1 }, (_, i) => row({ id: `r${i}`, num: 1 }))
    const fetchSpy = vi.fn(async () => many)
    const repo = makeRepo(many, { findRowsForGrouping: fetchSpy })

    const r = await makeService(repo).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } } }),
    )
    // Sum is over the capped MAX_WIDGET_ROWS rows only, and truncated is true.
    expect(r).toEqual({ status: 'metric', value: MAX_WIDGET_ROWS, truncated: true })
    // The repo was asked to fetch with a cap of MAX_WIDGET_ROWS + 1.
    expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ take: MAX_WIDGET_ROWS + 1 }))
  })

  it('truncated is false when exactly MAX_WIDGET_ROWS match', async () => {
    const exactly = Array.from({ length: MAX_WIDGET_ROWS }, (_, i) => row({ id: `r${i}`, num: 1 }))
    const repo = makeRepo(exactly, { findRowsForGrouping: vi.fn(async () => exactly) })
    const r = await makeService(repo).aggregateWidget(
      'u1',
      metricInput({ config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } } }),
    )
    expect(r).toMatchObject({ truncated: false, value: MAX_WIDGET_ROWS })
  })
})

describe('WidgetAggregationService.aggregateWidget — global filters', () => {
  it('applies a global filter only on a matching visible property of compatible type', async () => {
    // Two rows: status todo (num 5), status doing (num 100). A global filter on
    // "Статус" = opt-todo should keep only the todo row (sum = 5).
    const rows = [
      { status: 'opt-todo', num: 5 },
      { status: 'opt-doing', num: 100 },
    ].map((o) => row(o))

    // The DB pre-filter is emitted by buildRowQuery; the mocked repo can't run
    // Prisma, so it returns ALL rows and we assert the planner produced a where
    // that targets the STATUS property. We assert via the where passed to the repo.
    const fetchSpy = vi.fn(async () => rows)
    const repo = makeRepo(rows, { findRowsForGrouping: fetchSpy })

    await makeService(repo).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'METRIC',
      config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } },
      globalFilters: [{ propertyName: 'Статус', operator: 'equals', value: 'opt-todo' }],
    })

    // The where passed to the repo must reference the STATUS property id (the
    // global filter was resolved name→id against this source's visible props).
    const whereArg = fetchSpy.mock.calls[0]![0].where
    expect(JSON.stringify(whereArg)).toContain(STATUS_PROP.id)
  })

  it('ignores a global filter whose property name is not on this source', async () => {
    const rows = [{ num: 5 }, { num: 100 }].map((o) => row(o))
    const fetchSpy = vi.fn(async () => rows)
    const repo = makeRepo(rows, { findRowsForGrouping: fetchSpy })

    const r = await makeService(repo).aggregateWidget('u1', {
      sourceId: SRC.id,
      type: 'METRIC',
      config: { metric: { propertyId: NUMBER_PROP.id, aggregation: 'sum' } },
      globalFilters: [{ propertyName: 'NoSuchProp', operator: 'equals', value: 'x' }],
    })
    // No matching property → filter ignored → both rows aggregated.
    expect(r).toMatchObject({ status: 'metric', value: 105 })
    const whereArg = fetchSpy.mock.calls[0]![0].where
    expect(JSON.stringify(whereArg)).not.toContain('NoSuchProp')
  })
})
