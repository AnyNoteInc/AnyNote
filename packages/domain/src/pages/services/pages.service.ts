import { badRequest, forbidden, notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { RevisionRecorder } from '../../shared/revision-recorder.ts'
import { PageRevisionAction, COVER_PRESET_KEYS } from '../dto/pages.dto.ts'
import type { KanbanService } from '../../kanban/index.ts'
import type { DatabaseService } from '../../database/index.ts'
import type {
  ArchivePageInput,
  CountResultDto,
  CreatePageExtra,
  CreatePageInput,
  CreateResultDto,
  DuplicatePageInput,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  MoveToCollectionInput,
  PageRowDto,
  RenamePageInput,
  RenameResultDto,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UnarchivePageInput,
  UpdatePageInput,
} from '../dto/pages.dto.ts'
import type { PageRepository } from '../repositories/pages.repository.ts'

// ── Page appearance validation (Phase 9A, spec §3) ────────────────────────────

const ICON_URL_PREFIX = 'url:'
const ICON_PLAIN_MAX_CODEPOINTS = 32
const APPEARANCE_URL_MAX = 1024
// Same-origin uploaded-file path: exactly /api/files/<uuid> (public-by-id).
const FILE_URL_RE = /^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A same-origin `/api/files/<uuid>` path or an https URL, length-capped. */
function isAppearanceUrl(value: string): boolean {
  if (value.length > APPEARANCE_URL_MAX) return false
  return FILE_URL_RE.test(value) || /^https:\/\/\S+$/.test(value)
}

function assertValidIcon(icon: string | null | undefined): void {
  if (icon === null || icon === undefined) return
  if (icon.startsWith(ICON_URL_PREFIX)) {
    if (!isAppearanceUrl(icon.slice(ICON_URL_PREFIX.length))) {
      throw badRequest(
        'Иконка-изображение должна быть ссылкой вида /api/files/<id> или https-ссылкой не длиннее 1024 символов',
      )
    }
    return
  }
  // Plain value = emoji (back-compatible). Code points, not UTF-16 units, so
  // multi-unit emoji are counted honestly.
  if ([...icon].length > ICON_PLAIN_MAX_CODEPOINTS) {
    throw badRequest('Иконка должна быть эмодзи или строкой не длиннее 32 символов')
  }
}

function assertValidCoverUrl(coverUrl: string | null | undefined): void {
  if (coverUrl === null || coverUrl === undefined) return
  if (!isAppearanceUrl(coverUrl)) {
    throw badRequest(
      'Обложка должна быть ссылкой вида /api/files/<id> или https-ссылкой не длиннее 1024 символов',
    )
  }
}

function assertValidCoverPreset(coverPreset: string | null | undefined): void {
  if (coverPreset === null || coverPreset === undefined) return
  if (!(COVER_PRESET_KEYS as readonly string[]).includes(coverPreset)) {
    throw badRequest('Неизвестный градиент обложки')
  }
}

/**
 * Validates icon/cover formats and enforces coverUrl↔coverPreset mutual
 * exclusion: setting one clears the other; explicit nulls clear. Both set in
 * one call is a contradiction → honest BAD_REQUEST.
 */
function withValidatedAppearance(input: UpdatePageInput): UpdatePageInput {
  assertValidIcon(input.icon)
  assertValidCoverUrl(input.coverUrl)
  assertValidCoverPreset(input.coverPreset)
  if (typeof input.coverUrl === 'string' && typeof input.coverPreset === 'string') {
    throw badRequest('Нельзя одновременно задать обложку-изображение и градиент')
  }
  const normalized = { ...input }
  if (typeof input.coverUrl === 'string') normalized.coverPreset = null
  if (typeof input.coverPreset === 'string') normalized.coverUrl = null
  return normalized
}

export class PageService {
  private readonly repo: PageRepository
  private readonly uow: UnitOfWork
  private readonly kanban: KanbanService
  private readonly database: DatabaseService
  private readonly history: RevisionRecorder
  constructor(
    repo: PageRepository,
    uow: UnitOfWork,
    kanban: KanbanService,
    database: DatabaseService,
    history: RevisionRecorder,
  ) {
    this.repo = repo
    this.uow = uow
    this.kanban = kanban
    this.database = database
    this.history = history
  }

  // ── Access helpers ────────────────────────────────────────────────────────────

  private async assertAccess(userId: string, pageId: string): Promise<PageRowDto> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    return page
  }

  private async assertOwnership(userId: string, pageId: string): Promise<PageRowDto> {
    const page = await this.repo.findAccessiblePage(userId, pageId)
    if (!page) throw notFound('Страница не найдена')
    if (page.createdById === userId) return page
    const m = await this.repo.findMembership(userId, page.workspaceId)
    if (m?.role !== 'OWNER') throw forbidden('Недостаточно прав')
    return page
  }

  // ── Service methods ───────────────────────────────────────────────────────────

  async create(
    actorUserId: string,
    input: CreatePageInput & CreatePageExtra,
  ): Promise<CreateResultDto> {
    // Pre-tx: if parent is a page, verify it exists and belongs to the same workspace
    if (input.parentId) {
      const parentPage = await this.repo.findParentPage(input.parentId, input.workspaceId)
      if (!parentPage) {
        throw notFound('Родительская страница не найдена')
      }
    }

    const resolvedCollectionId = await this.resolveCollectionId(actorUserId, input)

    return this.uow.transaction(() =>
      this.repo.createPageTx(
        actorUserId,
        { ...input, resolvedCollectionId },
        {
          onKanban: (pageId) => this.kanban.seedDefaults(pageId),
          onDatabase: (pageId, wsId) => this.database.seedDefaults(pageId, wsId),
        },
      ),
    )
  }

  /**
   * Resolve which collection a new page belongs to:
   * 1. an explicit collectionId always wins;
   * 2. otherwise inherit the parent page's collection;
   * 3. otherwise honour an explicit location ('team');
   * 4. default (and location 'private'): the actor's personal collection,
   *    falling back to the workspace team collection.
   */
  private async resolveCollectionId(
    actorUserId: string,
    input: CreatePageInput & CreatePageExtra,
  ): Promise<string | null> {
    if (input.collectionId !== undefined && input.collectionId !== null) return input.collectionId
    if (input.parentId) {
      const parentCol = await this.repo.getPageCollectionId(input.parentId)
      if (parentCol) return parentCol
    }
    if (input.location === 'team') {
      return this.repo.findTeamCollectionId(input.workspaceId)
    }
    // default + location 'private': actor's personal collection, fall back to team
    const personal = await this.repo.findPersonalCollectionId(input.workspaceId, actorUserId)
    if (personal) return personal
    return this.repo.findTeamCollectionId(input.workspaceId)
  }

  async moveToCollection(
    actorUserId: string,
    input: MoveToCollectionInput,
  ): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.pageId)
    const target =
      input.target === 'team'
        ? await this.repo.findTeamCollectionId(input.workspaceId)
        : await this.repo.findPersonalCollectionId(input.workspaceId, actorUserId)
    const hasPosition = input.newParentId !== undefined || input.newPrevPageId !== undefined
    if (hasPosition) {
      // Self-reference guard (mirror reorder): a page can't sit after itself.
      if (input.newPrevPageId === input.pageId) {
        throw badRequest('Страница не может ссылаться на себя')
      }
      // Cycle guard (mirror reorder, before the tx): the target parent must not
      // be a descendant of the moved page, or the page vanishes from the tree.
      if (input.newParentId != null) {
        await this.repo.assertNotReorderingIntoOwnDescendant(input.pageId, input.newParentId)
      }
    }
    return this.uow.transaction(() =>
      this.repo.moveToCollectionTx(
        actorUserId,
        input.pageId,
        target,
        input.workspaceId,
        hasPosition
          ? { newParentId: input.newParentId ?? null, newPrevPageId: input.newPrevPageId ?? null }
          : undefined,
      ),
    )
  }

  async archive(actorUserId: string, input: ArchivePageInput): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(async () => {
      const result = await this.repo.archivePageTx(actorUserId, input.id, input.workspaceId)
      await this.history.captureStructuralRevision({
        pageId: input.id,
        actorId: actorUserId,
        action: PageRevisionAction.ARCHIVE,
        metadata: null,
      })
      return result
    })
  }

  async unarchive(actorUserId: string, input: UnarchivePageInput): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(async () => {
      const result = await this.repo.unarchivePageTx(actorUserId, input.id, input.workspaceId)
      await this.history.captureStructuralRevision({
        pageId: input.id,
        actorId: actorUserId,
        action: PageRevisionAction.RESTORE,
        metadata: null,
      })
      return result
    })
  }

  async rename(actorUserId: string, input: RenamePageInput): Promise<RenameResultDto> {
    assertValidIcon(input.icon)
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(async () => {
      const result = await this.repo.renamePageTx(actorUserId, input)
      await this.history.captureStructuralRevision({
        pageId: input.id,
        actorId: actorUserId,
        action: PageRevisionAction.TITLE_CHANGE,
        metadata: { title: input.title },
      })
      return result
    })
  }

  async update(actorUserId: string, input: UpdatePageInput): Promise<RenameResultDto> {
    const normalized = withValidatedAppearance(input)
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.updatePageTx(actorUserId, normalized))
  }

  async duplicate(actorUserId: string, input: DuplicatePageInput): Promise<CreateResultDto> {
    const page = await this.assertAccess(actorUserId, input.pageId)
    return this.uow.transaction(() => this.repo.duplicatePageTx(actorUserId, page))
  }

  async move(actorUserId: string, input: MovePageInput): Promise<CreateResultDto> {
    const page = await this.assertAccess(actorUserId, input.pageId)
    // Ownership: must be creator or workspace OWNER
    await this.assertOwnership(actorUserId, input.pageId)
    return this.uow.transaction(async () => {
      const result = await this.repo.movePageTx(actorUserId, page, input)
      await this.history.captureStructuralRevision({
        pageId: input.pageId,
        actorId: actorUserId,
        action: PageRevisionAction.MOVE,
        metadata: { parentId: input.newParentId },
      })
      return result
    })
  }

  async reorder(actorUserId: string, input: ReorderPageInput): Promise<CreateResultDto> {
    // Top-level self-reference check (matches original: before any I/O)
    if (input.newPrevPageId === input.pageId) {
      throw badRequest('Страница не может ссылаться на себя')
    }

    // reorderPage's original looks up by id only (not workspace-filtered).
    const pageRow = await this.repo.findActivePageById(input.pageId)
    if (!pageRow) throw notFound('Страница не найдена')

    const member = await this.repo.findMembership(actorUserId, pageRow.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')

    // Short-circuit: no-op when position is unchanged
    if (pageRow.parentId === input.newParentId && pageRow.prevPageId === input.newPrevPageId) {
      return { id: input.pageId }
    }

    // Cycle check (before opening the tx): newParentId must not be a descendant of pageId
    await this.repo.assertNotReorderingIntoOwnDescendant(input.pageId, input.newParentId)

    return this.uow.transaction(() => this.repo.reorderPageTx(actorUserId, pageRow, input))
  }

  async softDelete(actorUserId: string, input: SoftDeletePageInput): Promise<CreateResultDto> {
    const page = await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.softDeletePageTx(actorUserId, page, input))
  }

  async restore(actorUserId: string, input: RestorePageInput): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(async () => {
      const result = await this.repo.restorePageTx(actorUserId, input)
      await this.history.captureStructuralRevision({
        pageId: input.id,
        actorId: actorUserId,
        action: PageRevisionAction.RESTORE,
        metadata: null,
      })
      return result
    })
  }

  async hardDelete(actorUserId: string, input: HardDeletePageInput): Promise<CreateResultDto> {
    await this.assertOwnership(actorUserId, input.id)
    return this.uow.transaction(() => this.repo.hardDeletePageTx(input))
  }

  async emptyTrash(actorUserId: string, input: EmptyTrashInput): Promise<CountResultDto> {
    const member = await this.repo.findMembership(actorUserId, input.workspaceId)
    if (!member) throw forbidden('Вы не являетесь участником воркспейса')
    if (member.role !== 'OWNER') {
      throw forbidden('Только владелец может очистить корзину')
    }
    return this.uow.transaction(() => this.repo.emptyTrashTx(input))
  }
}
