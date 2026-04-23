import { beforeEach, describe, expect, it, jest } from "@jest/globals"

import type { PrismaClient } from "@repo/db"

import { FileNotFoundError, PageNotFoundError } from "../errors/mcp.errors.js"
import type { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import type { PageWriter } from "../services/page-writer.service.js"
import type { StatsService } from "../services/stats.service.js"
import type { McpRequestWithContext } from "../utils/mcp-request-context.js"
import { WorkspaceTools } from "./workspace.tools.js"

describe("WorkspaceTools", () => {
  const userId = "11111111-1111-4111-8111-111111111111"
  const workspaceId = "22222222-2222-4222-8222-222222222222"
  const parentId = "33333333-3333-4333-8333-333333333333"
  const fileId = "44444444-4444-4444-8444-444444444444"

  const mockPrisma = {
    file: {
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    page: {
      findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    pageFile: {
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  } as unknown as PrismaClient
  const mockGuard = {
    assert: jest.fn<(...args: unknown[]) => Promise<void>>(),
  } as unknown as WorkspaceMemberGuard
  const mockWriter = {
    createPage: jest.fn<(...args: unknown[]) => Promise<string>>(),
  } as unknown as PageWriter
  const mockStats = {
    getWorkspaceStats: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  } as unknown as StatsService

  const req = {
    headers: {},
    mcpContext: { userId, workspaceId },
  } as McpRequestWithContext

  let tools: WorkspaceTools

  beforeEach(() => {
    ;(mockPrisma.file.findMany as jest.Mock).mockReset()
    ;(mockPrisma.file.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.page.findMany as jest.Mock).mockReset()
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.pageFile.create as jest.Mock).mockReset()
    ;(mockGuard.assert as jest.Mock).mockReset().mockImplementation(async () => {})
    ;(mockWriter.createPage as jest.Mock).mockReset()
    ;(mockStats.getWorkspaceStats as jest.Mock).mockReset()
    tools = new WorkspaceTools(mockPrisma, mockGuard, mockWriter, mockStats)
  })

  it("getWorkspaceStats delegates to stats service", async () => {
    ;(mockStats.getWorkspaceStats as jest.Mock).mockResolvedValue({ totalPages: 7 } as never)

    const result = await tools.getWorkspaceStats({}, {} as never, req)

    expect(result).toEqual({ totalPages: 7 })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockStats.getWorkspaceStats).toHaveBeenCalledWith(workspaceId)
  })

  it("listWorkspaceFiles maps file records to response payload", async () => {
    const createdAt = new Date("2026-01-01T10:00:00.000Z")
    ;(mockPrisma.file.findMany as jest.Mock).mockResolvedValue([
      {
        id: fileId,
        name: "notes.txt",
        mimeType: "text/plain",
        fileSize: BigInt(12),
        createdAt,
      },
    ] as never)

    const result = await tools.listWorkspaceFiles({ limit: 10, offset: 5 }, {} as never, req)

    expect(result).toEqual({
      files: [
        {
          id: fileId,
          name: "notes.txt",
          mimeType: "text/plain",
          size: 12,
          createdAt,
        },
      ],
    })
    expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
      where: { workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 5,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
  })

  it("listSkills queries only skill pages", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "skill-1", title: "Skill", icon: "bolt", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ] as never)

    const result = await tools.listSkills({ limit: 20 }, {} as never, req)

    expect(result).toEqual({
      pages: [{ id: "skill-1", title: "Skill", icon: "bolt", createdAt: new Date("2026-01-01T00:00:00.000Z") }],
    })
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { workspaceId, ownership: "SKILL", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
  })

  it("listAgents queries only agent pages", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "agent-1", title: "Agent", icon: null, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    ] as never)

    const result = await tools.listAgents({ limit: 15 }, {} as never, req)

    expect(result).toEqual({
      pages: [{ id: "agent-1", title: "Agent", icon: null, createdAt: new Date("2026-01-02T00:00:00.000Z") }],
    })
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { workspaceId, ownership: "AGENT", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
  })

  it("createPageFromFile creates page and attaches file", async () => {
    ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: fileId,
      workspaceId,
      name: "source.md",
    } as never)
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      workspaceId,
      deletedAt: null,
    } as never)
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue("55555555-5555-4555-8555-555555555555" as never)
    ;(mockPrisma.pageFile.create as jest.Mock).mockResolvedValue({} as never)

    const result = await tools.createPageFromFile(
      {
        parentId,
        fileId,
        title: "Derived page",
      },
      {} as never,
      req,
    )

    expect(result).toEqual({ pageId: "55555555-5555-4555-8555-555555555555" })
    expect(mockGuard.assert).toHaveBeenCalledWith(workspaceId, userId)
    expect(mockWriter.createPage).toHaveBeenCalledWith({
      userId,
      workspaceId,
      parentId,
      title: "Derived page",
      ownership: "TEXT",
    })
    expect(mockPrisma.pageFile.create).toHaveBeenCalledWith({
      data: { pageId: "55555555-5555-4555-8555-555555555555", fileId },
    })
  })

  it("createPageFromFile uses source file name as default title", async () => {
    ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: fileId,
      workspaceId,
      name: "fallback-title.md",
    } as never)
    ;(mockWriter.createPage as jest.Mock).mockResolvedValue("55555555-5555-4555-8555-555555555555" as never)
    ;(mockPrisma.pageFile.create as jest.Mock).mockResolvedValue({} as never)

    await tools.createPageFromFile({ parentId: undefined, fileId }, {} as never, req)

    expect(mockWriter.createPage).toHaveBeenCalledWith({
      userId,
      workspaceId,
      parentId: undefined,
      title: "fallback-title.md",
      ownership: "TEXT",
    })
  })

  it("createPageFromFile throws when source file is missing", async () => {
    ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue(null as never)

    await expect(
      tools.createPageFromFile({ parentId: undefined, fileId }, {} as never, req),
    ).rejects.toBeInstanceOf(FileNotFoundError)
  })

  it("createPageFromFile throws when parent page is invalid", async () => {
    ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({
      id: fileId,
      workspaceId,
      name: "source.md",
    } as never)
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      workspaceId: "other-workspace",
      deletedAt: null,
    } as never)

    await expect(
      tools.createPageFromFile({ parentId, fileId }, {} as never, req),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
