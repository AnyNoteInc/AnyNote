import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
// Enum values are re-exported through the dto barrel so the service never
// imports `@repo/db` as a value (domain-services-no-db-value rule).
import { DatabasePropertyType, DatabaseViewType } from '../dto/database.dto.ts'
import type {
  CreatePropertyInput,
  CreateRowInput,
  CreateViewInput,
  DatabaseGetByPageResult,
  DatabaseRowView,
  DuplicateViewInput,
  GroupedRowsResult,
  ListGroupedRowsInput,
  ListRowsInput,
  ListRowsResult,
  PropertyIdInput,
  PropertySettings,
  ReorderPropertiesInput,
  ReorderRowsInput,
  SetRowPositionInput,
  RowIdInput,
  SelectOption,
  UpdateCellValueInput,
  UpdatePropertyInput,
  UpdateRowInput,
  UpdateViewInput,
  ViewIdInput,
  ViewSettings,
} from '../dto/database.dto.ts'
import type {
  AccessiblePage,
  DatabaseRepository,
  RowWithPage,
} from '../repositories/database.repository.ts'
import { buildRowQuery } from './query-planner.ts'
import type { MultiSelectPostFilter, PropertyMeta } from './query-planner.ts'

// Position gap used for end-insertion / reorder spacing (matches kanban's 1024).
const POSITION_GAP = 1024

// Default STATUS options seeded on every new database.
const DEFAULT_STATUS_OPTIONS: SelectOption[] = [
  { id: 'status-not-started', label: 'Не начато', color: '#9CA3AF' },
  { id: 'status-in-progress', label: 'В работе', color: '#3B82F6' },
  { id: 'status-done', label: 'Готово', color: '#10B981' },
]

function asSettings(raw: unknown): PropertySettings | null {
  if (raw && typeof raw === 'object') return raw as PropertySettings
  return null
}

export class DatabaseService {
  private readonly repo: DatabaseRepository
  private readonly pageRepo: ItemPageCreator
  private readonly uow: UnitOfWork
  constructor(repo: DatabaseRepository, pageRepo: ItemPageCreator, uow: UnitOfWork) {
    this.repo = repo
    this.pageRepo = pageRepo
    this.uow = uow
  }

  // ── Access helpers (mirror KanbanService) ────────────────────────────────────

  private async assertCanEdit(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR') {
      throw forbidden('Недостаточно прав на редактирование')
    }
    return page
  }

  private async assertCanComment(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const role = await this.repo.findMembershipRole(userId, page.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'EDITOR' && role !== 'COMMENTER') {
      throw forbidden('Недостаточно прав на комментирование')
    }
    return page
  }

  private async assertCanRead(userId: string, pageId: string): Promise<AccessiblePage> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    return page
  }

  /** Resolve the source for a DATABASE page, asserting it exists. */
  private async requireSource(
    pageId: string,
  ): Promise<{ id: string; workspaceId: string; pageId: string }> {
    const source = await this.repo.findSourceMetaByPageId(pageId)
    if (!source) throw notFound('База данных не найдена для этой страницы')
    return source
  }

  // ── Seed ──────────────────────────────────────────────────────────────────────

  /**
   * Provision a fresh database on DATABASE page create: a source (titled from the
   * page), one default TABLE view "Таблица", and one default STATUS property
   * "Статус" with three options. The Title/Name column is implicit (Page.title)
   * and is never created as a property row.
   */
  async seedDefaults(pageId: string, workspaceId: string, title?: string | null): Promise<void> {
    await this.uow.transaction(async () => {
      const source = await this.repo.createSource({
        workspaceId,
        pageId,
        title: title ?? null,
      })
      await this.repo.createView({
        sourceId: source.id,
        type: DatabaseViewType.TABLE,
        title: 'Таблица',
        position: 0,
      })
      await this.repo.createProperty({
        sourceId: source.id,
        type: DatabasePropertyType.STATUS,
        name: 'Статус',
        position: 0,
        settings: { options: DEFAULT_STATUS_OPTIONS },
      })
    })
  }

  /**
   * Idempotently ensure a DATABASE page has a source. Legacy DATABASE pages
   * created before provisioning existed (or via a path that skipped the
   * type-dispatch) end up with no source; the renderer surfaces a "Создать базу"
   * action that calls this. A no-op when the source already exists.
   */
  async repairSource(actorUserId: string, pageId: string): Promise<{ ok: true }> {
    const page = await this.assertCanEdit(actorUserId, pageId)
    const existing = await this.repo.findSourceMetaByPageId(pageId)
    if (!existing) {
      await this.seedDefaults(pageId, page.workspaceId)
    }
    return { ok: true as const }
  }

  // ── View-model read ─────────────────────────────────────────────────────────

  async getByPage(actorUserId: string, pageId: string): Promise<DatabaseGetByPageResult> {
    await this.assertCanRead(actorUserId, pageId)
    const loaded = await this.repo.findSourceSchemaByPageId(pageId)
    if (!loaded) throw notFound('База данных не найдена для этой страницы')
    return {
      source: {
        id: loaded.source.id,
        pageId: loaded.source.pageId,
        workspaceId: loaded.source.workspaceId,
        title: loaded.source.title,
      },
      views: loaded.views.map((v) => ({
        id: v.id,
        type: v.type,
        title: v.title,
        position: v.position,
        settings: v.settings,
      })),
      properties: loaded.properties.map((p) => ({
        id: p.id,
        type: p.type,
        name: p.name,
        position: p.position,
        settings: asSettings(p.settings),
      })),
      systemTitleProperty: { key: 'title', name: 'Название' },
    }
  }

  /**
   * Resolve a database by its SOURCE id (rather than its DATABASE page id) and
   * return the same view-model as `getByPage`. Used by the embedded-database
   * editor node, which references a source by id. Access is guarded against the
   * source's owning DATABASE page (via `getByPage` → `assertCanRead`), so a user
   * who can't read that page gets NOT_FOUND.
   */
  async getBySourceId(actorUserId: string, sourceId: string): Promise<DatabaseGetByPageResult> {
    const source = await this.repo.findSourceMetaById(sourceId)
    if (!source) throw notFound('База данных не найдена')
    return this.getByPage(actorUserId, source.pageId)
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  async listViews(actorUserId: string, pageId: string) {
    await this.assertCanRead(actorUserId, pageId)
    const source = await this.requireSource(pageId)
    return this.repo.listViews(source.id)
  }

  async createView(actorUserId: string, input: CreateViewInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const type = input.type ?? DatabaseViewType.TABLE
    const [existing, properties] = await Promise.all([
      this.repo.listViews(source.id),
      this.repo.listProperties(source.id),
    ])
    const position = (existing.at(-1)?.position ?? 0) + POSITION_GAP
    const settings = this.defaultViewSettings(type, properties)
    return this.repo.createView({
      sourceId: source.id,
      type,
      title: input.title,
      position,
      settings: settings as Parameters<DatabaseRepository['createView']>[0]['settings'],
    })
  }

  /**
   * Seed sensible default settings for a new view: BOARD groups by the first
   * STATUS/SELECT property; CALENDAR places rows on the first DATE property;
   * other types get empty settings. Returns `{}` when no suitable property
   * exists (the UI prompts the user to pick one).
   */
  private defaultViewSettings(
    type: DatabaseViewType,
    properties: Array<{ id: string; type: DatabasePropertyType }>,
  ): ViewSettings {
    if (type === DatabaseViewType.BOARD) {
      const groupProp = properties.find(
        (p) => p.type === DatabasePropertyType.STATUS || p.type === DatabasePropertyType.SELECT,
      )
      return groupProp ? { groupBy: { propertyId: groupProp.id } } : {}
    }
    if (type === DatabaseViewType.CALENDAR) {
      const dateProp = properties.find((p) => p.type === DatabasePropertyType.DATE)
      return dateProp ? { layout: { datePropertyId: dateProp.id } } : {}
    }
    return {}
  }

  async updateView(actorUserId: string, input: UpdateViewInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const view = await this.repo.findViewById(input.id)
    if (!view || view.sourceId !== source.id) throw notFound('Представление не найдено')
    return this.repo.updateView(input.id, {
      title: input.title,
      ...(input.settings === undefined
        ? {}
        : { settings: input.settings as Parameters<DatabaseRepository['updateView']>[1]['settings'] }),
    })
  }

  async deleteView(actorUserId: string, input: ViewIdInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const view = await this.repo.findViewById(input.id)
    if (!view || view.sourceId !== source.id) throw notFound('Представление не найдено')
    const all = await this.repo.listViews(source.id)
    if (all.length <= 1) throw badRequest('Нельзя удалить единственное представление')
    await this.repo.deleteView(input.id)
    return { ok: true as const }
  }

  /** Copy a view (title + " (копия)", type, settings) at the next position. */
  async duplicateView(actorUserId: string, input: DuplicateViewInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const views = await this.repo.listViews(source.id)
    const view = views.find((v) => v.id === input.viewId)
    if (!view) throw notFound('Представление не найдено')
    const position = (views.at(-1)?.position ?? 0) + POSITION_GAP
    return this.repo.createView({
      sourceId: source.id,
      type: view.type,
      title: `${view.title} (копия)`,
      position,
      ...(view.settings == null
        ? {}
        : { settings: view.settings as Parameters<DatabaseRepository['createView']>[0]['settings'] }),
    })
  }

  // ── Properties ───────────────────────────────────────────────────────────────

  async listProperties(actorUserId: string, pageId: string) {
    await this.assertCanRead(actorUserId, pageId)
    const source = await this.requireSource(pageId)
    return this.repo.listProperties(source.id)
  }

  async createProperty(actorUserId: string, input: CreatePropertyInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const maxPos = await this.repo.maxPropertyPosition(source.id)
    return this.repo.createProperty({
      sourceId: source.id,
      type: input.type,
      name: input.name,
      position: maxPos + POSITION_GAP,
      settings: input.settings === undefined ? undefined : (input.settings as never),
    })
  }

  async updateProperty(actorUserId: string, input: UpdatePropertyInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const prop = await this.repo.findPropertyById(input.id)
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    return this.repo.updateProperty(input.id, {
      name: input.name,
      type: input.type,
      ...(input.settings === undefined ? {} : { settings: input.settings as never }),
    })
  }

  async deleteProperty(actorUserId: string, input: PropertyIdInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const prop = await this.repo.findPropertyById(input.id)
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    // Cells cascade via the DatabaseCellValue → DatabaseProperty FK.
    await this.repo.deleteProperty(input.id)
    return { ok: true as const }
  }

  async reorderProperties(actorUserId: string, input: ReorderPropertiesInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const existing = await this.repo.listProperties(source.id)
    const known = new Set(existing.map((p) => p.id))
    for (const id of input.orderedIds) {
      if (!known.has(id)) throw badRequest('Неизвестное свойство в порядке сортировки')
    }
    const ordered = input.orderedIds.map((id, idx) => ({ id, position: (idx + 1) * POSITION_GAP }))
    await this.repo.reorderProperties(ordered)
    return { ok: true as const }
  }

  // ── Cells ────────────────────────────────────────────────────────────────────

  async updateCellValue(actorUserId: string, input: UpdateCellValueInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)

    const [prop, row] = await Promise.all([
      this.repo.findPropertyById(input.propertyId),
      this.repo.findRowById(input.rowId),
    ])
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    if (row.deletedAt) throw notFound('Строка удалена')

    // DATE cells may arrive via the coerced dateValue field.
    const rawValue =
      prop.type === DatabasePropertyType.DATE && input.dateValue !== undefined
        ? input.dateValue
        : input.value

    const value = this.validateCellValue(prop.type, asSettings(prop.settings), rawValue)
    await this.repo.upsertCellValue(input.rowId, input.propertyId, value)
    return { ok: true as const }
  }

  /**
   * Validate + normalize a raw cell value against the property type. Returns the
   * JSON-serializable value to persist (null clears the cell). Throws BAD_REQUEST
   * on a type mismatch.
   */
  private validateCellValue(
    type: DatabasePropertyType,
    settings: PropertySettings | null,
    raw: unknown,
  ): null | string | number | boolean | string[] {
    if (raw === null || raw === undefined || raw === '') return null

    switch (type) {
      case DatabasePropertyType.NUMBER: {
        const n = typeof raw === 'number' ? raw : Number(raw)
        if (typeof raw !== 'number' || Number.isNaN(n)) {
          throw badRequest('Ожидалось число')
        }
        return n
      }
      case DatabasePropertyType.CHECKBOX:
        return Boolean(raw)
      case DatabasePropertyType.DATE: {
        if (raw instanceof Date) return raw.toISOString()
        if (typeof raw === 'string') {
          const d = new Date(raw)
          if (Number.isNaN(d.getTime())) throw badRequest('Некорректная дата')
          return d.toISOString()
        }
        throw badRequest('Ожидалась дата')
      }
      case DatabasePropertyType.SELECT:
      case DatabasePropertyType.STATUS: {
        if (typeof raw !== 'string') throw badRequest('Ожидался идентификатор варианта')
        const options = settings?.options ?? []
        if (!options.some((o) => o.id === raw)) throw badRequest('Неизвестный вариант')
        return raw
      }
      case DatabasePropertyType.MULTI_SELECT: {
        if (!Array.isArray(raw)) throw badRequest('Ожидался список вариантов')
        const options = settings?.options ?? []
        const ids = options.map((o) => o.id)
        for (const v of raw) {
          if (typeof v !== 'string' || !ids.includes(v)) throw badRequest('Неизвестный вариант')
        }
        return raw as string[]
      }
      case DatabasePropertyType.PERSON:
      case DatabasePropertyType.FILE:
      case DatabasePropertyType.TEXT:
      default:
        return typeof raw === 'string' ? raw : String(raw)
    }
  }

  // ── Rows (view-aware, paginated) ─────────────────────────────────────────────

  /** Coerce a persisted view settings blob (unknown JSON) into ViewSettings. */
  private asViewSettings(raw: unknown): ViewSettings {
    if (raw && typeof raw === 'object') return raw as ViewSettings
    return {}
  }

  /** Map a repo RowWithPage to the DatabaseRowView the renderer consumes. */
  private mapRow(r: RowWithPage): DatabaseRowView {
    return {
      rowId: r.id,
      pageId: r.pageId,
      title: r.page.title,
      icon: r.page.icon,
      position: r.position,
      cells: Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value])),
    }
  }

  /**
   * Apply MULTI_SELECT post-filters in JS (Prisma can't express JSON-array
   * containment portably — the planner returns these instead of a where clause).
   * `is_any_of` keeps rows whose array intersects the option set; `is_none_of`
   * keeps rows whose array is disjoint from it.
   */
  private applyMultiSelectPostFilters(
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

  /** Resolve a view's settings + the source's property metas for the planner. */
  private async resolveViewContext(
    sourceId: string,
    viewId: string | undefined,
  ): Promise<{ settings: ViewSettings; properties: PropertyMeta[] }> {
    const properties = await this.repo.listProperties(sourceId)
    const metas: PropertyMeta[] = properties.map((p) => ({ id: p.id, type: p.type }))
    if (!viewId) return { settings: {}, properties: metas }
    const views = await this.repo.listViews(sourceId)
    const view = views.find((v) => v.id === viewId)
    if (!view) throw notFound('Представление не найдено')
    return { settings: this.asViewSettings(view.settings), properties: metas }
  }

  async listRows(actorUserId: string, input: ListRowsInput): Promise<ListRowsResult> {
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const { settings, properties } = await this.resolveViewContext(source.id, input.viewId)
    const plan = buildRowQuery(settings, properties)

    const limit = input.limit
    const hasPostFilters = plan.multiSelectPostFilters.length > 0

    // Without MULTI_SELECT post-filters: a single over-fetch of limit+1 detects
    // the next page exactly. With post-filters (applied in JS after fetch): a
    // whole DB batch can be eliminated, so we must keep fetching deeper batches
    // until we have limit+1 surviving rows or the DB is exhausted — otherwise
    // pagination would terminate early and silently drop matching rows.
    const collected: Awaited<ReturnType<DatabaseRepository['findRowsPaged']>> = []
    let cursor = input.cursor
    // Batch size: limit+1 normally; larger headroom when post-filtering so we
    // don't loop too many times on sparse matches.
    const batchTake = hasPostFilters ? Math.min(limit * 5 + 1, 1000) : limit + 1
    // Bound the loop so a pathological filter can't fetch the whole table.
    const MAX_BATCHES = hasPostFilters ? 50 : 1
    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const fetched = await this.repo.findRowsPaged({
        sourceId: source.id,
        where: plan.where,
        orderBy: plan.orderBy,
        take: batchTake,
        cursor,
      })
      collected.push(...this.applyMultiSelectPostFilters(fetched, plan.multiSelectPostFilters))
      if (fetched.length < batchTake) break // DB exhausted
      if (collected.length > limit) break // enough survivors for this page + probe
      cursor = fetched.at(-1)?.id // advance to the next DB batch
    }

    const hasMore = collected.length > limit
    const pageRows = hasMore ? collected.slice(0, limit) : collected
    // Keyset cursor = the LAST row of THIS page (`findRowsPaged` re-anchors with
    // `cursor: { id }, skip: 1`, so the next page starts at the row after it).
    const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null

    return { rows: pageRows.map((r) => this.mapRow(r)), nextCursor }
  }

  /**
   * Group rows for the BOARD layout: one bucket per groupBy property option
   * (preserving option order) plus a trailing null/empty bucket for rows with no
   * (or an unknown) option value. Per-bucket rows are sorted by position. No
   * pagination — a focused board view is bounded in practice (documented MVP).
   */
  async listGroupedRows(
    actorUserId: string,
    input: ListGroupedRowsInput,
  ): Promise<GroupedRowsResult> {
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const properties = await this.repo.listProperties(source.id)
    const views = await this.repo.listViews(source.id)
    const view = views.find((v) => v.id === input.viewId)
    if (!view) throw notFound('Представление не найдено')

    const settings = this.asViewSettings(view.settings)
    const groupBy = settings.groupBy?.propertyId
    if (!groupBy) throw badRequest('Для группировки выберите свойство')

    const groupProp = properties.find((p) => p.id === groupBy)
    if (!groupProp) throw badRequest('Свойство группировки не найдено')

    const metas: PropertyMeta[] = properties.map((p) => ({ id: p.id, type: p.type }))
    const plan = buildRowQuery({ filters: settings.filters }, metas)
    const rows = await this.repo.findRowsForGrouping({ sourceId: source.id, where: plan.where })

    const options = asSettings(groupProp.settings)?.options ?? []
    const optionIds = new Set(options.map((o) => o.id))

    // Seed one bucket per option (in option order) + a trailing null bucket.
    const buckets = new Map<string | null, DatabaseRowView[]>()
    for (const o of options) buckets.set(o.id, [])
    buckets.set(null, [])

    for (const row of rows) {
      const cell = row.cells.find((c) => c.propertyId === groupBy)
      const raw = cell?.value
      const key = typeof raw === 'string' && optionIds.has(raw) ? raw : null
      buckets.get(key)!.push(this.mapRow(row))
    }

    const groups = [...buckets.entries()].map(([key, groupRows]) => {
      groupRows.sort((a, b) => a.position - b.position)
      const option = key === null ? null : options.find((o) => o.id === key)
      return {
        key,
        label: option?.label ?? 'Без значения',
        color: option?.color ?? null,
        rows: groupRows,
      }
    })

    return { groups }
  }

  async createRow(actorUserId: string, input: CreateRowInput): Promise<{ rowId: string; pageId: string }> {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const maxPos = await this.repo.maxRowPosition(source.id)
    return this.uow.transaction(async () => {
      // Item page is a child TEXT page of the DATABASE page. Use the focused
      // createItemPageTx so DATABASE/KANBAN provisioning is NOT re-dispatched.
      const itemPage = await this.pageRepo.createItemPageTx(
        input.pageId,
        page.workspaceId,
        actorUserId,
      )
      if (input.title !== undefined && input.title !== '') {
        await this.repo.updatePageTitle(itemPage.id, input.title, actorUserId)
      }
      const created = await this.repo.createRow({
        sourceId: source.id,
        pageId: itemPage.id,
        position: maxPos + POSITION_GAP,
        createdById: actorUserId,
      })
      return { rowId: created.id, pageId: itemPage.id }
    })
  }

  async updateRowTitle(actorUserId: string, input: UpdateRowInput): Promise<{ ok: true }> {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const row = await this.repo.findRowById(input.rowId)
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    if (row.deletedAt) throw notFound('Строка удалена')
    await this.uow.transaction(async () => {
      if (input.title !== undefined) {
        await this.repo.updatePageTitle(row.pageId, input.title, actorUserId)
      }
      if (input.icon !== undefined) {
        await this.repo.updatePageIcon(row.pageId, input.icon, actorUserId)
      }
    })
    return { ok: true as const }
  }

  async deleteRow(actorUserId: string, input: RowIdInput): Promise<{ ok: true }> {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const row = await this.repo.findRowById(input.rowId)
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    if (row.deletedAt) throw notFound('Строка удалена')
    await this.uow.transaction(async () => {
      await this.repo.softDeleteRow(input.rowId, actorUserId)
      await this.repo.softDeleteItemPage(row.pageId, actorUserId, page.workspaceId)
    })
    return { ok: true as const }
  }

  async restoreRow(actorUserId: string, input: RowIdInput): Promise<{ ok: true }> {
    const page = await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const row = await this.repo.findRowById(input.rowId)
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    await this.uow.transaction(async () => {
      await this.repo.restoreRow(input.rowId, actorUserId)
      await this.repo.restoreItemPage(row.pageId, actorUserId, page.workspaceId)
    })
    return { ok: true as const }
  }

  async reorderRows(actorUserId: string, input: ReorderRowsInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const existing = await this.repo.findRowsBySource(source.id)
    const known = new Set(existing.map((r) => r.id))
    for (const id of input.orderedIds) {
      if (!known.has(id)) throw badRequest('Неизвестная строка в порядке сортировки')
    }
    const ordered = input.orderedIds.map((id, idx) => ({ id, position: (idx + 1) * POSITION_GAP }))
    await this.repo.reorderRows(ordered)
    return { ok: true as const }
  }

  /**
   * Set a single row's fractional position (board drag). Unlike reorderRows this
   * touches only the dragged row, so positions in other board columns are left
   * intact (no shared-position-space contamination).
   */
  async setRowPosition(actorUserId: string, input: SetRowPositionInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const row = await this.repo.findRowById(input.rowId)
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    if (row.deletedAt) throw notFound('Строка удалена')
    await this.repo.reorderRows([{ id: input.rowId, position: input.position }])
    return { ok: true as const }
  }

  // Touch assertCanComment so the helper is part of the service surface (used by
  // future comment flows + parity with KanbanService). Kept private + referenced
  // here to avoid an unused-method lint while comments land in a later phase.
  protected readonly _commentGuard = this.assertCanComment.bind(this)
}
