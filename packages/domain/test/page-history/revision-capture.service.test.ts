import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../src/shared/errors.ts'
import type { UnitOfWork } from '../../src/shared/unit-of-work.ts'
import type { PageHistoryRepository } from '../../src/page-history/repositories/page-history.repository.ts'
import {
  HISTORY_MIN_INTERVAL_MS,
  RevisionCaptureService,
} from '../../src/page-history/services/revision-capture.service.ts'

const MOCK_CLIENT = Symbol('mock-tx-client')

function makeUow(): UnitOfWork {
  return {
    client: () => MOCK_CLIENT as never,
    transaction: async (fn) => fn(),
  }
}

function makeRepo(
  overrides: Partial<Record<keyof PageHistoryRepository, ReturnType<typeof vi.fn>>> = {},
): PageHistoryRepository {
  return {
    findLatestRevision: vi.fn(async () => null),
    createRevision: vi.fn(async () => ({ id: 'rev-new' })),
    listRevisions: vi.fn(async () => []),
    findRevision: vi.fn(async () => null),
    findActivePage: vi.fn(async () => ({ id: 'p1' })),
    writePageContent: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as PageHistoryRepository
}

function makeService(repo: PageHistoryRepository) {
  return new RevisionCaptureService(repo, makeUow())
}

describe('RevisionCaptureService.captureContentRevision', () => {
  it('writes an EDIT revision when there is no prior revision', async () => {
    const repo = makeRepo({ findLatestRevision: vi.fn(async () => null) })
    const svc = makeService(repo)
    await svc.captureContentRevision({
      pageId: 'p1',
      actorId: 'u1',
      content: { type: 'doc' },
      contentYjs: null,
      metadata: { title: 'A' },
    })
    expect(repo.createRevision).toHaveBeenCalledTimes(1)
    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'EDIT' }),
    )
  })

  it('SKIPS (no write) when the latest revision is younger than the interval AND same actor', async () => {
    const repo = makeRepo({
      findLatestRevision: vi.fn(async () => ({
        actorId: 'u1',
        createdAt: new Date(Date.now() - 60_000), // 1 min ago
      })),
    })
    const svc = makeService(repo)
    await svc.captureContentRevision({
      pageId: 'p1',
      actorId: 'u1',
      content: { type: 'doc' },
      contentYjs: null,
      metadata: null,
    })
    expect(repo.createRevision).not.toHaveBeenCalled()
  })

  it('WRITES when the latest revision is within the interval but a DIFFERENT actor', async () => {
    const repo = makeRepo({
      findLatestRevision: vi.fn(async () => ({
        actorId: 'u2',
        createdAt: new Date(Date.now() - 60_000),
      })),
    })
    const svc = makeService(repo)
    await svc.captureContentRevision({
      pageId: 'p1',
      actorId: 'u1',
      content: { type: 'doc' },
      contentYjs: null,
      metadata: null,
    })
    expect(repo.createRevision).toHaveBeenCalledTimes(1)
  })

  it('WRITES when the latest revision is the same actor but OLDER than the interval', async () => {
    const repo = makeRepo({
      findLatestRevision: vi.fn(async () => ({
        actorId: 'u1',
        createdAt: new Date(Date.now() - (HISTORY_MIN_INTERVAL_MS + 60_000)),
      })),
    })
    const svc = makeService(repo)
    await svc.captureContentRevision({
      pageId: 'p1',
      actorId: 'u1',
      content: { type: 'doc' },
      contentYjs: null,
      metadata: null,
    })
    expect(repo.createRevision).toHaveBeenCalledTimes(1)
  })
})

describe('RevisionCaptureService.captureStructuralRevision', () => {
  it('always writes, even within the throttle interval and same actor', async () => {
    const repo = makeRepo({
      findLatestRevision: vi.fn(async () => ({
        actorId: 'u1',
        createdAt: new Date(Date.now() - 1_000), // 1s ago
      })),
    })
    const svc = makeService(repo)
    await svc.captureStructuralRevision({
      pageId: 'p1',
      actorId: 'u1',
      action: 'TITLE_CHANGE',
      metadata: { title: 'New title' },
    })
    expect(repo.findLatestRevision).not.toHaveBeenCalled()
    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'TITLE_CHANGE' }),
    )
  })

  it('records MOVE / ARCHIVE / RESTORE actions', async () => {
    for (const action of ['MOVE', 'ARCHIVE', 'RESTORE'] as const) {
      const repo = makeRepo()
      const svc = makeService(repo)
      await svc.captureStructuralRevision({ pageId: 'p1', actorId: 'u1', action, metadata: null })
      expect(repo.createRevision).toHaveBeenCalledWith(expect.objectContaining({ action }))
    }
  })
})

describe('RevisionCaptureService.listRevisions / getRevisionPreview', () => {
  it('listRevisions returns the metadata-only rows from the repo', async () => {
    const rows = [
      { id: 'r1', actorId: 'u1', action: 'EDIT' as const, metadata: null, createdAt: new Date() },
    ]
    const repo = makeRepo({ listRevisions: vi.fn(async () => rows) })
    const svc = makeService(repo)
    await expect(svc.listRevisions('p1')).resolves.toEqual(rows)
    expect(repo.listRevisions).toHaveBeenCalledWith('p1')
  })

  it('getRevisionPreview returns the full revision incl. content', async () => {
    const rev = {
      id: 'r1',
      pageId: 'p1',
      actorId: 'u1',
      action: 'EDIT' as const,
      content: { type: 'doc' },
      contentYjs: null,
      metadata: null,
      createdAt: new Date(),
    }
    const repo = makeRepo({ findRevision: vi.fn(async () => rev) })
    const svc = makeService(repo)
    await expect(svc.getRevisionPreview('p1', 'r1')).resolves.toEqual(rev)
  })

  it('getRevisionPreview throws notFound when the revision is missing / not on this page', async () => {
    const repo = makeRepo({ findRevision: vi.fn(async () => null) })
    const svc = makeService(repo)
    await expect(svc.getRevisionPreview('p1', 'missing')).rejects.toSatisfy(isDomainError)
  })
})

describe('RevisionCaptureService.restoreRevision', () => {
  it('writes the revision content back to the page AND records a RESTORE revision', async () => {
    const rev = {
      id: 'r1',
      pageId: 'p1',
      actorId: 'u9',
      action: 'EDIT' as const,
      content: { type: 'doc', restored: true },
      contentYjs: Buffer.from([1, 2, 3]),
      metadata: { title: 'Old title' },
      createdAt: new Date(),
    }
    const repo = makeRepo({
      findRevision: vi.fn(async () => rev),
      findActivePage: vi.fn(async () => ({ id: 'p1' })),
    })
    const svc = makeService(repo)
    const result = await svc.restoreRevision({ pageId: 'p1', revisionId: 'r1', actorId: 'u1' })

    expect(repo.writePageContent).toHaveBeenCalledWith('p1', {
      content: rev.content,
      contentYjs: rev.contentYjs,
    })
    expect(repo.createRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'RESTORE' }),
    )
    expect(result).toEqual({ id: 'p1' })
  })

  it('throws notFound when the page is deleted (no active page)', async () => {
    const repo = makeRepo({
      findRevision: vi.fn(async () => ({
        id: 'r1',
        pageId: 'p1',
        actorId: 'u1',
        action: 'EDIT' as const,
        content: { type: 'doc' },
        contentYjs: null,
        metadata: null,
        createdAt: new Date(),
      })),
      findActivePage: vi.fn(async () => null),
    })
    const svc = makeService(repo)
    await expect(
      svc.restoreRevision({ pageId: 'p1', revisionId: 'r1', actorId: 'u1' }),
    ).rejects.toSatisfy(isDomainError)
    expect(repo.writePageContent).not.toHaveBeenCalled()
  })

  it('throws notFound when the revision does not belong to the page', async () => {
    const repo = makeRepo({ findRevision: vi.fn(async () => null) })
    const svc = makeService(repo)
    await expect(
      svc.restoreRevision({ pageId: 'p1', revisionId: 'nope', actorId: 'u1' }),
    ).rejects.toSatisfy(isDomainError)
  })
})
