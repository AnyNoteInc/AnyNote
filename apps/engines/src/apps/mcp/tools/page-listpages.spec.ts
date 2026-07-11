import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'
import { makeFakeYjsEditor } from '../services/__testutils__/fake-yjs-editor.js'

describe('PageTools.listPages', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique },
    workspaceBlockedUser: { findUnique: jest.fn(async () => null) },
    page: { findMany: pageFindMany },
  } as unknown as PrismaClient
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new PageTools(prisma, {} as PageWriter, {} as MarkdownRenderer, {} as MarkdownParser, {} as StatsService, makeFakeYjsEditor())
  })

  it('returns pages filtered to roots when parentId is null', async () => {
    pageFindMany.mockResolvedValue([{ id: 'p1', title: 'Root', type: 'TEXT', icon: null, parentId: null }])
    const out = await tools.listPages({ workspaceId: 'w1', parentId: null, limit: 200 }, {} as never, req)
    expect(out.pages).toEqual([{ id: 'p1', title: 'Root', type: 'TEXT', icon: null, parentId: null }])
    expect(pageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // AND carries the page-visibility predicate (collection/share scoping for the caller).
        where: {
          workspaceId: 'w1',
          archivedAt: null,
          deletedAt: null,
          // AND carries: [0] page-visibility predicate (collection/share scoping),
          // [1] excludeDatabaseRowPages (hide pages parented to a DATABASE page).
          AND: [
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({ OR: expect.any(Array) }),
          ],
          parentId: null,
        },
      }),
    )
  })

  it('rejects a non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    await expect(
      tools.listPages({ workspaceId: 'w1', limit: 200 }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
