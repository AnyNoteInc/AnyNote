import { jest, describe, it, expect } from "@jest/globals"

import type { PrismaClient } from "@repo/db"

import { WorkspaceAccessDeniedError } from "../errors/mcp.errors.js"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import type { FileUploader } from "../services/file-uploader.service.js"
import type { MarkdownRenderer } from "../services/markdown-renderer.service.js"
import type { PageWriter } from "../services/page-writer.service.js"
import type { StatsService } from "../services/stats.service.js"
import { PageTools } from "./page.tools.js"
import { WorkspaceTools } from "./workspace.tools.js"

describe("Tools access control", () => {
  const mockPrisma = {
    workspaceMember: {
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(null as never),
    },
  } as unknown as PrismaClient

  it("PageTools.createPage denies non-member", async () => {
    const guard = new WorkspaceMemberGuard(mockPrisma)
    const tools = new PageTools(
      mockPrisma,
      guard,
      {} as PageWriter,
      {} as MarkdownRenderer,
      {} as StatsService,
    )
    await expect(
      tools.createPage({
        userId: "u1",
        workspaceId: "w1",
        title: "x",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it("WorkspaceTools.getWorkspaceStats denies non-member", async () => {
    const guard = new WorkspaceMemberGuard(mockPrisma)
    const tools = new WorkspaceTools(mockPrisma, guard, {} as PageWriter, {} as StatsService)
    await expect(
      tools.getWorkspaceStats({ userId: "u1", workspaceId: "w1" }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })
})
