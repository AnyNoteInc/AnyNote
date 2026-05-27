import { jest, describe, it, expect } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import { WorkspaceAccessDeniedError } from '../errors/mcp.errors.js'
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import type { McpRequestWithContext } from '../utils/mcp-request-context.js'
import { PageTools } from './page.tools.js'
import { WorkspaceTools } from './workspace.tools.js'

describe('Tools access control', () => {
  const mockPrisma = {
    workspaceMember: {
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(null as never),
    },
  } as unknown as PrismaClient
  const req = {
    headers: {},
    mcpContext: { userId: 'u1', workspaceId: 'w1' },
  } as McpRequestWithContext

  it('PageTools.createPage denies non-member', async () => {
    const tools = new PageTools(
      mockPrisma,
      {} as PageWriter,
      {} as MarkdownRenderer,
      {} as MarkdownParser,
      {} as StatsService,
    )
    const authedReq: any = { auth: { userId: 'u1', source: 'api-key' } }
    await expect(
      tools.createPage({ workspaceId: 'w1', title: 'x', ownership: 'TEXT' }, {} as never, authedReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('WorkspaceTools.getWorkspaceStats denies non-member', async () => {
    const guard = new WorkspaceMemberGuard(mockPrisma)
    const tools = new WorkspaceTools(mockPrisma, guard, {} as PageWriter, {} as StatsService)
    await expect(tools.getWorkspaceStats({}, {} as never, req)).rejects.toBeInstanceOf(
      WorkspaceAccessDeniedError,
    )
  })
})
