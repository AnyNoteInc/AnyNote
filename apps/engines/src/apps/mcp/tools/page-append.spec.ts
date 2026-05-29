import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'

describe('PageTools.appendToPage', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique } } as unknown as PrismaClient
  const parse = jest.fn<(md: string) => unknown>()
  const appendContent = jest.fn<(...a: unknown[]) => Promise<void>>()
  const parser = { parse } as unknown as MarkdownParser
  const writer = { appendContent } as unknown as PageWriter
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new PageTools(prisma, writer, {} as MarkdownRenderer, parser, {} as StatsService)
  })

  it('parses markdown and forwards to PageWriter.appendContent', async () => {
    const parsed = { type: 'doc', content: [{ type: 'paragraph' }] }
    parse.mockReturnValue(parsed)
    appendContent.mockResolvedValue()
    const out = await tools.appendToPage({ workspaceId: 'w1', pageId: 'p1', markdown: '## note' }, {} as never, req)
    expect(out).toEqual({ ok: true })
    expect(parse).toHaveBeenCalledWith('## note')
    expect(appendContent).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended: parsed })
  })
})
