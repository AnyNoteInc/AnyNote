import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PageType } from '@repo/db'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import type {
  ShareCopyRepository,
  SourcePageRow,
} from '../../../src/share-copy/repositories/share-copy.repository.ts'
import { PublicShareCopyService } from '../../../src/share-copy/services/share-copy.service.ts'

function makeUow(): UnitOfWork {
  return {
    client: () => {
      throw new Error('client() should not be called from service')
    },
    // The service opens a transaction; we just run the body inline.
    transaction: async (fn) => fn(),
  }
}

const ROOT: SourcePageRow = {
  id: 'p-root',
  parentId: null,
  title: 'Root',
  icon: '📄',
  type: PageType.TEXT,
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  contentYjs: new Uint8Array(new ArrayBuffer(8)),
}

const CHILD: SourcePageRow = {
  id: 'p-child',
  parentId: 'p-root',
  title: 'Child',
  icon: null,
  type: PageType.TEXT,
  content: { type: 'doc', content: [] },
  contentYjs: new Uint8Array(new ArrayBuffer(4)),
}

// A grandchild only reachable through CHILD — used to confirm multi-level BFS
// re-parents under the copied child, not the copied root.
const GRANDCHILD: SourcePageRow = {
  id: 'p-grandchild',
  parentId: 'p-child',
  title: 'Grandchild',
  icon: null,
  type: PageType.TEXT,
  content: null,
  contentYjs: null,
}

type RepoMock = {
  findSourcePage: ReturnType<typeof vi.fn>
  findCopyableChildren: ReturnType<typeof vi.fn>
  createCopiedPage: ReturnType<typeof vi.fn>
}

function makeRepo(overrides: Partial<RepoMock> = {}): {
  repo: ShareCopyRepository
  mock: RepoMock
} {
  // createCopiedPage returns a deterministic "copy-of-<id>" so we can assert
  // re-parenting via the id map.
  const mock: RepoMock = {
    findSourcePage: vi.fn(async () => ({ ...ROOT })),
    findCopyableChildren: vi.fn(async () => []),
    createCopiedPage: vi.fn(async (_actor: string, input: { copiedFromPageId: string }) => ({
      id: `copy-of-${input.copiedFromPageId}`,
    })),
    ...overrides,
  }
  return { repo: mock as unknown as ShareCopyRepository, mock }
}

function makeSvc(repo: ShareCopyRepository): PublicShareCopyService {
  return new PublicShareCopyService(repo, makeUow())
}

const baseInput = {
  rootPageId: 'p-root',
  targetWorkspaceId: 'ws-target',
  targetCollectionId: 'col-personal',
  actorUserId: 'u-actor',
  includeSubtree: true,
  fromShareId: 'share-123',
}

describe('PublicShareCopyService.copyTree', () => {
  let repo: ShareCopyRepository
  let mock: RepoMock

  beforeEach(() => {
    ;({ repo, mock } = makeRepo())
  })

  it('copies the root and one visible child when includeSubtree', async () => {
    mock.findCopyableChildren
      .mockImplementationOnce(async () => [{ ...CHILD }]) // children of root
      .mockImplementationOnce(async () => []) // children of child

    const res = await makeSvc(repo).copyTree(baseInput)

    expect(res).toEqual({ rootPageId: 'copy-of-p-root' })
    expect(mock.createCopiedPage).toHaveBeenCalledTimes(2)

    // Root copy: top-level (parentId null) in the target ws/collection.
    expect(mock.createCopiedPage).toHaveBeenNthCalledWith(
      1,
      'u-actor',
      expect.objectContaining({
        workspaceId: 'ws-target',
        collectionId: 'col-personal',
        parentId: null,
        copiedFromPageId: 'p-root',
      }),
    )
    // Child copy: re-parented under the copied root, not the original.
    expect(mock.createCopiedPage).toHaveBeenNthCalledWith(
      2,
      'u-actor',
      expect.objectContaining({ parentId: 'copy-of-p-root', copiedFromPageId: 'p-child' }),
    )
  })

  it('copies content + contentYjs + icon + type + title verbatim', async () => {
    await makeSvc(repo).copyTree({ ...baseInput, includeSubtree: false })

    expect(mock.createCopiedPage).toHaveBeenCalledWith(
      'u-actor',
      expect.objectContaining({
        title: 'Root',
        icon: '📄',
        type: PageType.TEXT,
        content: ROOT.content,
        contentYjs: ROOT.contentYjs,
      }),
    )
  })

  it('sets copy provenance (share id, source page id, timestamp) on every copy', async () => {
    mock.findCopyableChildren
      .mockImplementationOnce(async () => [{ ...CHILD }])
      .mockImplementationOnce(async () => [])

    await makeSvc(repo).copyTree(baseInput)

    for (const call of mock.createCopiedPage.mock.calls) {
      const payload = call[1] as {
        copiedFromShareId: string | null
        copiedFromPageId: string
        copiedAt: Date
      }
      expect(payload.copiedFromShareId).toBe('share-123')
      expect(payload.copiedFromPageId).toMatch(/^p-/)
      expect(payload.copiedAt).toBeInstanceOf(Date)
    }
  })

  it('does NOT copy comments, share grants, or files (only renderable fields are passed)', async () => {
    await makeSvc(repo).copyTree({ ...baseInput, includeSubtree: false })

    // The service hands the repo only renderable + provenance fields — never
    // comments/grants/files. Assert no such keys leak into the payload.
    const payload = mock.createCopiedPage.mock.calls[0]![1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('comments')
    expect(payload).not.toHaveProperty('commentThreads')
    expect(payload).not.toHaveProperty('users')
    expect(payload).not.toHaveProperty('share')
    expect(payload).not.toHaveProperty('files')
    expect(Object.keys(payload).sort()).toEqual(
      [
        'collectionId',
        'content',
        'contentYjs',
        'copiedAt',
        'copiedFromPageId',
        'copiedFromShareId',
        'icon',
        'parentId',
        'title',
        'type',
        'workspaceId',
      ].sort(),
    )
  })

  it('skips children dropped by the repo (archived/deleted/other-PERSONAL filtered out)', async () => {
    // The repo's findCopyableChildren is the filter; the service copies exactly
    // what it returns. Returning only the visible child models the DB excluding
    // archived/deleted/other-user-PERSONAL siblings.
    mock.findCopyableChildren
      .mockImplementationOnce(async () => [{ ...CHILD }]) // one visible child; siblings filtered
      .mockImplementationOnce(async () => [])

    await makeSvc(repo).copyTree(baseInput)

    // Filtering is per-actor: the actor id must be threaded into the query.
    expect(mock.findCopyableChildren).toHaveBeenCalledWith(['p-root'], 'u-actor')
    // Exactly root + the single visible child were copied.
    const copiedSources = mock.createCopiedPage.mock.calls.map(
      (c) => (c[1] as { copiedFromPageId: string }).copiedFromPageId,
    )
    expect(copiedSources).toEqual(['p-root', 'p-child'])
  })

  it('re-parents a grandchild under its copied parent across BFS levels', async () => {
    mock.findCopyableChildren
      .mockImplementationOnce(async () => [{ ...CHILD }]) // level 1: children of root
      .mockImplementationOnce(async () => [{ ...GRANDCHILD }]) // level 2: children of child
      .mockImplementationOnce(async () => []) // level 3: none

    await makeSvc(repo).copyTree(baseInput)

    expect(mock.createCopiedPage).toHaveBeenCalledTimes(3)
    expect(mock.createCopiedPage).toHaveBeenNthCalledWith(
      3,
      'u-actor',
      expect.objectContaining({ parentId: 'copy-of-p-child', copiedFromPageId: 'p-grandchild' }),
    )
  })

  it('copies only the single page when includeSubtree is false', async () => {
    const res = await makeSvc(repo).copyTree({ ...baseInput, includeSubtree: false })

    expect(res).toEqual({ rootPageId: 'copy-of-p-root' })
    expect(mock.createCopiedPage).toHaveBeenCalledTimes(1)
    expect(mock.findCopyableChildren).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when the root page is unavailable (archived/deleted/missing)', async () => {
    ;({ repo, mock } = makeRepo({ findSourcePage: vi.fn(async () => null) }))
    await expect(makeSvc(repo).copyTree(baseInput)).rejects.toMatchObject({ httpStatus: 404 })
    expect(mock.createCopiedPage).not.toHaveBeenCalled()
  })
})
