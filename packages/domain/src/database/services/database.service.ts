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
  ListRowsInput,
  ListRowsResult,
  PropertyIdInput,
  PropertySettings,
  ReorderPropertiesInput,
  ReorderRowsInput,
  RowIdInput,
  SelectOption,
  UpdateCellValueInput,
  UpdatePropertyInput,
  UpdateRowInput,
  UpdateViewInput,
  ViewIdInput,
} from '../dto/database.dto.ts'
import type {
  AccessiblePage,
  DatabaseRepository,
} from '../repositories/database.repository.ts'

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
    const loaded = await this.repo.findSourceByPageId(pageId)
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
    const existing = await this.repo.listViews(source.id)
    const position = (existing.at(-1)?.position ?? 0) + POSITION_GAP
    return this.repo.createView({
      sourceId: source.id,
      type: input.type ?? DatabaseViewType.TABLE,
      title: input.title,
      position,
    })
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

  // ── Rows (create/title/delete bridge implemented in A4) ──────────────────────

  async listRows(actorUserId: string, input: ListRowsInput): Promise<ListRowsResult> {
    // NOTE: A2 placeholder — the view-aware paginated implementation lands in C2.
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const rows = await this.repo.findRowsBySource(source.id)
    return {
      rows: rows.map((r) => ({
        rowId: r.id,
        pageId: r.pageId,
        title: r.page.title,
        icon: r.page.icon,
        position: r.position,
        cells: Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value])),
      })),
      nextCursor: null,
    }
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

  // Touch assertCanComment so the helper is part of the service surface (used by
  // future comment flows + parity with KanbanService). Kept private + referenced
  // here to avoid an unused-method lint while comments land in a later phase.
  protected readonly _commentGuard = this.assertCanComment.bind(this)
}
