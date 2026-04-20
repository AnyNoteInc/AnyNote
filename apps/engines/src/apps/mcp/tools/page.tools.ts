import { Inject, Injectable } from "@nestjs/common"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import { MarkdownRenderer } from "../services/markdown-renderer.service.js"
import { PageWriter } from "../services/page-writer.service.js"
import { StatsService } from "../services/stats.service.js"

const UserWorkspace = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

@Injectable()
export class PageTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly writer: PageWriter,
    private readonly renderer: MarkdownRenderer,
    private readonly stats: StatsService,
  ) {}

  @Tool({
    name: "createPage",
    description: "Create a new page in a workspace",
    parameters: UserWorkspace.extend({
      parentId: z.string().uuid().nullable().optional(),
      title: z.string().min(1).max(255),
      ownership: z.enum(["TEXT", "SKILL", "AGENT"]).default("TEXT"),
    }),
  })
  async createPage(args: {
    userId: string
    workspaceId: string
    parentId?: string | null
    title: string
    ownership?: "TEXT" | "SKILL" | "AGENT"
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const pageId = await this.writer.createPage({
      userId: args.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title: args.title,
      ownership: args.ownership,
    })
    return { pageId }
  }

  @Tool({
    name: "updatePage",
    description: "Update page title/icon/content",
    parameters: UserWorkspace.extend({
      pageId: z.string().uuid(),
      title: z.string().max(255).optional(),
      icon: z.string().nullable().optional(),
      content: z.unknown().optional(),
    }),
  })
  async updatePage(args: {
    userId: string
    workspaceId: string
    pageId: string
    title?: string
    icon?: string | null
    content?: unknown
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.writer.updatePage(args)
    return { ok: true as const }
  }

  @Tool({
    name: "movePage",
    description: "Move a page to a new parent or reorder",
    parameters: UserWorkspace.extend({
      pageId: z.string().uuid(),
      newParentId: z.string().uuid().nullable().optional(),
      prevPageId: z.string().uuid().nullable().optional(),
    }),
  })
  async movePage(args: {
    userId: string
    workspaceId: string
    pageId: string
    newParentId?: string | null
    prevPageId?: string | null
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.writer.movePage(args)
    return { ok: true as const }
  }

  @Tool({
    name: "getPageMarkdown",
    description: "Render page content as Markdown",
    parameters: UserWorkspace.extend({ pageId: z.string().uuid() }),
  })
  async getPageMarkdown(args: { userId: string; workspaceId: string; pageId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true, content: true },
    })
    if (!page || page.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.pageId)
    return { markdown: this.renderer.render(page.content as never) }
  }

  @Tool({
    name: "getPageStats",
    description: "Return page metadata (creator, creation date, type, ownership)",
    parameters: UserWorkspace.extend({ pageId: z.string().uuid() }),
  })
  async getPageStats(args: { userId: string; workspaceId: string; pageId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.stats.getPageStats(args.pageId, args.workspaceId)
  }
}
