import { jest, describe, it, expect } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'
import { WorkspaceTools } from './workspace.tools.js'

describe('Tools access control', () => {
  const mockPrisma = {
    workspaceMember: {
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    },
  } as unknown as PrismaClient

  const nonMemberReq: AuthedRequest = { headers: {}, auth: { userId: 'u1', source: 'api-key' } }

  it('PageTools.createPage denies non-member', async () => {
    const tools = new PageTools(
      mockPrisma,
      {} as PageWriter,
      {} as MarkdownRenderer,
      {} as MarkdownParser,
      {} as StatsService,
    )
    await expect(
      tools.createPage({ workspaceId: 'w1', title: 'x', ownership: 'TEXT' }, {} as never, nonMemberReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('WorkspaceTools.getWorkspaceStats denies non-member', async () => {
    const tools = new WorkspaceTools(mockPrisma, {} as PageWriter, {} as StatsService)
    await expect(
      tools.getWorkspaceStats({ workspaceId: 'w1' }, {} as never, nonMemberReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
