import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { Context } from '@rekog/mcp-nest'

import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import type { WorkspaceMemberGuard } from '../guards/workspace-member.guard.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import type { McpRequestWithContext } from '../utils/mcp-request-context.js'
import { CreatePageInput, PageTools } from './page.tools.js'

describe('PageTools', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const pageId = '33333333-3333-4333-8333-333333333333'

  const mockPrisma = {
    page: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  } as unknown as PrismaClient
  const mockGuard = {
    assert: jest.fn<(...args: unknown[]) => Promise<void>>(),
  } as unknown as WorkspaceMemberGuard
  const mockWriter = {
    createPage: jest.fn<(...args: unknown[]) => Promise<string>>(),
    updatePage: jest.fn<(...args: unknown[]) => Promise<void>>(),
    movePage: jest.fn<(...args: unknown[]) => Promise<void>>(),
  } as unknown as PageWriter
  const mockRenderer = {
    render: jest.fn<(content: unknown) => string>(),
  } as unknown as MarkdownRenderer
  const mockParser = {
    parse: jest.fn<(markdown: string) => unknown>(),
  } as unknown as MarkdownParser
  const mockStats = {
    getPageStats: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  } as unknown as StatsService

  const req = {
    headers: {},
    mcpContext: { userId, workspaceId },
  } as McpRequestWithContext

  let tools: PageTools

  beforeEach(() => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockGuard.assert as jest.Mock).mockReset().mockImplementation(async () => {})
    ;(mockWriter.createPage as jest.Mock).mockReset()
    ;(mockWriter.updatePage as jest.Mock).mockReset()
    ;(mockWriter.movePage as jest.Mock).mockReset()
    ;(mockRenderer.render as jest.Mock).mockReset()
    ;(mockParser.parse as jest.Mock).mockReset()
    ;(mockStats.getPageStats as jest.Mock).mockReset()
    tools = new PageTools(mockPrisma, mockGuard, mockWriter, mockRenderer, mockParser, mockStats)
  })

  it('createPage returns pageId and forwards args to writer', async () => {
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue(
      '44444444-4444-4444-8444-444444444444' as never,
    )

    const result = await tools.createPage(
      {
        parentId: null,
        title: 'New page',
        ownership: 'AGENT',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({
      pageId: '44444444-4444-4444-8444-444444444444',
      url: `/workspaces/${workspaceId}/pages/44444444-4444-4444-8444-444444444444`,
    })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockWriter.createPage).toHaveBeenCalledWith({
      userId,
      workspaceId,
      parentId: null,
      title: 'New page',
      ownership: 'AGENT',
    })
  })

  it('returns the in-app URL alongside pageId', async () => {
    // NOSONAR S4325 — jest.Mock erases the resolved type to `never`; tsc requires the cast.
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue(
      '44444444-4444-4444-8444-444444444444' as never,
    )

    const result = await tools.createPage(
      { title: 'No body', ownership: 'TEXT' },
      {} as Context,
      req,
    )

    expect(result.pageId).toBe('44444444-4444-4444-8444-444444444444')
    expect(result.url).toBe(`/workspaces/${workspaceId}/pages/${result.pageId}`)
  })

  it('persists markdown content via MarkdownParser when supplied', async () => {
    const markdown = '# Eggs\n\nWhisk and fry.'
    const parsedContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Eggs' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Whisk and fry.' }] },
      ],
    }
    // NOSONAR S4325 — jest.Mock erases the resolved/return type to `never`; tsc requires the cast.
    ;(mockParser.parse as jest.Mock).mockReturnValue(parsedContent as never)
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue(
      '44444444-4444-4444-8444-444444444444' as never,
    )

    await tools.createPage({ title: 'Eggs', markdown, ownership: 'TEXT' }, {} as Context, req)

    expect(mockParser.parse).toHaveBeenCalledWith(markdown)
    expect(mockWriter.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ content: parsedContent }),
    )
  })

  it('CreatePageInput schema rejects markdown longer than 50 000 chars', () => {
    const tooLong = 'x'.repeat(50_001)
    const result = CreatePageInput.safeParse({ title: 'Too big', markdown: tooLong })
    expect(result.success).toBe(false)
  })

  it('updatePage returns ok and forwards workspace context', async () => {
    ;(mockWriter.updatePage as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.updatePage(
      {
        pageId,
        title: 'Updated title',
        icon: 'sparkles',
        content: { type: 'doc' },
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockWriter.updatePage).toHaveBeenCalledWith({
      pageId,
      title: 'Updated title',
      icon: 'sparkles',
      content: { type: 'doc' },
      userId,
      workspaceId,
    })
  })

  it('movePage returns ok and forwards workspace context', async () => {
    ;(mockWriter.movePage as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.movePage(
      {
        pageId,
        newParentId: '55555555-5555-4555-8555-555555555555',
        prevPageId: '66666666-6666-4666-8666-666666666666',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockWriter.movePage).toHaveBeenCalledWith({
      pageId,
      newParentId: '55555555-5555-4555-8555-555555555555',
      prevPageId: '66666666-6666-4666-8666-666666666666',
      userId,
      workspaceId,
    })
  })

  it('getPageMarkdown renders content for page in workspace', async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      workspaceId,
      content: { type: 'doc', content: [] },
    } as never)
    ;(mockRenderer.render as jest.Mock).mockReturnValue('Rendered markdown')

    const result = await tools.getPageMarkdown({ pageId }, {} as never, req)

    expect(result).toEqual({ markdown: 'Rendered markdown' })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockPrisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: pageId },
      select: { workspaceId: true, content: true },
    })
    expect(mockRenderer.render).toHaveBeenCalledWith({ type: 'doc', content: [] })
  })

  it('getPageMarkdown throws when page is missing', async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue(null as never)

    await expect(tools.getPageMarkdown({ pageId }, {} as never, req)).rejects.toBeInstanceOf(
      PageNotFoundError,
    )
  })

  it('getPageStats delegates to stats service', async () => {
    ;(mockStats.getPageStats as jest.Mock).mockResolvedValue({
      type: 'TEXT',
      ownership: 'TEXT',
    } as never)

    const result = await tools.getPageStats({ pageId }, {} as never, req)

    expect(result).toEqual({ type: 'TEXT', ownership: 'TEXT' })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockStats.getPageStats).toHaveBeenCalledWith(pageId, workspaceId)
  })
})
