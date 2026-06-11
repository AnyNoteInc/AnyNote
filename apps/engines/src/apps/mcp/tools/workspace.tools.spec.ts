import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { FileNotFoundError, PageNotFoundError } from '../errors/mcp.errors.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { WorkspaceTools } from './workspace.tools.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('WorkspaceTools', () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const parentId = '33333333-3333-4333-8333-333333333333'
  const fileId = '44444444-4444-4444-8444-444444444444'

  const workspaceMemberFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const fileFindManyMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const fileFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const pageFindManyMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const pageFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const pageFileCreateMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const writerCreatePageMock = jest.fn<(...args: unknown[]) => Promise<string>>()
  const getWorkspaceStatsMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()

  const mockPrisma = {
    file: {
      findMany: fileFindManyMock,
      findUnique: fileFindUniqueMock,
    },
    page: {
      findMany: pageFindManyMock,
      findUnique: pageFindUniqueMock,
    },
    pageFile: {
      create: pageFileCreateMock,
    },
    workspaceMember: {
      findUnique: workspaceMemberFindUniqueMock,
    },
    workspaceBlockedUser: { findUnique: jest.fn(async () => null) },
  } as unknown as PrismaClient
  const mockWriter = { createPage: writerCreatePageMock } as unknown as PageWriter
  const mockStats = { getWorkspaceStats: getWorkspaceStatsMock } as unknown as StatsService

  const req: AuthedRequest = { headers: {}, auth: { userId, source: 'api-key' } }

  let tools: WorkspaceTools

  beforeEach(() => {
    jest.clearAllMocks()
    workspaceMemberFindUniqueMock.mockResolvedValue({ workspaceId: 'w' })
    tools = new WorkspaceTools(mockPrisma, mockWriter, mockStats)
  })

  it('getWorkspaceStats delegates to stats service', async () => {
    getWorkspaceStatsMock.mockResolvedValue({ totalPages: 7 })

    const result = await tools.getWorkspaceStats({ workspaceId }, {} as never, req)

    expect(result).toEqual({ totalPages: 7 })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockStats.getWorkspaceStats).toHaveBeenCalledWith(workspaceId)
  })

  it('getWorkspaceStats throws ForbiddenException for non-member', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue(null)

    await expect(
      tools.getWorkspaceStats({ workspaceId }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('listWorkspaceFiles maps file records to response payload', async () => {
    const createdAt = new Date('2026-01-01T10:00:00.000Z')
    fileFindManyMock.mockResolvedValue([
      {
        id: fileId,
        name: 'notes.txt',
        mimeType: 'text/plain',
        fileSize: BigInt(12),
        createdAt,
      },
    ])

    const result = await tools.listWorkspaceFiles(
      { workspaceId, limit: 10, offset: 5 },
      {} as never,
      req,
    )

    expect(result).toEqual({
      files: [
        {
          id: fileId,
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 12,
          createdAt,
        },
      ],
    })
    expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      skip: 5,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
  })

  it('listSkills queries only skill pages', async () => {
    pageFindManyMock.mockResolvedValue([
      {
        id: 'skill-1',
        title: 'Skill',
        icon: 'bolt',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const result = await tools.listSkills({ workspaceId, limit: 20 }, {} as never, req)

    expect(result).toEqual({
      pages: [
        {
          id: 'skill-1',
          title: 'Skill',
          icon: 'bolt',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    })
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { workspaceId, ownership: 'SKILL', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
  })

  it('listAgents queries only agent pages', async () => {
    pageFindManyMock.mockResolvedValue([
      {
        id: 'agent-1',
        title: 'Agent',
        icon: null,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    ])

    const result = await tools.listAgents({ workspaceId, limit: 15 }, {} as never, req)

    expect(result).toEqual({
      pages: [
        {
          id: 'agent-1',
          title: 'Agent',
          icon: null,
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
    })
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { workspaceId, ownership: 'AGENT', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
  })

  it('createPageFromFile creates page and attaches file', async () => {
    fileFindUniqueMock.mockResolvedValue({
      id: fileId,
      workspaceId,
      name: 'source.md',
    })
    pageFindUniqueMock.mockResolvedValue({
      workspaceId,
      deletedAt: null,
    })
    writerCreatePageMock.mockResolvedValue('55555555-5555-4555-8555-555555555555')
    pageFileCreateMock.mockResolvedValue({})

    const result = await tools.createPageFromFile(
      {
        workspaceId,
        parentId,
        fileId,
        title: 'Derived page',
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ pageId: '55555555-5555-4555-8555-555555555555' })
    expect(mockPrisma.workspaceMember.findUnique).toHaveBeenCalled()
    expect(mockWriter.createPage).toHaveBeenCalledWith({
      userId,
      workspaceId,
      parentId,
      title: 'Derived page',
      ownership: 'TEXT',
    })
    expect(mockPrisma.pageFile.create).toHaveBeenCalledWith({
      data: { pageId: '55555555-5555-4555-8555-555555555555', fileId },
    })
  })

  it('createPageFromFile uses source file name as default title', async () => {
    fileFindUniqueMock.mockResolvedValue({
      id: fileId,
      workspaceId,
      name: 'fallback-title.md',
    })
    writerCreatePageMock.mockResolvedValue('55555555-5555-4555-8555-555555555555')
    pageFileCreateMock.mockResolvedValue({})

    await tools.createPageFromFile({ workspaceId, parentId: undefined, fileId }, {} as never, req)

    expect(mockWriter.createPage).toHaveBeenCalledWith({
      userId,
      workspaceId,
      parentId: undefined,
      title: 'fallback-title.md',
      ownership: 'TEXT',
    })
  })

  it('createPageFromFile throws when source file is missing', async () => {
    fileFindUniqueMock.mockResolvedValue(null)

    await expect(
      tools.createPageFromFile({ workspaceId, parentId: undefined, fileId }, {} as never, req),
    ).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it('createPageFromFile throws when parent page is invalid', async () => {
    fileFindUniqueMock.mockResolvedValue({
      id: fileId,
      workspaceId,
      name: 'source.md',
    })
    pageFindUniqueMock.mockResolvedValue({
      workspaceId: 'other-workspace',
      deletedAt: null,
    })

    await expect(
      tools.createPageFromFile({ workspaceId, parentId, fileId }, {} as never, req),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })

  describe('WorkspaceTools — intent-first descriptions', () => {
    // The Tool decorator stores metadata on the prototype via reflect-metadata.
    // We assert against the source descriptors by reading the @Tool() arg.
    // Simplest portable check: ensure each method's @Tool description contains
    // a Russian trigger phrase so the planner can match natural language.
    let source: string

    beforeAll(async () => {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      source = await fs.readFile(path.join(__dirname, 'workspace.tools.ts'), 'utf8')
    })

    it('getWorkspaceStats description mentions "сколько страниц" or "статистик"', () => {
      const match =
        /name: 'getWorkspaceStats'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/.exec(source)
      expect(match).not.toBeNull()
      const desc = match![1]!
      expect(desc).toMatch(/сколько страниц|статистик/i)
    })

    it('listWorkspaceFiles description mentions "файл" or "вложен"', () => {
      const match =
        /name: 'listWorkspaceFiles'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/.exec(source)
      expect(match![1]).toMatch(/файл|вложен/i)
    })

    it('listSkills description mentions "навык" or "skill"', () => {
      const match =
        /name: 'listSkills'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/.exec(source)
      expect(match![1]).toMatch(/навык|skill/i)
    })

    it('listAgents description mentions "агент" or "agent"', () => {
      const match =
        /name: 'listAgents'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/.exec(source)
      expect(match![1]).toMatch(/агент|agent/i)
    })
  })
})
