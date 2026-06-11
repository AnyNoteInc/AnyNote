import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'

describe('PageTools archive/restore', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique }, workspaceBlockedUser: { findUnique: jest.fn(async () => null) } } as unknown as PrismaClient
  const setArchived = jest.fn<(...a: unknown[]) => Promise<void>>()
  const writer = { setArchived } as unknown as PageWriter
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    setArchived.mockResolvedValue()
    tools = new PageTools(prisma, writer, {} as MarkdownRenderer, {} as MarkdownParser, {} as StatsService)
  })

  it('archivePage sets archived=true', async () => {
    await tools.archivePage({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(setArchived).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: true })
  })

  it('restorePage sets archived=false', async () => {
    await tools.restorePage({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(setArchived).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: false })
  })
})
