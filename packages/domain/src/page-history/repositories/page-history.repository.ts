import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type {
  CreateRevisionInput,
  LatestRevisionDto,
  RevisionDetailDto,
  RevisionSummaryDto,
} from '../dto/page-history.dto.ts'

export class PageHistoryRepository {
  private readonly uow: UnitOfWork
  constructor(uow: UnitOfWork) {
    this.uow = uow
  }

  /** The most recent revision's actor + timestamp — drives the capture throttle. */
  async findLatestRevision(pageId: string): Promise<LatestRevisionDto | null> {
    return this.uow.client().pageRevision.findFirst({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true, createdAt: true },
    })
  }

  async createRevision(input: CreateRevisionInput): Promise<{ id: string }> {
    return this.uow.client().pageRevision.create({
      data: {
        pageId: input.pageId,
        actorId: input.actorId,
        action: input.action,
        // Only set the JSON columns when provided — absent ⇒ DB NULL (the columns are nullable).
        ...(input.content === undefined || input.content === null
          ? {}
          : { content: input.content }),
        ...(input.contentYjs === undefined || input.contentYjs === null
          ? {}
          : { contentYjs: input.contentYjs }),
        ...(input.metadata === undefined || input.metadata === null
          ? {}
          : { metadata: input.metadata }),
      },
      select: { id: true },
    })
  }

  /** Lightweight list — never selects the heavy content/contentYjs blobs. */
  async listRevisions(pageId: string): Promise<RevisionSummaryDto[]> {
    return this.uow.client().pageRevision.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorId: true, action: true, metadata: true, createdAt: true },
    })
  }

  /** Full revision (content included), scoped to the page so a foreign id never leaks. */
  async findRevision(pageId: string, revisionId: string): Promise<RevisionDetailDto | null> {
    const row = await this.uow.client().pageRevision.findFirst({
      where: { id: revisionId, pageId },
      select: {
        id: true,
        pageId: true,
        actorId: true,
        action: true,
        content: true,
        contentYjs: true,
        metadata: true,
        createdAt: true,
      },
    })
    if (!row) return null
    return { ...row, contentYjs: row.contentYjs as Uint8Array<ArrayBuffer> | null }
  }

  /** The page if it is not soft-deleted — restore conflicts otherwise. */
  async findActivePage(pageId: string): Promise<{ id: string } | null> {
    return this.uow.client().page.findFirst({
      where: { id: pageId, deletedAt: null },
      select: { id: true },
    })
  }

  /** Write a revision's snapshot back onto the live page. */
  async writePageContent(
    pageId: string,
    snapshot: { content: unknown; contentYjs: Uint8Array<ArrayBuffer> | null },
  ): Promise<void> {
    await this.uow.client().page.update({
      where: { id: pageId },
      data: {
        content: (snapshot.content ?? null) as never,
        contentYjs: snapshot.contentYjs,
      },
    })
  }
}
