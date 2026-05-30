import { describe, it, expect, vi, beforeEach } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import type { FavoriteRepository } from '../../../src/favorites/repositories/favorites.repository.ts'
import { FavoriteService } from '../../../src/favorites/services/favorites.service.ts'
import type { WorkspaceService } from '../../../src/workspace/index.ts'

function makeRepo(overrides: Partial<Record<keyof FavoriteRepository, ReturnType<typeof vi.fn>>> = {}) {
  return {
    findAccessiblePage: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1' })),
    maxFavoritePosition: vi.fn(async () => null),
    upsertFavorite: vi.fn(async () => ({ userId: 'u1', pageId: 'p1', position: 0 })),
    removeFavorite: vi.fn(async () => ({ count: 1 })),
    reorderFavorites: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as FavoriteRepository
}

function makeUow(): UnitOfWork {
  return {
    client: () => { throw new Error('client() should not be called from service') },
    transaction: async (fn) => fn(),
  }
}

function makeWorkspace(): WorkspaceService {
  return { assertMembership: vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' as const })) } as unknown as WorkspaceService
}

describe('FavoriteService.add', () => {
  let repo: FavoriteRepository
  let uow: UnitOfWork
  let workspace: WorkspaceService
  let svc: FavoriteService

  beforeEach(() => {
    repo = makeRepo()
    uow = makeUow()
    workspace = makeWorkspace()
    svc = new FavoriteService(repo, uow, workspace)
  })

  it('throws NOT_FOUND (404) when page is inaccessible', async () => {
    repo = makeRepo({ findAccessiblePage: vi.fn(async () => null) })
    svc = new FavoriteService(repo, uow, workspace)
    await expect(svc.add('u1', { pageId: 'p1' })).rejects.toMatchObject({
      httpStatus: 404,
      message: 'Страница не найдена',
    })
    await expect(svc.add('u1', { pageId: 'p1' })).rejects.toSatisfy(isDomainError)
  })

  it('assigns position 0 when there are no existing favorites', async () => {
    await svc.add('u1', { pageId: 'p1' })
    expect(repo.upsertFavorite).toHaveBeenCalledWith('u1', 'p1', 0)
  })

  it('assigns max + 1 when favorites already exist', async () => {
    repo = makeRepo({ maxFavoritePosition: vi.fn(async () => 3) })
    svc = new FavoriteService(repo, uow, workspace)
    await svc.add('u1', { pageId: 'p1' })
    expect(repo.upsertFavorite).toHaveBeenCalledWith('u1', 'p1', 4)
  })

  it('returns the FavoritePageDto from upsertFavorite', async () => {
    const dto = { userId: 'u1', pageId: 'p1', position: 0 }
    repo = makeRepo({ upsertFavorite: vi.fn(async () => dto) })
    svc = new FavoriteService(repo, uow, workspace)
    await expect(svc.add('u1', { pageId: 'p1' })).resolves.toEqual(dto)
  })
})

describe('FavoriteService.remove', () => {
  it('delegates to repo.removeFavorite without checking page access', async () => {
    const repo = makeRepo()
    const svc = new FavoriteService(repo, makeUow(), makeWorkspace())
    const result = await svc.remove('u1', { pageId: 'p1' })
    expect(result).toEqual({ count: 1 })
    expect(repo.removeFavorite).toHaveBeenCalledWith('u1', 'p1')
    expect(repo.findAccessiblePage).not.toHaveBeenCalled()
  })
})

describe('FavoriteService.reorder', () => {
  it('calls workspace.assertMembership before reordering', async () => {
    const repo = makeRepo()
    const workspace = makeWorkspace()
    const svc = new FavoriteService(repo, makeUow(), workspace)
    await svc.reorder('u1', { workspaceId: 'w1', orderedIds: ['p1'] })
    expect(workspace.assertMembership).toHaveBeenCalledWith('u1', 'w1')
    expect(repo.reorderFavorites).toHaveBeenCalledWith('u1', 'w1', ['p1'])
  })

  it('returns { ok: true } on success', async () => {
    const svc = new FavoriteService(makeRepo(), makeUow(), makeWorkspace())
    await expect(svc.reorder('u1', { workspaceId: 'w1', orderedIds: ['p1', 'p2'] })).resolves.toEqual({ ok: true })
  })

  it('propagates the error when workspace.assertMembership throws', async () => {
    const workspace = {
      assertMembership: vi.fn(async () => { throw Object.assign(new Error('Вы не являетесь участником воркспейса'), { code: 'FORBIDDEN', httpStatus: 403, name: 'DomainError' }) }),
    } as unknown as WorkspaceService
    const svc = new FavoriteService(makeRepo(), makeUow(), workspace)
    await expect(svc.reorder('u1', { workspaceId: 'w1', orderedIds: [] })).rejects.toMatchObject({
      httpStatus: 403,
      message: 'Вы не являетесь участником воркспейса',
    })
  })
})
