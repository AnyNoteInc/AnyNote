import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { FavoriteService } from '../services/favorite.service.js'
import { mcpInput, mcpUuid } from '../utils/mcp-input.js'

const ListFavoritesInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
})
const AddFavoriteInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})
const RemoveFavoriteInput = z.object({
  pageId: mcpUuid(),
})
const ReorderFavoritesInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
})

type ListFavoritesArgs = z.infer<typeof ListFavoritesInput>
type AddFavoriteArgs = z.infer<typeof AddFavoriteInput>
type RemoveFavoriteArgs = z.infer<typeof RemoveFavoriteInput>
type ReorderFavoritesArgs = z.infer<typeof ReorderFavoritesInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class FavoriteTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly favorites: FavoriteService,
  ) {}

  @Tool({
    name: 'listFavorites',
    description:
      'Список избранных страниц пользователя (по всем пространствам или по одному, ' +
      'если задан workspaceId). Возвращает pageId, title, type, icon, workspaceId. ' +
      'Параметр: workspaceId (опц.).',
    parameters: ListFavoritesInput,
  })
  async listFavorites(args: ListFavoritesArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    const favorites = await this.favorites.list({ userId: auth.userId, workspaceId: args.workspaceId ?? undefined })
    return { favorites }
  }

  @Tool({
    name: 'addFavorite',
    description: 'Добавляет страницу в избранное. Параметры: workspaceId, pageId.',
    parameters: AddFavoriteInput,
  })
  addFavorite(args: AddFavoriteArgs, _context: Context, req: AuthedRequest) {
    return this.doAddFavorite(requireAuth(req), args)
  }

  async doAddFavorite(auth: AuthContext, args: AddFavoriteArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.favorites.add({ userId: auth.userId, workspaceId: args.workspaceId, pageId: args.pageId })
  }

  @Tool({
    name: 'removeFavorite',
    description: 'Убирает страницу из избранного. Параметр: pageId.',
    parameters: RemoveFavoriteInput,
  })
  async removeFavorite(args: RemoveFavoriteArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.favorites.remove({ userId: auth.userId, pageId: args.pageId })
  }

  @Tool({
    name: 'reorderFavorites',
    description:
      'Переупорядочивает избранные страницы пользователя в воркспейсе. ' +
      'orderedIds — полный список pageId в желаемом порядке (0-based position). ' +
      'Требует подтверждения. Параметры: workspaceId, orderedIds[].',
    parameters: ReorderFavoritesInput,
  })
  async reorderFavorites(args: ReorderFavoritesArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.favorites.reorder({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      orderedIds: args.orderedIds,
    })
  }
}
