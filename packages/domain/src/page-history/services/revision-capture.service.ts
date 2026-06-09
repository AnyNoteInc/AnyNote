import { notFound } from '../../shared/errors.ts'
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
// Enum value re-exported through the dto barrel so the service never imports
// `@repo/db` as a value (the domain-services-no-db-value rule).
import { PageRevisionAction } from '../dto/page-history.dto.ts'
import type {
  CaptureContentRevisionInput,
  CaptureStructuralRevisionInput,
  RestoreRevisionServiceInput,
  RevisionDetailDto,
  RevisionSummaryDto,
} from '../dto/page-history.dto.ts'
import type { PageHistoryRepository } from '../repositories/page-history.repository.ts'

/**
 * Minimum interval between captured *content* revisions for the same page + actor.
 * Gives the Notion-style "≈every 10 min during active editing + one after it
 * settles" cadence. Structural revisions ignore this throttle.
 */
export const HISTORY_MIN_INTERVAL_MS = 10 * 60 * 1000

export class RevisionCaptureService {
  private readonly repo: PageHistoryRepository
  private readonly uow: UnitOfWork
  constructor(repo: PageHistoryRepository, uow: UnitOfWork) {
    this.repo = repo
    this.uow = uow
  }

  /**
   * Capture a content snapshot (action EDIT) for a page, throttled: skip the
   * write when the latest revision is younger than HISTORY_MIN_INTERVAL_MS AND
   * authored by the same actor. A different actor or an older revision writes.
   */
  async captureContentRevision(input: CaptureContentRevisionInput): Promise<void> {
    await this.uow.transaction(async () => {
      const latest = await this.repo.findLatestRevision(input.pageId)
      if (latest) {
        const ageMs = Date.now() - latest.createdAt.getTime()
        const sameActor = latest.actorId === input.actorId
        if (sameActor && ageMs < HISTORY_MIN_INTERVAL_MS) return
      }
      await this.repo.createRevision({
        pageId: input.pageId,
        actorId: input.actorId,
        action: PageRevisionAction.EDIT,
        content: input.content,
        contentYjs: input.contentYjs,
        metadata: input.metadata,
      })
    })
  }

  /** Always capture a structural revision (TITLE_CHANGE / MOVE / ARCHIVE / RESTORE / PUBLISH). */
  async captureStructuralRevision(input: CaptureStructuralRevisionInput): Promise<void> {
    await this.uow.transaction(async () => {
      await this.repo.createRevision({
        pageId: input.pageId,
        actorId: input.actorId,
        action: input.action,
        metadata: input.metadata,
      })
    })
  }

  /** Metadata-only revision list (no heavy content/contentYjs blobs). */
  async listRevisions(pageId: string): Promise<RevisionSummaryDto[]> {
    return this.repo.listRevisions(pageId)
  }

  /** A single revision including its content snapshot — for readonly preview. */
  async getRevisionPreview(pageId: string, revisionId: string): Promise<RevisionDetailDto> {
    const rev = await this.repo.findRevision(pageId, revisionId)
    if (!rev) throw notFound('Версия страницы не найдена')
    return rev
  }

  /**
   * Restore a revision: write its content/contentYjs back onto the live page and
   * record a new RESTORE revision (history is never erased). Throws if the page
   * is deleted (restore conflict) or the revision does not belong to the page.
   */
  async restoreRevision(input: RestoreRevisionServiceInput): Promise<{ id: string }> {
    return this.uow.transaction(async () => {
      const rev = await this.repo.findRevision(input.pageId, input.revisionId)
      if (!rev) throw notFound('Версия страницы не найдена')

      const page = await this.repo.findActivePage(input.pageId)
      if (!page) throw notFound('Страница не найдена')

      await this.repo.writePageContent(input.pageId, {
        content: rev.content,
        contentYjs: rev.contentYjs,
      })

      await this.repo.createRevision({
        pageId: input.pageId,
        actorId: input.actorId,
        action: PageRevisionAction.RESTORE,
        metadata: rev.metadata ?? undefined,
      })

      return { id: page.id }
    })
  }
}
