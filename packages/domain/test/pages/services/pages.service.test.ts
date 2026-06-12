import { describe, it, expect, vi, beforeEach } from 'vitest'

import { DomainError } from '../../../src/shared/errors.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import type { PageRepository } from '../../../src/pages/repositories/pages.repository.ts'
import { PageService } from '../../../src/pages/services/pages.service.ts'
import type { KanbanService } from '../../../src/kanban/index.ts'
import type { DatabaseService } from '../../../src/database/services/database.service.ts'
import type { PageRowDto } from '../../../src/pages/dto/pages.dto.ts'
import type { RevisionRecorder } from '../../../src/shared/revision-recorder.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const basePageRow: PageRowDto = {
  id: 'p1',
  workspaceId: 'w1',
  createdById: 'u1',
  parentId: null,
  collectionId: null,
  prevPageId: null,
  title: 'Hello',
  icon: null,
  type: 'TEXT',
  content: null,
  contentYjs: null,
  archivedAt: null,
  deletedAt: null,
}

function makeRepo(
  overrides: Partial<Record<keyof PageRepository, ReturnType<typeof vi.fn>>> = {},
): PageRepository {
  return {
    findAccessiblePage: vi.fn(async () => basePageRow),
    findActivePageById: vi.fn(async () => basePageRow),
    findMembership: vi.fn(async () => ({ role: 'OWNER' as const })),
    findParentPage: vi.fn(async () => ({ id: 'par1' })),
    createPageTx: vi.fn(async () => ({ id: 'new-1' })),
    renamePageTx: vi.fn(async () => ({ id: 'p1', title: 'New', icon: null, updatedAt: new Date() })),
    updatePageTx: vi.fn(async () => ({ id: 'p1', title: null, icon: null, updatedAt: new Date() })),
    duplicatePageTx: vi.fn(async () => ({ id: 'copy-1' })),
    archivePageTx: vi.fn(async () => ({ id: 'p1' })),
    unarchivePageTx: vi.fn(async () => ({ id: 'p1' })),
    movePageTx: vi.fn(async () => ({ id: 'p1' })),
    reorderPageTx: vi.fn(async () => ({ id: 'p1' })),
    softDeletePageTx: vi.fn(async () => ({ id: 'p1' })),
    restorePageTx: vi.fn(async () => ({ id: 'p1' })),
    hardDeletePageTx: vi.fn(async () => ({ id: 'p1' })),
    emptyTrashTx: vi.fn(async () => ({ count: 3 })),
    assertNotReorderingIntoOwnDescendant: vi.fn(async () => undefined),
    findTeamCollectionId: vi.fn(async () => 'team-col-1'),
    findPersonalCollectionId: vi.fn(async () => 'personal-col-1'),
    getPageCollectionId: vi.fn(async () => null),
    ...overrides,
  } as unknown as PageRepository
}

function makeUow(findFirstResult: unknown = null): UnitOfWork {
  return {
    client: () =>
      ({
        page: { findFirst: vi.fn(async () => findFirstResult) },
      }) as never,
    transaction: async (fn) => fn(),
  }
}

function makeKanban(): KanbanService {
  return { seedDefaults: vi.fn(async () => undefined) } as unknown as KanbanService
}

function makeDatabase(): DatabaseService {
  return { seedDefaults: vi.fn(async () => undefined) } as unknown as DatabaseService
}

function makeRevisionRecorder(): RevisionRecorder {
  return { captureStructuralRevision: vi.fn(async () => undefined) } as unknown as RevisionRecorder
}

function makePageService(
  repo: PageRepository,
  uow: UnitOfWork = makeUow(),
  kanban: KanbanService = makeKanban(),
  database: DatabaseService = makeDatabase(),
  history: RevisionRecorder = makeRevisionRecorder(),
): PageService {
  return new PageService(repo, uow, kanban, database, history)
}

// ── create ────────────────────────────────────────────────────────────────────

describe('PageService.create', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls createPageTx and returns { id }', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.create('u1', { workspaceId: 'w1', parentId: null })
    expect(result).toEqual({ id: 'new-1' })
    expect(repo.createPageTx).toHaveBeenCalledOnce()
  })

  it('throws NOT_FOUND when parentId given but parent not found', async () => {
    const repo = makeRepo({ findParentPage: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(
      svc.create('u1', { workspaceId: 'w1', parentId: 'missing' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(repo.createPageTx).not.toHaveBeenCalled()
  })

  it('passes a provisioning dispatcher that seeds KANBAN defaults (onKanban)', async () => {
    const kanban = makeKanban()
    const repo = makeRepo({
      createPageTx: vi.fn(async (_actorId, _input, provision) => {
        await provision.onKanban('kb-1')
        return { id: 'kb-1' }
      }),
    })
    const svc = makePageService(repo, makeUow(), kanban)
    await svc.create('u1', { workspaceId: 'w1', parentId: null, type: 'KANBAN' })
    expect(kanban.seedDefaults).toHaveBeenCalledWith('kb-1')
  })

  it('passes a provisioning dispatcher that seeds DATABASE defaults (onDatabase)', async () => {
    const database = makeDatabase()
    const repo = makeRepo({
      createPageTx: vi.fn(async (_actorId, _input, provision) => {
        await provision.onDatabase('db-1', 'w1')
        return { id: 'db-1' }
      }),
    })
    const svc = makePageService(repo, makeUow(), makeKanban(), database)
    await svc.create('u1', { workspaceId: 'w1', parentId: null, type: 'DATABASE' })
    expect(database.seedDefaults).toHaveBeenCalledWith('db-1', 'w1')
  })
})

// ── rename ────────────────────────────────────────────────────────────────────

describe('PageService.rename', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls renamePageTx after assertOwnership and returns result', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New' })
    expect(result).toMatchObject({ id: 'p1' })
    expect(repo.renamePageTx).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor is not owner and not OWNER role', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...basePageRow, createdById: 'other' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' as const })),
    })
    const svc = makePageService(repo)
    await expect(
      svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(repo.renamePageTx).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when page is inaccessible', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(
      svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('validates the icon format too (33-char plain icon rejected)', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New', icon: 'a'.repeat(33) }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.renamePageTx).not.toHaveBeenCalled()
  })
})

// ── update ────────────────────────────────────────────────────────────────────

describe('PageService.update', () => {
  it('calls updatePageTx after ownership check', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { id: 'p1', workspaceId: 'w1', type: 'KANBAN' })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })
})

// ── update: icon format validation ───────────────────────────────────────────

const FILE_URL = '/api/files/8a33ee5e-95f1-4b53-8d12-0d5dbb1c1a2f'

describe('PageService.update — icon validation', () => {
  beforeEach(() => vi.clearAllMocks())

  const base = { id: 'p1', workspaceId: 'w1' }

  it('accepts a plain emoji icon', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, icon: '🎉' })
    expect(repo.updatePageTx).toHaveBeenCalledWith('u1', expect.objectContaining({ icon: '🎉' }))
  })

  it('accepts a 32-codepoint plain icon', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, icon: 'a'.repeat(32) })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('rejects a 33-char plain icon with an honest BAD_REQUEST', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(svc.update('u1', { ...base, icon: 'a'.repeat(33) })).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Иконка должна быть эмодзи или строкой не длиннее 32 символов',
    })
    expect(repo.updatePageTx).not.toHaveBeenCalled()
  })

  it('accepts url: + a same-origin /api/files/<uuid> path', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, icon: `url:${FILE_URL}` })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('accepts url: + an https URL', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, icon: 'url:https://example.com/pic.png' })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('rejects url: + an http URL', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.update('u1', { ...base, icon: 'url:http://example.com/pic.png' }),
    ).rejects.toMatchObject({ httpStatus: 400 })
    expect(repo.updatePageTx).not.toHaveBeenCalled()
  })

  it('rejects url: + a non-uuid files path', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.update('u1', { ...base, icon: 'url:/api/files/../secret' }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('rejects url: + an https URL longer than 1024 chars', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const longUrl = `https://example.com/${'x'.repeat(1024)}`
    await expect(svc.update('u1', { ...base, icon: `url:${longUrl}` })).rejects.toMatchObject({
      httpStatus: 400,
    })
  })

  it('accepts explicit null (clears the icon)', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, icon: null })
    expect(repo.updatePageTx).toHaveBeenCalledWith('u1', expect.objectContaining({ icon: null }))
  })
})

// ── update: cover validation + mutual exclusion ──────────────────────────────

describe('PageService.update — cover validation', () => {
  beforeEach(() => vi.clearAllMocks())

  const base = { id: 'p1', workspaceId: 'w1' }

  it('accepts a same-origin /api/files/<uuid> coverUrl', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverUrl: FILE_URL })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('accepts an https coverUrl', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverUrl: 'https://example.com/cover.jpg' })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('rejects an http coverUrl with an honest BAD_REQUEST', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.update('u1', { ...base, coverUrl: 'http://example.com/cover.jpg' }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Обложка должна быть ссылкой вида /api/files/<id> или https-ссылкой не длиннее 1024 символов',
    })
    expect(repo.updatePageTx).not.toHaveBeenCalled()
  })

  it('rejects a coverUrl longer than 1024 chars', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.update('u1', { ...base, coverUrl: `https://example.com/${'x'.repeat(1024)}` }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })

  it('accepts a whitelisted coverPreset', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverPreset: 'sunset' })
    expect(repo.updatePageTx).toHaveBeenCalledOnce()
  })

  it('rejects a non-whitelisted coverPreset', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(svc.update('u1', { ...base, coverPreset: 'neon' })).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Неизвестный градиент обложки',
    })
    expect(repo.updatePageTx).not.toHaveBeenCalled()
  })

  it('setting coverUrl clears coverPreset', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverUrl: FILE_URL })
    expect(repo.updatePageTx).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ coverUrl: FILE_URL, coverPreset: null }),
    )
  })

  it('setting coverPreset clears coverUrl', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverPreset: 'ocean' })
    expect(repo.updatePageTx).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ coverPreset: 'ocean', coverUrl: null }),
    )
  })

  it('rejects setting both coverUrl and coverPreset in one call', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.update('u1', { ...base, coverUrl: FILE_URL, coverPreset: 'sunset' }),
    ).rejects.toMatchObject({
      httpStatus: 400,
      message: 'Нельзя одновременно задать обложку-изображение и градиент',
    })
    expect(repo.updatePageTx).not.toHaveBeenCalled()
  })

  it('explicit nulls clear both cover fields', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, coverUrl: null, coverPreset: null })
    expect(repo.updatePageTx).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ coverUrl: null, coverPreset: null }),
    )
  })

  it('does not inject cover fields when neither is in the input', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await svc.update('u1', { ...base, title: 'T' })
    const passed = (repo.updatePageTx as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >
    expect('coverUrl' in passed).toBe(false)
    expect('coverPreset' in passed).toBe(false)
  })
})

// ── duplicate ─────────────────────────────────────────────────────────────────

describe('PageService.duplicate', () => {
  it('calls duplicatePageTx with the fetched page', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.duplicate('u1', { pageId: 'p1' })
    expect(result).toEqual({ id: 'copy-1' })
    expect(repo.duplicatePageTx).toHaveBeenCalledWith('u1', basePageRow)
  })

  it('throws NOT_FOUND when source page is inaccessible', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(svc.duplicate('u1', { pageId: 'p1' })).rejects.toBeInstanceOf(DomainError)
  })
})

// ── move ──────────────────────────────────────────────────────────────────────

describe('PageService.move', () => {
  it('calls movePageTx after access + ownership check', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.move('u1', { pageId: 'p1', newParentId: 'par2' })
    expect(result).toEqual({ id: 'p1' })
    expect(repo.movePageTx).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...basePageRow, createdById: 'other' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' as const })),
    })
    const svc = makePageService(repo)
    await expect(svc.move('u1', { pageId: 'p1', newParentId: null })).rejects.toBeInstanceOf(DomainError)
  })
})

// ── reorder ───────────────────────────────────────────────────────────────────

describe('PageService.reorder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws BAD_REQUEST for self-reference (newPrevPageId === pageId)', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    await expect(
      svc.reorder('u1', { pageId: 'p1', newParentId: null, newPrevPageId: 'p1' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(repo.reorderPageTx).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when page does not exist', async () => {
    const repo = makeRepo({ findActivePageById: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(
      svc.reorder('u1', { pageId: 'p1', newParentId: 'par2', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('throws FORBIDDEN when actor is not a workspace member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(
      svc.reorder('u1', { pageId: 'p1', newParentId: 'par2', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(repo.reorderPageTx).not.toHaveBeenCalled()
  })

  it('short-circuits when parent + prev are unchanged (no tx)', async () => {
    // basePageRow has parentId=null, prevPageId=null — matching the input below.
    const repo = makeRepo()
    const txn = vi.fn(async (fn: () => Promise<unknown>) => fn())
    const uow: UnitOfWork = { client: () => ({}) as never, transaction: txn }
    const svc = makePageService(repo, uow)
    const result = await svc.reorder('u1', { pageId: 'p1', newParentId: null, newPrevPageId: null })
    expect(result).toEqual({ id: 'p1' })
    expect(txn).not.toHaveBeenCalled()
  })

  it('calls assertNotReorderingIntoOwnDescendant then reorderPageTx', async () => {
    const repo = makeRepo({
      findActivePageById: vi.fn(async () => ({ ...basePageRow, parentId: 'old-par', prevPageId: null })),
    })
    const svc = makePageService(repo)
    await svc.reorder('u1', { pageId: 'p1', newParentId: 'new-par', newPrevPageId: null })
    expect(repo.assertNotReorderingIntoOwnDescendant).toHaveBeenCalledWith('p1', 'new-par')
    expect(repo.reorderPageTx).toHaveBeenCalledOnce()
  })

  it('propagates BAD_REQUEST from cycle check', async () => {
    const repo = makeRepo({
      assertNotReorderingIntoOwnDescendant: vi.fn(async () => {
        throw Object.assign(new Error('Нельзя вложить страницу в собственного потомка'), {
          code: 'BAD_REQUEST',
          httpStatus: 400,
          name: 'DomainError',
        })
      }),
    })
    const svc = makePageService(repo)
    await expect(
      svc.reorder('u1', { pageId: 'p1', newParentId: 'desc-1', newPrevPageId: null }),
    ).rejects.toMatchObject({ httpStatus: 400 })
  })
})

// ── softDelete ────────────────────────────────────────────────────────────────

describe('PageService.softDelete', () => {
  it('calls softDeletePageTx after ownership check', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.softDelete('u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(repo.softDeletePageTx).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...basePageRow, createdById: 'other' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' as const })),
    })
    const svc = makePageService(repo)
    await expect(svc.softDelete('u1', { id: 'p1', workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
  })
})

// ── restore ───────────────────────────────────────────────────────────────────

describe('PageService.restore', () => {
  it('calls restorePageTx after ownership check', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.restore('u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(repo.restorePageTx).toHaveBeenCalledOnce()
  })
})

// ── structural revision capture ─────────────────────────────────────────────

describe('PageService structural revision capture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rename records a TITLE_CHANGE revision after the mutation', async () => {
    const repo = makeRepo()
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New' })
    expect(history.captureStructuralRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'TITLE_CHANGE' }),
    )
  })

  it('move records a MOVE revision', async () => {
    const repo = makeRepo()
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await svc.move('u1', { pageId: 'p1', newParentId: 'par2' })
    expect(history.captureStructuralRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'MOVE' }),
    )
  })

  it('archive records an ARCHIVE revision', async () => {
    const repo = makeRepo()
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await svc.archive('u1', { id: 'p1', workspaceId: 'w1' })
    expect(history.captureStructuralRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'ARCHIVE' }),
    )
  })

  it('unarchive records a RESTORE revision', async () => {
    const repo = makeRepo()
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await svc.unarchive('u1', { id: 'p1', workspaceId: 'w1' })
    expect(history.captureStructuralRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'RESTORE' }),
    )
  })

  it('restore (from trash) records a RESTORE revision', async () => {
    const repo = makeRepo()
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await svc.restore('u1', { id: 'p1', workspaceId: 'w1' })
    expect(history.captureStructuralRevision).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1', actorId: 'u1', action: 'RESTORE' }),
    )
  })

  it('does NOT record a revision when the mutation is rejected (access check fails)', async () => {
    const repo = makeRepo({
      findAccessiblePage: vi.fn(async () => ({ ...basePageRow, createdById: 'other' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' as const })),
    })
    const history = makeRevisionRecorder()
    const svc = makePageService(repo, makeUow(), makeKanban(), makeDatabase(), history)
    await expect(
      svc.rename('u1', { id: 'p1', workspaceId: 'w1', title: 'New' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(history.captureStructuralRevision).not.toHaveBeenCalled()
  })
})

// ── hardDelete ────────────────────────────────────────────────────────────────

describe('PageService.hardDelete', () => {
  it('calls hardDeletePageTx after ownership check', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.hardDelete('u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(repo.hardDeletePageTx).toHaveBeenCalledOnce()
  })

  it('throws NOT_FOUND when page is inaccessible', async () => {
    const repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(svc.hardDelete('u1', { id: 'p1', workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
  })
})

// ── emptyTrash ────────────────────────────────────────────────────────────────

describe('PageService.emptyTrash', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls emptyTrashTx and returns count', async () => {
    const repo = makeRepo()
    const svc = makePageService(repo)
    const result = await svc.emptyTrash('u1', { workspaceId: 'w1' })
    expect(result).toEqual({ count: 3 })
    expect(repo.emptyTrashTx).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor is not OWNER', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => ({ role: 'EDITOR' as const })) })
    const svc = makePageService(repo)
    await expect(svc.emptyTrash('u1', { workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
    expect(repo.emptyTrashTx).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when actor is not a member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = makePageService(repo)
    await expect(svc.emptyTrash('u1', { workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
  })

  it('throws FORBIDDEN with correct message for non-OWNER members', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => ({ role: 'ADMIN' as const })) })
    const svc = makePageService(repo)
    await expect(svc.emptyTrash('u1', { workspaceId: 'w1' })).rejects.toMatchObject({
      message: 'Только владелец может очистить корзину',
      httpStatus: 403,
    })
  })
})
