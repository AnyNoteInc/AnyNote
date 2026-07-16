import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { ItemPageCreator } from '../../shared/item-page-creator.ts'
// Enum values are re-exported through the dto barrel so the service never
// imports `@repo/db` as a value (domain-services-no-db-value rule).
import { DatabasePropertyType, DatabaseViewType, MAX_BOARD_ROWS } from '../dto/database.dto.ts'
import type {
  AccessRuleView,
  CreateAccessRuleInput,
  CreatePropertyInput,
  CreateRowInput,
  CreateViewInput,
  DatabaseGetByPageResult,
  DatabaseRowView,
  DeleteAccessRuleInput,
  DuplicateViewInput,
  GroupedRowsResult,
  ListAccessRulesInput,
  ListGroupedRowsInput,
  ListLinkableRowsInput,
  ListRowsInput,
  ListRowsResult,
  MyDatabaseAccess,
  PropertyIdInput,
  PropertySettings,
  RelationChip,
  ReorderPropertiesInput,
  ReorderRowsInput,
  SetRelationLinksInput,
  SetRowPositionInput,
  SetStructureLockedInput,
  RowIdInput,
  SelectOption,
  UpdateAccessRuleInput,
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
  EnabledAccessRule,
  PropertyRow,
  RowWithPage,
  SourceWithLock,
} from '../repositories/database.repository.ts'
import { EMBEDDED_VIEW_CONFLICT_MESSAGE } from '../repositories/database.repository.ts'
import {
  buildRowAccessWhere,
  canEditRow,
  canViewRow,
  resolveRowAccess,
} from './row-access-resolver.ts'
import type { AccessRule, RowAccessContext, RowAccessRow } from './row-access-resolver.ts'
// The shared, single-sourced row post-filter + per-viewer row-access authority.
// The private methods below delegate to these (the dashboard widget service
// consumes the same functions through the database barrel — no copy drift).
import {
  applyMultiSelectPostFilters as sharedApplyMultiSelectPostFilters,
  applyRelationPostFilters as sharedApplyRelationPostFilters,
  buildRowAccessContext as sharedBuildRowAccessContext,
  filterViewableRows as sharedFilterViewableRows,
  toAccessRow as sharedToAccessRow,
  toResolverRules as sharedToResolverRules,
} from './row-post-filters.ts'
import { tokenize, parse, FormulaSyntaxError } from '../formula/index.ts'
import { resolveComputedCells } from './computed-cells.ts'
import type {
  PageMeta,
  PropertyMeta as ComputedPropertyMeta,
  RowWithCells,
} from './computed-cells.ts'
import { buildRowQuery } from './query-planner.ts'
import type { MultiSelectPostFilter, PropertyMeta, RelationPostFilter } from './query-planner.ts'
import { assertCanEditDatabaseStructure } from './database-structure-access.ts'
import type { FormRepositoryContract } from '../forms/database-form.repository.ts'
import type { DatabaseFormService } from '../forms/database-form.service.ts'

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

function normalizePersistedFileValue(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw]
  if (!Array.isArray(raw)) return []
  return raw.every((value) => typeof value === 'string' && value.trim() !== '')
    ? (raw as string[])
    : []
}

// Computed-on-read property types: never written as stored cells; values are
// resolved by `resolveComputedCells`. A write to one of these is rejected.
const READ_ONLY_TYPES = new Set<DatabasePropertyType>([
  DatabasePropertyType.FORMULA,
  DatabasePropertyType.ROLLUP,
  DatabasePropertyType.CREATED_TIME,
  DatabasePropertyType.CREATED_BY,
  DatabasePropertyType.LAST_EDITED_TIME,
  DatabasePropertyType.LAST_EDITED_BY,
])

// Property types whose value is RESOLVED on read rather than stored as a cell:
// the read-only metadata above + RELATION (its value lives in DatabaseRelationLink)
// + ROLLUP/FORMULA. Used to decide whether `listRows` needs the batch-fetch pass.
const COMPUTED_TYPES = new Set<DatabasePropertyType>([
  ...READ_ONLY_TYPES,
  DatabasePropertyType.RELATION,
])

// Lenient format validators (store the normalized/original string when matched).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Phone: digits with optional leading +, spaces, dashes, parens — at least 7 digits.
const PHONE_RE = /^\+?[\d\s().-]{7,}$/

export class DatabaseService {
  private readonly repo: DatabaseRepository
  private readonly pageRepo: ItemPageCreator
  private readonly uow: UnitOfWork
  private readonly formRepo: FormRepositoryContract
  private readonly formService: DatabaseFormService
  constructor(
    repo: DatabaseRepository,
    pageRepo: ItemPageCreator,
    uow: UnitOfWork,
    formRepo: FormRepositoryContract,
    formService: DatabaseFormService,
  ) {
    this.repo = repo
    this.pageRepo = pageRepo
    this.uow = uow
    this.formRepo = formRepo
    this.formService = formService
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

  /** Resolve the source WITH its lock flag + the source page creator. */
  private async requireSourceWithLock(pageId: string): Promise<SourceWithLock> {
    const source = await this.repo.findSourceWithLockByPageId(pageId)
    if (!source) throw notFound('База данных не найдена для этой страницы')
    return source
  }

  /** Resolve a source by page + assert the actor may edit its structure. */
  private async requireStructureEdit(
    actorUserId: string,
    pageId: string,
  ): Promise<SourceWithLock> {
    const source = await this.requireSourceWithLock(pageId)
    await assertCanEditDatabaseStructure(this.repo, actorUserId, source)
    return source
  }

  // ── Access rules + structure lock + getMyAccess (Phase 4C) ───────────────────

  // The row post-filter + per-viewer row-access authority is single-sourced in
  // `./row-post-filters.ts`; these private methods delegate to it (the dashboard
  // widget service consumes the same functions through the database barrel).

  /** Map a repo EnabledAccessRule to the resolver's AccessRule shape. */
  private toResolverRules(rules: EnabledAccessRule[]): AccessRule[] {
    return sharedToResolverRules(rules)
  }

  /**
   * Build the viewer's RowAccessContext for a source. `pageShareLevel` is the
   * per-ITEM-page share grant, only meaningful for a single known item page; for
   * list reads pass `itemPageId = null` (no per-row share, broad/role + rules
   * suffice). The resolver raises with the share level when present.
   */
  private async buildRowAccessContext(
    actorUserId: string | null,
    source: { id: string; workspaceId: string; pageId: string },
    itemPageId: string | null,
  ): Promise<RowAccessContext> {
    return sharedBuildRowAccessContext(this.repo, actorUserId, source, itemPageId)
  }

  /**
   * Build a RowAccessRow (createdBy + the cells keyed by propertyId) from a
   * fetched RowWithPage — the shape the resolver matches PERSON/CREATED_BY rules
   * against.
   */
  private toAccessRow(row: RowWithPage): { id: string } & RowAccessRow {
    return sharedToAccessRow(row)
  }

  /**
   * The AUTHORITATIVE per-row read gate: drop every fetched row the viewer can't
   * view (`resolveRowAccessForRows → null`). When there are no enabled rules and
   * the viewer is a member this keeps every row. The DB `buildRowAccessWhere`
   * predicate is only an optimization — this post-filter is the real boundary.
   */
  private filterViewableRows(
    ctx: RowAccessContext,
    rules: AccessRule[],
    rows: RowWithPage[],
  ): RowWithPage[] {
    return sharedFilterViewableRows(ctx, rules, rows)
  }

  /**
   * The per-row CONTENT-EDIT gate (updateCellValue/updateRow/deleteRow): fetch the
   * specific row's access inputs, resolve the viewer's level, require
   * ≥CAN_EDIT_CONTENT. Throws FORBIDDEN otherwise. Rows the resolver returns null
   * for (no view) also fail here.
   */
  private async assertCanEditRow(
    actorUserId: string,
    source: { id: string; workspaceId: string; pageId: string },
    rowId: string,
    itemPageId: string,
  ): Promise<void> {
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    // Fast path: no rules → the page-level assertCanEdit already authorized.
    if (rules.length === 0) return
    const ctx = await this.buildRowAccessContext(actorUserId, source, itemPageId)
    const accessRow = await this.repo.findRowForAccess(rowId)
    const row: RowAccessRow = accessRow
      ? { rowCreatedById: accessRow.rowCreatedById, cellsByProperty: accessRow.cellsByProperty }
      : { rowCreatedById: null, cellsByProperty: new Map() }
    const level = resolveRowAccess(ctx, rules, row)
    if (!canEditRow(level)) {
      throw forbidden('Недостаточно прав для изменения этой строки')
    }
  }

  /**
   * Phase 5 (notifications): can `actorUserId` VIEW the given row of the DATABASE
   * page? Reuses the cl4C row-access resolver so a notification recipient who
   * lost row access never receives a content-bearing database notification.
   * Returns false (never throws) when the page/source/row is missing or the
   * viewer has no workspace access — the caller is a side-effect fan-out.
   */
  async canUserViewRow(actorUserId: string, pageId: string, rowId: string): Promise<boolean> {
    const page = await this.repo.findAccessiblePage(actorUserId, pageId)
    if (!page) return false
    const source = await this.repo.findSourceMetaByPageId(pageId)
    if (!source) return false
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    const accessRow = await this.repo.findRowForAccess(rowId)
    if (!accessRow || accessRow.sourceId !== source.id) return false
    // No rules + a workspace member → every row is viewable (matches the read gate).
    if (rules.length === 0) return true
    // itemPageId=null: no per-item share lookup (broad/role + PERSON/CREATED_BY
    // rules govern viewability), matching the list-read access path.
    const ctx = await this.buildRowAccessContext(actorUserId, source, null)
    const row: RowAccessRow = {
      rowCreatedById: accessRow.rowCreatedById,
      cellsByProperty: accessRow.cellsByProperty,
    }
    return canViewRow(resolveRowAccess(ctx, rules, row))
  }

  async listAccessRules(
    actorUserId: string,
    input: ListAccessRulesInput,
  ): Promise<AccessRuleView[]> {
    // Listing rules is a READ (workspace membership) — not a structure edit.
    // Mutating rules (create/update/delete) still requires structure-edit rights.
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const rules = await this.repo.listAccessRules(source.id)
    return rules.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      accessLevel: r.accessLevel,
      enabled: r.enabled,
    }))
  }

  async createAccessRule(
    actorUserId: string,
    input: CreateAccessRuleInput,
  ): Promise<AccessRuleView> {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const prop = await this.repo.findPropertyById(input.propertyId)
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    // Only PERSON and CREATED_BY properties are valid rule targets (the resolver
    // matches a viewer's userId against the cell / row creator).
    if (
      prop.type !== DatabasePropertyType.PERSON &&
      prop.type !== DatabasePropertyType.CREATED_BY
    ) {
      throw badRequest('Правило доступа применимо только к свойству «Человек» или «Кем создано»')
    }
    const rule = await this.repo.createAccessRule({
      sourceId: source.id,
      propertyId: input.propertyId,
      accessLevel: input.accessLevel,
    })
    return { id: rule.id, propertyId: rule.propertyId, accessLevel: rule.accessLevel, enabled: rule.enabled }
  }

  async updateAccessRule(
    actorUserId: string,
    input: UpdateAccessRuleInput,
  ): Promise<AccessRuleView> {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const existing = await this.repo.findAccessRuleById(input.ruleId)
    if (!existing || existing.sourceId !== source.id) throw notFound('Правило доступа не найдено')
    const rule = await this.repo.updateAccessRule({
      id: input.ruleId,
      ...(input.accessLevel === undefined ? {} : { accessLevel: input.accessLevel }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    })
    return { id: rule.id, propertyId: rule.propertyId, accessLevel: rule.accessLevel, enabled: rule.enabled }
  }

  async deleteAccessRule(
    actorUserId: string,
    input: DeleteAccessRuleInput,
  ): Promise<{ ok: true }> {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const existing = await this.repo.findAccessRuleById(input.ruleId)
    if (!existing || existing.sourceId !== source.id) throw notFound('Правило доступа не найдено')
    await this.repo.deleteAccessRule(input.ruleId)
    return { ok: true as const }
  }

  /**
   * Lock/unlock the structure. OWNER/ADMIN only (the lock exists to constrain the
   * creator + editors, so creator/editor self-lock would be self-defeating).
   */
  async setStructureLocked(
    actorUserId: string,
    input: SetStructureLockedInput,
  ): Promise<{ ok: true }> {
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSourceWithLock(input.pageId)
    const role = await this.repo.findWorkspaceRole(actorUserId, source.workspaceId)
    if (role !== 'OWNER' && role !== 'ADMIN') {
      throw forbidden('Блокировать структуру может только владелец или администратор')
    }
    await this.repo.setStructureLocked(source.id, input.locked)
    return { ok: true as const }
  }

  /**
   * The viewer's source-level capabilities, for UI affordances. The authoritative
   * gate is always server-side; this drives disabling only.
   *  - canEditStructure: `assertCanEditStructure` would pass.
   *  - canEditContent: owner/admin/creator, OR (no rules → a workspace EDITOR+);
   *    when rules exist a plain member's content rights are per-row, so the
   *    source-level flag stays true only for broad-access viewers + EDITOR-by-role
   *    (matched rows still gate per-row on write).
   */
  async getMyAccess(actorUserId: string, pageId: string): Promise<MyDatabaseAccess> {
    const source = await this.requireSourceWithLock(pageId)
    const role = await this.repo.findWorkspaceRole(actorUserId, source.workspaceId)
    const isCreator = source.pageCreatedById === actorUserId

    const isOwnerAdmin = role === 'OWNER' || role === 'ADMIN'
    const canEditStructure = isOwnerAdmin || (isCreator && !source.structureLocked)
    const canEditContent =
      isOwnerAdmin || isCreator || role === 'EDITOR'

    return { canEditContent, canEditStructure, structureLocked: source.structureLocked }
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
    const myAccess = await this.getMyAccess(actorUserId, pageId)
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
      myAccess,
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
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const type = input.type ?? DatabaseViewType.TABLE
    if (type === DatabaseViewType.FORM) throw badRequest('FORM_REQUIRES_CREATE_FORM')
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
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const view = await this.repo.findViewById(input.id)
    if (!view || view.sourceId !== source.id) throw notFound('Представление не найдено')
    if (view.type === DatabaseViewType.FORM) {
      if (input.title === undefined || input.settings !== undefined) {
        throw badRequest('FORM_VIEW_UPDATE_INVALID')
      }
      return this.formService.renameByView(actorUserId, {
        pageId: input.pageId,
        viewId: view.id,
        title: input.title,
      })
    }
    return this.repo.updateView(input.id, {
      title: input.title,
      ...(input.settings === undefined
        ? {}
        : { settings: input.settings as Parameters<DatabaseRepository['updateView']>[1]['settings'] }),
    })
  }

  async deleteView(actorUserId: string, input: ViewIdInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const initialSource = await this.requireStructureEdit(actorUserId, input.pageId)
    return this.uow.transaction(async () => {
      if (!(await this.repo.lockSourceForStructureMutation(initialSource.id, new Date()))) {
        throw conflict('FORM_SOURCE_CONFLICT')
      }
      const source = await this.requireStructureEdit(actorUserId, input.pageId)
      const view = await this.repo.findViewById(input.id)
      if (!view || view.sourceId !== source.id) throw notFound('Представление не найдено')
      if (view.type === DatabaseViewType.FORM) {
        if (view.formId === null) throw notFound('FORM_VIEW_NOT_FOUND')
        return this.formService.archive(actorUserId, {
          pageId: input.pageId,
          formId: view.formId,
        })
      }
      const all = await this.repo.listViews(source.id)
      if (all.length <= 1) throw badRequest('Нельзя удалить единственное представление')
      if (await this.repo.hasEmbeddedViewReference(source.workspaceId, view.id)) {
        throw conflict(EMBEDDED_VIEW_CONFLICT_MESSAGE)
      }
      await this.repo.deleteView(input.id)
      return { ok: true as const }
    })
  }

  /** Copy a view (title + " (копия)", type, settings) at the next position. */
  async duplicateView(actorUserId: string, input: DuplicateViewInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const views = await this.repo.listViews(source.id)
    const view = views.find((v) => v.id === input.viewId)
    if (!view) throw notFound('Представление не найдено')
    if (view.type === DatabaseViewType.FORM) {
      return this.formService.duplicateByView(actorUserId, input)
    }
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
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    if (input.settings !== undefined) {
      await this.validatePropertySettings(source.id, source.workspaceId, input.type, input.settings)
    }
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
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const initialProperty = await this.repo.findPropertyById(input.id)
    if (!initialProperty || initialProperty.sourceId !== source.id) {
      throw notFound('Свойство не найдено')
    }
    if (input.type === undefined && input.settings === undefined) {
      return this.repo.updateProperty(input.id, { name: input.name })
    }

    return this.uow.transaction(async () => {
      if (!(await this.repo.lockSourceForStructureMutation(source.id, new Date()))) {
        throw conflict('FORM_SOURCE_CONFLICT')
      }
      const lockedSource = await this.requireStructureEdit(actorUserId, input.pageId)
      const property = await this.repo.findPropertyById(input.id)
      if (!property || property.sourceId !== lockedSource.id) throw notFound('Свойство не найдено')
      if (input.settings !== undefined) {
        await this.validatePropertySettings(
          lockedSource.id,
          lockedSource.workspaceId,
          input.type ?? property.type,
          input.settings,
        )
      }
      const dependency = this.propertyDependencyScope(property, input)
      const protectedByForm =
        dependency === null
          ? false
          : dependency.removedOptionIds === undefined
            ? await this.formRepo.hasProtectedPropertyDependency(input.id, new Date())
            : await this.formRepo.hasProtectedPropertyDependency(
                input.id,
                new Date(),
                dependency.removedOptionIds,
              )
      if (protectedByForm) {
        throw conflict('FORM_PROPERTY_IN_USE')
      }
      return this.repo.updateProperty(input.id, {
        name: input.name,
        type: input.type,
        ...(input.settings === undefined ? {} : { settings: input.settings as never }),
      })
    })
  }

  private propertyDependencyScope(
    property: { type: DatabasePropertyType; settings: unknown },
    input: Pick<UpdatePropertyInput, 'type' | 'settings'>,
  ): { removedOptionIds?: string[] } | null {
    if (input.type !== undefined && input.type !== property.type) return {}
    if (input.settings === undefined) return null

    if (property.type === DatabasePropertyType.RELATION) {
      const current = asSettings(property.settings)?.relation?.targetSourceId
      const next = input.settings.relation?.targetSourceId
      if (current !== next) return {}
    }

    if (
      property.type === DatabasePropertyType.STATUS ||
      property.type === DatabasePropertyType.SELECT ||
      property.type === DatabasePropertyType.MULTI_SELECT
    ) {
      const currentIds = new Set((asSettings(property.settings)?.options ?? []).map(({ id }) => id))
      const nextIds = new Set((input.settings.options ?? []).map(({ id }) => id))
      const removedOptionIds = [...currentIds].filter((id) => !nextIds.has(id))
      return removedOptionIds.length === 0 ? null : { removedOptionIds }
    }
    return null
  }

  /**
   * Validate the per-type settings of a FORMULA / RELATION / ROLLUP property:
   * - FORMULA: the expression must tokenize+parse (a runtime error on the empty
   *   scope is fine; only a syntax error is rejected).
   * - RELATION: `targetSourceId` must be a DatabaseSource in THIS workspace.
   * - ROLLUP: `relationPropertyId` must be a RELATION property on THIS source, and
   *   `targetPropertyId` must be '__title__' or an existing property on the
   *   related source.
   */
  private async validatePropertySettings(
    sourceId: string,
    workspaceId: string,
    type: DatabasePropertyType,
    settings: PropertySettings,
  ): Promise<void> {
    if (type === DatabasePropertyType.FORMULA) {
      this.validateFormulaSettings(settings)
    } else if (type === DatabasePropertyType.RELATION) {
      await this.validateRelationSettings(workspaceId, settings)
    } else if (type === DatabasePropertyType.ROLLUP) {
      await this.validateRollupSettings(sourceId, settings)
    }
  }

  private validateFormulaSettings(settings: PropertySettings): void {
    const formula = settings.formula
    if (!formula || formula.trim() === '') return
    // Reject only a genuine SYNTAX error (tokenize/parse). A runtime error on the
    // empty scope (unknown prop → null, division by zero, etc.) is fine — formulas
    // are evaluated against real row values on read.
    try {
      parse(tokenize(formula))
    } catch (e) {
      if (e instanceof FormulaSyntaxError) throw badRequest(`Ошибка в формуле: ${e.message}`)
      throw e
    }
  }

  private async validateRelationSettings(
    workspaceId: string,
    settings: PropertySettings,
  ): Promise<void> {
    const relation = settings.relation
    if (!relation) throw badRequest('Не настроена целевая база для связи')
    const targetWs = await this.repo.findSourceWorkspaceId(relation.targetSourceId)
    if (targetWs === null) throw badRequest('Целевая база данных не найдена')
    if (targetWs !== workspaceId) {
      throw badRequest('Целевая база данных принадлежит другому пространству')
    }
  }

  private async validateRollupSettings(
    sourceId: string,
    settings: PropertySettings,
  ): Promise<void> {
    const rollup = settings.rollup
    if (!rollup) throw badRequest('Не настроен сводный показатель')
    const properties = await this.repo.listProperties(sourceId)
    const relationProp = properties.find((p) => p.id === rollup.relationPropertyId)
    if (!relationProp || relationProp.type !== DatabasePropertyType.RELATION) {
      throw badRequest('Свойство связи для сводки не найдено')
    }
    const relation = asSettings(relationProp.settings)?.relation
    if (!relation) throw badRequest('Связь для сводки не настроена')
    if (rollup.targetPropertyId !== '__title__') {
      const targetProps = await this.repo.listProperties(relation.targetSourceId)
      if (!targetProps.some((p) => p.id === rollup.targetPropertyId)) {
        throw badRequest('Целевое свойство сводки не найдено')
      }
    }
  }

  async deleteProperty(actorUserId: string, input: PropertyIdInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
    const prop = await this.repo.findPropertyById(input.id)
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    return this.uow.transaction(async () => {
      if (!(await this.repo.lockSourceForStructureMutation(source.id, new Date()))) {
        throw conflict('FORM_SOURCE_CONFLICT')
      }
      const lockedSource = await this.requireStructureEdit(actorUserId, input.pageId)
      const lockedProperty = await this.repo.findPropertyById(input.id)
      if (!lockedProperty || lockedProperty.sourceId !== lockedSource.id) {
        throw notFound('Свойство не найдено')
      }
      if (await this.formRepo.hasProtectedPropertyDependency(input.id, new Date())) {
        throw conflict('FORM_PROPERTY_IN_USE')
      }
      // Cells cascade via the DatabaseCellValue → DatabaseProperty FK.
      await this.repo.deleteProperty(input.id)
      return { ok: true as const }
    })
  }

  async reorderProperties(actorUserId: string, input: ReorderPropertiesInput) {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireStructureEdit(actorUserId, input.pageId)
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

    // Phase 4C: per-row content-edit gate (≥CAN_EDIT_CONTENT on THIS row).
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)

    // Computed-on-read columns (formula/rollup/metadata) are never stored.
    if (READ_ONLY_TYPES.has(prop.type)) {
      throw badRequest('Свойство доступно только для чтения')
    }

    // DATE cells may arrive via the coerced dateValue field.
    const rawValue =
      prop.type === DatabasePropertyType.DATE && input.dateValue !== undefined
        ? input.dateValue
        : input.value

    // PERSON: validate workspace membership before persisting the userId.
    if (
      prop.type === DatabasePropertyType.PERSON &&
      rawValue !== null &&
      rawValue !== undefined &&
      rawValue !== ''
    ) {
      if (typeof rawValue !== 'string') throw badRequest('Ожидался идентификатор пользователя')
      const ok = await this.repo.isWorkspaceMember(rawValue, source.workspaceId)
      if (!ok) throw badRequest('Пользователь не является участником рабочего пространства')
    }

    if (prop.type === DatabasePropertyType.FILE) {
      const fileIds = this.validateFileCellValue(rawValue)
      await this.repo.upsertFileCellValue(input.rowId, input.propertyId, fileIds)
      return { ok: true as const }
    }

    const value = this.validateCellValue(prop.type, asSettings(prop.settings), rawValue)
    await this.repo.upsertCellValue(input.rowId, input.propertyId, value)
    return { ok: true as const }
  }

  private validateFileCellValue(raw: unknown): string[] {
    if (
      !Array.isArray(raw) ||
      !raw.every(
        (fileId): fileId is string => typeof fileId === 'string' && fileId.trim() !== '',
      )
    ) {
      throw badRequest('Ожидался список файлов')
    }
    const fileIds = raw
    if (new Set(fileIds).size !== fileIds.length) {
      throw badRequest('Файлы не должны повторяться')
    }
    return fileIds
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
        // Reject NaN AND ±Infinity — JSON.stringify(Infinity) is "null", so a
        // non-finite value would silently round-trip to an empty cell (data loss).
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          throw badRequest('Ожидалось число')
        }
        return raw
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
      case DatabasePropertyType.URL: {
        const s = typeof raw === 'string' ? raw.trim() : ''
        if (!s) return null
        let parsed: URL
        try {
          parsed = new URL(s)
        } catch {
          throw badRequest('Некорректный URL')
        }
        // Only http/https — reject javascript:/data:/etc. so a stored value can
        // never become an XSS vector wherever it is later rendered as a link.
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw badRequest('Некорректный URL')
        }
        return s
      }
      case DatabasePropertyType.EMAIL: {
        const s = typeof raw === 'string' ? raw.trim() : ''
        if (!EMAIL_RE.test(s)) throw badRequest('Некорректный email')
        return s
      }
      case DatabasePropertyType.PHONE: {
        const s = typeof raw === 'string' ? raw.trim() : ''
        if (!PHONE_RE.test(s)) throw badRequest('Некорректный номер телефона')
        return s
      }
      case DatabasePropertyType.PERSON:
      case DatabasePropertyType.PAGE_LINK:
      case DatabasePropertyType.TEXT:
      default:
        return typeof raw === 'string' ? raw : String(raw)
    }
  }

  // ── Relations (links + back-relation mirror) ─────────────────────────────────

  /**
   * Replace the full link set for a (rowId, propertyId) RELATION cell. Validates
   * the property is a configured RELATION and every target row lives in the SAME
   * workspace (cross-workspace targets are rejected). When the relation has a
   * `backRelationPropertyId`, the mirror links on the affected target rows are
   * synced so the back-relation reflects the change (rows added gain a mirror to
   * this row; rows removed lose it).
   */
  async setRelationLinks(actorUserId: string, input: SetRelationLinksInput): Promise<{ ok: true }> {
    await this.assertCanEdit(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)

    const [prop, row] = await Promise.all([
      this.repo.findPropertyById(input.propertyId),
      this.repo.findRowById(input.rowId),
    ])
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    if (prop.type !== DatabasePropertyType.RELATION) {
      throw badRequest('Свойство не является связью')
    }
    if (!row || row.sourceId !== source.id) throw notFound('Строка не найдена')
    if (row.deletedAt) throw notFound('Строка удалена')
    // Relation links are a content edit on the SOURCE row — gate per-row like
    // updateCellValue, so a viewer with only CAN_VIEW on this row can't mutate it.
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)

    const settings = asSettings(prop.settings)
    const relation = settings?.relation
    if (!relation) throw badRequest('Связь не настроена')

    const targetRowIds = [...new Set(input.targetRowIds)]

    // Every target must exist and belong to THIS workspace (no cross-workspace).
    if (targetRowIds.length > 0) {
      const wsByRow = await this.repo.findRowWorkspaceIds(targetRowIds)
      for (const id of targetRowIds) {
        const ws = wsByRow.get(id)
        if (ws === undefined) throw badRequest('Связанная строка не найдена')
        if (ws !== source.workspaceId) throw badRequest('Нельзя связать строку из другого пространства')
      }
    }

    await this.uow.transaction(async () => {
      // Previous forward links (needed to compute back-relation removals).
      const backProp = relation.backRelationPropertyId
      const previousTargets = backProp
        ? (await this.repo.findRelationLinks(input.propertyId, [input.rowId])).get(input.rowId) ?? []
        : []

      await this.repo.replaceRelationLinks({
        propertyId: input.propertyId,
        rowId: input.rowId,
        targetRowIds,
      })

      if (backProp) {
        await this.syncBackRelation(backProp, input.rowId, previousTargets, targetRowIds)
      }
    })

    return { ok: true as const }
  }

  /**
   * Sync the back-relation mirror after a forward link-set change: for each target
   * row that gained a forward link, ensure its mirror set (backProp, targetRow)
   * includes `sourceRowId`; for each that lost the link, ensure it no longer does.
   * Reads each affected target's current mirror set and rewrites it.
   */
  private async syncBackRelation(
    backPropertyId: string,
    sourceRowId: string,
    previousTargets: string[],
    nextTargets: string[],
  ): Promise<void> {
    const prevSet = new Set(previousTargets)
    const nextSet = new Set(nextTargets)
    const added = nextTargets.filter((id) => !prevSet.has(id))
    const removed = previousTargets.filter((id) => !nextSet.has(id))
    const affected = [...new Set([...added, ...removed])]
    if (affected.length === 0) return

    const mirrorByTarget = await this.repo.findRelationLinks(backPropertyId, affected)
    for (const targetRowId of affected) {
      const current = new Set(mirrorByTarget.get(targetRowId) ?? [])
      if (nextSet.has(targetRowId)) current.add(sourceRowId)
      else current.delete(sourceRowId)
      await this.repo.replaceRelationLinks({
        propertyId: backPropertyId,
        rowId: targetRowId,
        targetRowIds: [...current],
      })
    }
  }

  /** Candidate rows of a RELATION property's target source for the link picker. */
  async listLinkableRows(
    actorUserId: string,
    input: ListLinkableRowsInput,
  ): Promise<{ id: string; pageId: string; title: string | null }[]> {
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const prop = await this.repo.findPropertyById(input.propertyId)
    if (!prop || prop.sourceId !== source.id) throw notFound('Свойство не найдено')
    if (prop.type !== DatabasePropertyType.RELATION) throw badRequest('Свойство не является связью')
    const relation = asSettings(prop.settings)?.relation
    if (!relation) throw badRequest('Связь не настроена')
    const candidates = await this.repo.findLinkableRows(relation.targetSourceId, input.query)
    return this.filterLinkableByTargetAccess(actorUserId, relation.targetSourceId, candidates)
  }

  /**
   * The relation picker must not leak titles of rows the viewer cannot access
   * under the TARGET source's access rules. Resolve each candidate in the target
   * source's context and drop the ones the viewer can't view.
   */
  private async filterLinkableByTargetAccess(
    actorUserId: string,
    targetSourceId: string,
    candidates: { id: string; pageId: string; title: string | null }[],
  ): Promise<{ id: string; pageId: string; title: string | null }[]> {
    if (candidates.length === 0) return candidates
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(targetSourceId))
    if (rules.length === 0) return candidates // target unrestricted
    const targetSource = await this.repo.findSourceMetaById(targetSourceId)
    if (!targetSource) return [] // target source vanished → reveal nothing
    const ctx = await this.buildRowAccessContext(actorUserId, targetSource, targetSource.pageId)
    const meta = await this.repo.findRowsAccessMetaByIds(candidates.map((c) => c.id))
    const byId = new Map(meta.map((m) => [m.id, m]))
    return candidates.filter((c) => {
      const m = byId.get(c.id)
      const row: RowAccessRow = m
        ? { rowCreatedById: m.createdById, cellsByProperty: m.cellsByProperty }
        : { rowCreatedById: null, cellsByProperty: new Map() }
      return canViewRow(resolveRowAccess(ctx, rules, row))
    })
  }

  // ── Rows (view-aware, paginated) ─────────────────────────────────────────────

  /** Coerce a persisted view settings blob (unknown JSON) into ViewSettings. */
  private asViewSettings(raw: unknown): ViewSettings {
    if (raw && typeof raw === 'object') return raw as ViewSettings
    return {}
  }

  private normalizePersistedFileCells(
    cells: Record<string, unknown>,
    properties: PropertyRow[],
  ): Record<string, unknown> {
    const normalized = { ...cells }
    for (const property of properties) {
      if (property.type === DatabasePropertyType.FILE) {
        normalized[property.id] = normalizePersistedFileValue(cells[property.id])
      }
    }
    return normalized
  }

  /** Map a repo RowWithPage to the DatabaseRowView the renderer consumes. */
  private mapRow(r: RowWithPage, properties: PropertyRow[]): DatabaseRowView {
    const cells = Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value]))
    return {
      rowId: r.id,
      pageId: r.pageId,
      title: r.page.title,
      icon: r.page.icon,
      position: r.position,
      cells: this.normalizePersistedFileCells(cells, properties),
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
    return sharedApplyMultiSelectPostFilters(rows, postFilters)
  }

  /**
   * Apply RELATION post-filters: a row passes `is_any_of` when its linked target
   * ids (for the filtered RELATION property) intersect the wanted set, and
   * `is_none_of` when they are disjoint. The links can't be expressed in the
   * Prisma `where` (they live in DatabaseRelationLink), so they are resolved in
   * one batched query per filter for the page of fetched rows (no per-row query).
   */
  private async applyRelationPostFilters(
    rows: RowWithPage[],
    postFilters: RelationPostFilter[],
  ): Promise<RowWithPage[]> {
    return sharedApplyRelationPostFilters(this.repo, rows, postFilters)
  }

  /** Resolve a view's settings + the source's property metas for the planner. */
  private async resolveViewContext(
    sourceId: string,
    viewId: string | undefined,
  ): Promise<{ settings: ViewSettings; properties: PropertyMeta[]; fullProperties: PropertyRow[] }> {
    const fullProperties = await this.repo.listProperties(sourceId)
    const metas: PropertyMeta[] = fullProperties.map((p) => ({ id: p.id, type: p.type }))
    if (!viewId) return { settings: {}, properties: metas, fullProperties }
    const views = await this.repo.listViews(sourceId)
    const view = views.find((v) => v.id === viewId)
    if (!view) throw notFound('Представление не найдено')
    return { settings: this.asViewSettings(view.settings), properties: metas, fullProperties }
  }

  // ── Compute-on-read augmentation ─────────────────────────────────────────────

  /**
   * Remove inaccessible TARGET rows from the relation link sets (Phase 4C). For
   * every distinct target source, fetch its enabled rules; if a target source has
   * rules, resolve each of its target rows through the viewer's context FOR THAT
   * SOURCE and drop the ids the viewer can't view (`!canViewRow`) from every link
   * list AND from `targetRowIds`. Batched: one access-meta fetch for the union of
   * targets + one rules fetch for the distinct target sources (no N+1). A no-op
   * when no target source has any enabled rule (the common case).
   */
  private async excludeInaccessibleTargets(
    actorUserId: string,
    relationLinksByProp: Map<string, Map<string, string[]>>,
    targetRowIds: Set<string>,
  ): Promise<void> {
    if (targetRowIds.size === 0) return
    const meta = await this.repo.findRowsAccessMetaByIds([...targetRowIds])
    if (meta.length === 0) return

    const distinctSourceIds = [...new Set(meta.map((m) => m.sourceId))]
    const rulesBySource = await this.repo.findEnabledAccessRulesForSources(distinctSourceIds)
    // Nothing to enforce if no target source carries a rule.
    if (rulesBySource.size === 0) return

    // Resolve each target row's access in its own source's context. Memoize the
    // viewer context per (target source) since it only depends on the source.
    const ctxBySource = new Map<string, RowAccessContext>()
    const inaccessible = new Set<string>()
    for (const m of meta) {
      const rules = rulesBySource.get(m.sourceId)
      if (!rules || rules.length === 0) continue // source unrestricted → keep
      let ctx = ctxBySource.get(m.sourceId)
      if (!ctx) {
        ctx = await this.buildRowAccessContext(
          actorUserId,
          { id: m.sourceId, workspaceId: m.workspaceId, pageId: m.pageId },
          // The target row IS an item page; its per-item share could apply, but
          // pageId here is the target ROW's page, not the target SOURCE page. The
          // context's isSourcePageCreator needs the target source page — which we
          // don't carry — so pass the row's pageId for share resolution only and
          // rely on role + rule matching (creator-of-target-source is rare for a
          // cross-row chip and conservatively treated as non-creator here).
          m.pageId,
        )
        ctxBySource.set(m.sourceId, ctx)
      }
      const level = resolveRowAccess(
        ctx,
        this.toResolverRules(rules),
        { rowCreatedById: m.createdById, cellsByProperty: m.cellsByProperty },
      )
      if (!canViewRow(level)) inaccessible.add(m.id)
    }

    // A target row absent from `meta` (soft-deleted/missing) is already dropped by
    // findRowsByIds; here we only remove the rule-excluded ones.
    if (inaccessible.size === 0) return
    for (const byRow of relationLinksByProp.values()) {
      for (const [rowId, targets] of byRow) {
        byRow.set(rowId, targets.filter((id) => !inaccessible.has(id)))
      }
    }
    for (const id of inaccessible) targetRowIds.delete(id)
  }

  /**
   * Resolve the computed cells (FORMULA / ROLLUP / RELATION / CREATED_* /
   * LAST_EDITED_*) for a page of already-fetched rows, then map them to the
   * view-model. When the source has NO computed property, this is a pure map (no
   * extra queries). Otherwise it BATCH-fetches — in one query each — the relation
   * links for every RELATION + ROLLUP-relation property, the chip metadata + cell
   * values + titles for the union of linked target rows, and the user names for
   * the rows' created/edited metadata, then calls the pure `resolveComputedCells`.
   * No per-row queries (no N+1).
   */
  private async augmentRows(
    actorUserId: string,
    fullProperties: PropertyRow[],
    rows: RowWithPage[],
  ): Promise<DatabaseRowView[]> {
    const hasComputed = fullProperties.some((p) => COMPUTED_TYPES.has(p.type))
    if (!hasComputed || rows.length === 0) {
      return rows.map((r) => this.mapRow(r, fullProperties))
    }

    const computedMetas: ComputedPropertyMeta[] = fullProperties.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      settings: asSettings(p.settings),
    }))
    const rowIds = rows.map((r) => r.id)

    // The RELATION property ids whose links we need: every RELATION + the
    // relationPropertyId referenced by every ROLLUP.
    const relationPropIds = new Set<string>()
    for (const p of computedMetas) {
      if (p.type === DatabasePropertyType.RELATION) relationPropIds.add(p.id)
      if (p.type === DatabasePropertyType.ROLLUP && p.settings?.rollup) {
        relationPropIds.add(p.settings.rollup.relationPropertyId)
      }
    }

    const relationLinksByProp =
      relationPropIds.size > 0
        ? await this.repo.findRelationLinksForProperties([...relationPropIds], rowIds)
        : new Map<string, Map<string, string[]>>()

    // Union of all linked target row ids (for chips + rollup target cells/titles).
    const targetRowIds = new Set<string>()
    for (const byRow of relationLinksByProp.values()) {
      for (const targets of byRow.values()) {
        for (const t of targets) targetRowIds.add(t)
      }
    }

    // Phase 4C: filter inaccessible target rows out of the link sets so neither
    // RELATION chips nor ROLLUP aggregations leak rows the viewer can't access in
    // the TARGET source. Mutates relationLinksByProp + targetRowIds in place.
    await this.excludeInaccessibleTargets(actorUserId, relationLinksByProp, targetRowIds)

    const needsRollup = computedMetas.some((p) => p.type === DatabasePropertyType.ROLLUP)
    const needsMetadata = computedMetas.some(
      (p) =>
        p.type === DatabasePropertyType.CREATED_TIME ||
        p.type === DatabasePropertyType.CREATED_BY ||
        p.type === DatabasePropertyType.LAST_EDITED_TIME ||
        p.type === DatabasePropertyType.LAST_EDITED_BY,
    )

    const targetIdList = [...targetRowIds]
    const [targetRows, targetCells] = await Promise.all([
      this.repo.findRowsByIds(targetIdList),
      needsRollup ? this.repo.findCellsForRows(targetIdList) : Promise.resolve([]),
    ])

    const chipByRowId = new Map<string, RelationChip>()
    const targetTitleByRow = new Map<string, string | null>()
    for (const r of targetRows) {
      chipByRowId.set(r.id, { rowId: r.id, pageId: r.pageId, title: r.title, icon: r.icon })
      targetTitleByRow.set(r.id, r.title)
    }

    const targetCellsByRow = new Map<string, Map<string, unknown>>()
    for (const c of targetCells) {
      let byProp = targetCellsByRow.get(c.rowId)
      if (!byProp) {
        byProp = new Map<string, unknown>()
        targetCellsByRow.set(c.rowId, byProp)
      }
      byProp.set(
        c.propertyId,
        c.propertyType === DatabasePropertyType.FILE
          ? normalizePersistedFileValue(c.value)
          : c.value,
      )
    }

    // Page/row metadata + the user names it references.
    const pageMetaByRow = new Map<string, PageMeta>()
    const userIds = new Set<string>()
    for (const r of rows) {
      pageMetaByRow.set(r.id, {
        createdAt: r.createdAt,
        createdById: r.createdById,
        updatedAt: r.updatedAt,
        updatedById: r.updatedById,
      })
      if (r.createdById) userIds.add(r.createdById)
      if (r.updatedById) userIds.add(r.updatedById)
    }
    const userNameById =
      needsMetadata && userIds.size > 0
        ? await this.repo.findUserNames([...userIds])
        : new Map<string, string>()

    const propertyTypeById = new Map(fullProperties.map((property) => [property.id, property.type]))
    const rowsWithCells: RowWithCells[] = rows.map((r) => ({
      id: r.id,
      pageId: r.pageId,
      cells: r.cells.map((c) => ({
        propertyId: c.propertyId,
        value:
          propertyTypeById.get(c.propertyId) === DatabasePropertyType.FILE
            ? normalizePersistedFileValue(c.value)
            : c.value,
      })),
    }))

    const computed = resolveComputedCells({
      rows: rowsWithCells,
      properties: computedMetas,
      relationLinksByProp,
      chipByRowId,
      targetCellsByRow,
      targetTitleByRow,
      pageMetaByRow,
      userNameById,
    })

    return rows.map((r) => {
      const cells =
        computed.get(r.id) ?? Object.fromEntries(r.cells.map((c) => [c.propertyId, c.value]))
      return {
        rowId: r.id,
        pageId: r.pageId,
        title: r.page.title,
        icon: r.page.icon,
        position: r.position,
        cells: this.normalizePersistedFileCells(cells, fullProperties),
      }
    })
  }

  async listRows(actorUserId: string, input: ListRowsInput): Promise<ListRowsResult> {
    await this.assertCanRead(actorUserId, input.pageId)
    const source = await this.requireSource(input.pageId)
    const { settings, properties, fullProperties } = await this.resolveViewContext(
      source.id,
      input.viewId,
    )
    const plan = buildRowQuery(settings, properties)

    // ── Row-access (Phase 4C) ────────────────────────────────────────────────
    // Build the viewer context + enabled rules; the resolver is the authority. The
    // DB `buildRowAccessWhere` is a pre-filter optimization, the post-filter via
    // `filterViewableRows` is the authoritative gate. List context has no per-item
    // page share, so pass itemPageId = null (role + creator + rules suffice).
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    const accessCtx = await this.buildRowAccessContext(actorUserId, source, null)
    const accessWhere = buildRowAccessWhere(accessCtx, rules)
    // ANY enabled rule means a (non-broad) viewer's page may shrink under the
    // authoritative post-filter — treat it like a post-filter for pagination.
    const hasAccessFilter = rules.length > 0
    const effectiveWhere =
      accessWhere === null ? plan.where : { AND: [plan.where, accessWhere] }

    const limit = input.limit
    const hasPostFilters =
      plan.multiSelectPostFilters.length > 0 ||
      plan.relationPostFilters.length > 0 ||
      hasAccessFilter

    // Without post-filters: a single over-fetch of limit+1 detects the next page
    // exactly. With post-filters (MULTI_SELECT array containment / RELATION link
    // membership / row-access, all applied in JS after fetch): a whole DB batch can
    // be eliminated, so we must keep fetching deeper batches until we have limit+1
    // surviving rows or the DB is exhausted — otherwise pagination would terminate
    // early and silently drop matching rows. Access-filtered pages may still be
    // short (acceptable, like MULTI_SELECT), but never drop a viewable row.
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
        where: effectiveWhere,
        orderBy: plan.orderBy,
        take: batchTake,
        cursor,
      })
      const afterMulti = this.applyMultiSelectPostFilters(fetched, plan.multiSelectPostFilters)
      const afterRelation = await this.applyRelationPostFilters(afterMulti, plan.relationPostFilters)
      // AUTHORITATIVE row-access gate — drop rows the viewer can't view.
      const survivors = this.filterViewableRows(accessCtx, rules, afterRelation)
      collected.push(...survivors)
      if (fetched.length < batchTake) break // DB exhausted
      if (collected.length > limit) break // enough survivors for this page + probe
      cursor = fetched.at(-1)?.id // advance to the next DB batch
    }

    const hasMore = collected.length > limit
    const pageRows = hasMore ? collected.slice(0, limit) : collected
    // Keyset cursor = the LAST row of THIS page (`findRowsPaged` re-anchors with
    // `cursor: { id }, skip: 1`, so the next page starts at the row after it).
    const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null

    const rows = await this.augmentRows(actorUserId, fullProperties, pageRows)
    return { rows, nextCursor }
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

    // Row-access (Phase 4C): pre-filter in the DB + authoritatively post-filter.
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    const accessCtx = await this.buildRowAccessContext(actorUserId, source, null)
    const accessWhere = buildRowAccessWhere(accessCtx, rules)
    const groupingWhere =
      accessWhere === null ? plan.where : { AND: [plan.where, accessWhere] }
    // Cap the scan: over-fetch by one (MAX_BOARD_ROWS + 1) to detect truncation,
    // then slice to the cap before grouping/augmentRows — mirrors the dashboard
    // widget path (which probes the SAME repo method with MAX_WIDGET_ROWS + 1).
    const fetched = await this.repo.findRowsForGrouping({
      sourceId: source.id,
      where: groupingWhere,
      take: MAX_BOARD_ROWS + 1,
    })
    const truncated = fetched.length > MAX_BOARD_ROWS
    const capped = truncated ? fetched.slice(0, MAX_BOARD_ROWS) : fetched
    const rows = this.filterViewableRows(accessCtx, rules, capped)

    // Resolve computed cells for the whole board in one batched pass, then bucket.
    const augmented = await this.augmentRows(actorUserId, properties, rows)
    const viewByRowId = new Map(augmented.map((v) => [v.rowId, v]))

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
      const view = viewByRowId.get(row.id)
      if (view) buckets.get(key)!.push(view)
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

    return { groups, truncated }
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
    // Phase 4C: per-row content-edit gate (title is content).
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)
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
    // Phase 4C: per-row content-edit gate (deletion requires ≥CAN_EDIT_CONTENT).
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)
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
    // Restore is symmetric to delete — a content edit gated per-row.
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)
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
    // When access rules exist, reordering is a content edit: reject the call if
    // any listed row is one the actor can't edit (don't let a restricted viewer
    // move — or probe the existence of — rows they can't see/edit).
    const rules = this.toResolverRules(await this.repo.findEnabledAccessRules(source.id))
    if (rules.length > 0) {
      const ctx = await this.buildRowAccessContext(actorUserId, source, source.pageId)
      const accessRows = await this.repo.findRowsAccessMetaByIds(input.orderedIds)
      const metaById = new Map(accessRows.map((m) => [m.id, m]))
      for (const id of input.orderedIds) {
        const m = metaById.get(id)
        const row: RowAccessRow = m
          ? { rowCreatedById: m.createdById, cellsByProperty: m.cellsByProperty }
          : { rowCreatedById: null, cellsByProperty: new Map() }
        if (!canEditRow(resolveRowAccess(ctx, rules, row))) {
          throw forbidden('Недостаточно прав для изменения этой строки')
        }
      }
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
    await this.assertCanEditRow(actorUserId, source, input.rowId, row.pageId)
    await this.repo.reorderRows([{ id: input.rowId, position: input.position }])
    return { ok: true as const }
  }

  // Touch assertCanComment so the helper is part of the service surface (used by
  // future comment flows + parity with KanbanService). Kept private + referenced
  // here to avoid an unused-method lint while comments land in a later phase.
  protected readonly _commentGuard = this.assertCanComment.bind(this)
}
