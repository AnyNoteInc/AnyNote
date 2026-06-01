import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'

import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { CreatePageInput, PageTools } from './page.tools.js'

describe('PageTools', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const pageId = '33333333-3333-4333-8333-333333333333'

  const workspaceMemberFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    workspaceMember: {
      findUnique: workspaceMemberFindUniqueMock,
    },
  } as unknown as PrismaClient
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

  const req: AuthedRequest = { headers: {}, auth: { userId, source: 'api-key' } }

  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    workspaceMemberFindUniqueMock.mockResolvedValue({ workspaceId })
    tools = new PageTools(prisma, mockWriter, mockRenderer, mockParser, mockStats)
  })

  it('createPage returns pageId and forwards args to writer', async () => {
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue(
      '44444444-4444-4444-8444-444444444444' as never,
    )

    const result = await tools.createPage(
      {
        workspaceId,
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
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalled()
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
      { workspaceId, title: 'No body', ownership: 'TEXT' },
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

    await tools.createPage(
      { workspaceId, title: 'Eggs', markdown, ownership: 'TEXT' },
      {} as Context,
      req,
    )

    expect(mockParser.parse).toHaveBeenCalledWith(markdown)
    expect(mockWriter.createPage).toHaveBeenCalledWith(
      expect.objectContaining({ content: parsedContent }),
    )
  })

  it('CreatePageInput schema rejects markdown longer than 50 000 chars', () => {
    const tooLong = 'x'.repeat(50_001)
    const result = CreatePageInput.safeParse({ workspaceId, title: 'Too big', markdown: tooLong })
    expect(result.success).toBe(false)
  })

  it('rejects when caller is not a workspace member', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue(null)
    const nonMemberReq: AuthedRequest = { headers: {}, auth: { userId: 'u1', source: 'api-key' } }
    await expect(
      tools.createPage({ workspaceId: 'w1', title: 'x', ownership: 'TEXT' }, {} as never, nonMemberReq),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('updatePage returns ok and forwards workspace context', async () => {
    ;(mockWriter.updatePage as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.updatePage(
      {
        workspaceId,
        pageId,
        title: 'Updated title',
        icon: 'sparkles',
        content: { type: 'doc' },
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockWriter.updatePage).toHaveBeenCalledWith({
      pageId,
      title: 'Updated title',
      icon: 'sparkles',
      content: { type: 'doc' },
      userId,
      workspaceId,
    })
  })

  it('updatePage parses markdown into a Tiptap doc via MarkdownParser', async () => {
    const markdown = '# Русская баня\n\nВлажная парная с веником.'
    const parsedContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Русская баня' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Влажная парная с веником.' }] },
      ],
    }
    ;(mockParser.parse as jest.Mock).mockReturnValue(parsedContent as never)
    ;(mockWriter.updatePage as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.updatePage({ workspaceId, pageId, markdown }, {} as never, req)

    expect(result).toEqual({ ok: true })
    expect(mockParser.parse).toHaveBeenCalledWith(markdown)
    // The parsed Tiptap doc must reach the writer as `content` so contentYjs can
    // be rebuilt and the editor renders the text (raw markdown/strings cannot).
    expect(mockWriter.updatePage).toHaveBeenCalledWith(
      expect.objectContaining({ pageId, workspaceId, userId, content: parsedContent }),
    )
  })

  it('movePage returns ok and forwards workspace context', async () => {
    ;(mockWriter.movePage as jest.Mock).mockResolvedValue(undefined as never)

    const result = await tools.movePage(
      {
        workspaceId,
        pageId,
        newParentId: '55555555-5555-4555-8555-555555555555',
        prevPageId: '66666666-6666-4666-8666-666666666666',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ ok: true })
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockWriter.movePage).toHaveBeenCalledWith({
      pageId,
      newParentId: '55555555-5555-4555-8555-555555555555',
      prevPageId: '66666666-6666-4666-8666-666666666666',
      userId,
      workspaceId,
    })
  })

  it('getPageMarkdown renders content for page in workspace', async () => {
    ;(prisma.page.findUnique as jest.Mock).mockResolvedValue({
      workspaceId,
      content: { type: 'doc', content: [] },
    } as never)
    ;(mockRenderer.render as jest.Mock).mockReturnValue('Rendered markdown')

    const result = await tools.getPageMarkdown({ workspaceId, pageId }, {} as never, req)

    expect(result).toEqual({ markdown: 'Rendered markdown' })
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(prisma.page.findUnique).toHaveBeenCalledWith({
      where: { id: pageId },
      select: { workspaceId: true, content: true },
    })
    expect(mockRenderer.render).toHaveBeenCalledWith({ type: 'doc', content: [] })
  })

  it('getPageMarkdown throws when page is missing', async () => {
    ;(prisma.page.findUnique as jest.Mock).mockResolvedValue(null as never)

    await expect(
      tools.getPageMarkdown({ workspaceId, pageId }, {} as never, req),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })

  it('getPageStats delegates to stats service', async () => {
    ;(mockStats.getPageStats as jest.Mock).mockResolvedValue({
      type: 'TEXT',
      ownership: 'TEXT',
    } as never)

    const result = await tools.getPageStats({ workspaceId, pageId }, {} as never, req)

    expect(result).toEqual({ type: 'TEXT', ownership: 'TEXT' })
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockStats.getPageStats).toHaveBeenCalledWith(pageId, workspaceId)
  })
})
