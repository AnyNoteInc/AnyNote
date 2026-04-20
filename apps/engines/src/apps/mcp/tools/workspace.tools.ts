import { Inject, Injectable } from "@nestjs/common"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import { PageWriter } from "../services/page-writer.service.js"
import { StatsService } from "../services/stats.service.js"

const UserWorkspace = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

@Injectable()
export class WorkspaceTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly writer: PageWriter,
    private readonly stats: StatsService,
  ) {}

  @Tool({
    name: "getWorkspaceStats",
    description: "Workspace members, pages-by-type, total pages",
    parameters: UserWorkspace,
  })
  async getWorkspaceStats(args: { userId: string; workspaceId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.stats.getWorkspaceStats(args.workspaceId)
  }

  @Tool({
    name: "listWorkspaceFiles",
    description: "List all files in a workspace",
    parameters: UserWorkspace.extend({
      limit: z.number().int().positive().max(200).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
  })
  async listWorkspaceFiles(args: {
    userId: string
    workspaceId: string
    limit: number
    offset: number
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const files = await this.prisma.file.findMany({
      where: { workspaceId: args.workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: args.limit,
      skip: args.offset,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
    return {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.fileSize),
        createdAt: f.createdAt,
      })),
    }
  }

  @Tool({
    name: "listSkills",
    description: "List skill pages (ownership=SKILL) in a workspace",
    parameters: UserWorkspace.extend({ limit: z.number().int().positive().max(200).default(50) }),
  })
  async listSkills(args: { userId: string; workspaceId: string; limit: number }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.listOwnershipPages(args.workspaceId, "SKILL", args.limit)
  }

  @Tool({
    name: "listAgents",
    description: "List agent pages (ownership=AGENT) in a workspace",
    parameters: UserWorkspace.extend({ limit: z.number().int().positive().max(200).default(50) }),
  })
  async listAgents(args: { userId: string; workspaceId: string; limit: number }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.listOwnershipPages(args.workspaceId, "AGENT", args.limit)
  }

  @Tool({
    name: "createPageFromFile",
    description: "Create a page and attach an existing workspace file to it",
    parameters: UserWorkspace.extend({
      parentId: z.string().uuid().nullable().optional(),
      fileId: z.string().uuid(),
      title: z.string().min(1).max(255).optional(),
    }),
  })
  async createPageFromFile(args: {
    userId: string
    workspaceId: string
    parentId?: string | null
    fileId: string
    title?: string
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const file = await this.prisma.file.findUnique({
      where: { id: args.fileId },
      select: { id: true, workspaceId: true, name: true },
    })
    if (!file || file.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.fileId)
    if (args.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: args.parentId },
        select: { workspaceId: true, deletedAt: true },
      })
      if (!parent || parent.workspaceId !== args.workspaceId || parent.deletedAt) {
        throw new PageNotFoundError(args.parentId)
      }
    }
    const title = args.title ?? file.name
    const pageId = await this.writer.createPage({
      userId: args.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title,
      ownership: "TEXT",
    })
    await this.prisma.pageFile.create({ data: { pageId, fileId: args.fileId } })
    return { pageId }
  }

  private async listOwnershipPages(
    workspaceId: string,
    ownership: "SKILL" | "AGENT",
    limit: number,
  ) {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId, ownership, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
    return { pages }
  }
}
