import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { FavoriteService } from '../services/favorite.service.js'
import { FavoriteTools } from './favorite.tools.js'

describe('FavoriteTools', () => {
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique }, workspaceBlockedUser: { findUnique: jest.fn(async () => null) } } as unknown as PrismaClient
  const list = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const add = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const remove = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const service = { list, add, remove } as unknown as FavoriteService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: FavoriteTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new FavoriteTools(prisma, service)
  })

  it('listFavorites forwards', async () => {
    list.mockResolvedValue([])
    const out = await tools.listFavorites({}, {} as never, req)
    expect(out).toEqual({ favorites: [] })
    expect(list).toHaveBeenCalledWith({ userId: 'u1', workspaceId: undefined })
  })

  it('addFavorite checks membership then adds', async () => {
    add.mockResolvedValue({ ok: true })
    const out = await tools.addFavorite({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(out).toEqual({ ok: true })
    expect(add).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
  })

  it('addFavorite rejects a non-member', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.addFavorite({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('removeFavorite forwards by pageId', async () => {
    remove.mockResolvedValue({ count: 1 })
    const out = await tools.removeFavorite({ pageId: 'p1' }, {} as never, req)
    expect(out).toEqual({ count: 1 })
    expect(remove).toHaveBeenCalledWith({ userId: 'u1', pageId: 'p1' })
  })
})
