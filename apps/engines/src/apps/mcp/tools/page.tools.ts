import { Inject, Injectable } from "@nestjs/common"
import type { Context } from "@rekog/mcp-nest"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import { MarkdownRenderer } from "../services/markdown-renderer.service.js"
import { PageWriter } from "../services/page-writer.service.js"
import { StatsService } from "../services/stats.service.js"
import { getMcpRequestContext, type McpRequestWithContext } from "../utils/mcp-request-context.js"

const CreatePageInput = z.object({
  parentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255),
  ownership: z.enum(["TEXT", "SKILL", "AGENT"]).default("TEXT"),
})

const UpdatePageInput = z.object({
  pageId: z.string().uuid(),
  title: z.string().max(255).optional(),
  icon: z.string().nullable().optional(),
  content: z.unknown().optional(),
})

const MovePageInput = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable().optional(),
  prevPageId: z.string().uuid().nullable().optional(),
})

const PageIdInput = z.object({ pageId: z.string().uuid() })

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
    parameters: CreatePageInput,
  })
  async createPage(
    args: z.infer<typeof CreatePageInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const pageId = await this.writer.createPage({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      parentId: args.parentId,
      title: args.title,
      ownership: args.ownership,
    })
    return { pageId }
  }

  @Tool({
    name: "updatePage",
    description: "Update page title/icon/content",
    parameters: UpdatePageInput,
  })
  async updatePage(
    args: z.infer<typeof UpdatePageInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    await this.writer.updatePage({
      ...args,
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
    })
    return { ok: true as const }
  }

  @Tool({
    name: "movePage",
    description: "Move a page to a new parent or reorder",
    parameters: MovePageInput,
  })
  async movePage(
    args: z.infer<typeof MovePageInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    await this.writer.movePage({
      ...args,
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
    })
    return { ok: true as const }
  }

  @Tool({
    name: "getPageMarkdown",
    description: "Render page content as Markdown",
    parameters: PageIdInput,
  })
  async getPageMarkdown(
    args: z.infer<typeof PageIdInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true, content: true },
    })
    if (!page || page.workspaceId !== requestContext.workspaceId) {
      throw new PageNotFoundError(args.pageId)
    }
    return { markdown: this.renderer.render(page.content as never) }
  }

  @Tool({
    name: "getPageStats",
    description: "Return page metadata (creator, creation date, type, ownership)",
    parameters: PageIdInput,
  })
  async getPageStats(
    args: z.infer<typeof PageIdInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    return this.stats.getPageStats(args.pageId, requestContext.workspaceId)
  }
}
