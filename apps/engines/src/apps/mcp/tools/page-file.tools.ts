import { Inject, Injectable } from "@nestjs/common"
import type { Context } from "@rekog/mcp-nest"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard.js"
import { FileUploader } from "../services/file-uploader.service.js"
import { getMcpRequestContext, type McpRequestWithContext } from "../utils/mcp-request-context.js"

const UploadInline = z.object({
  pageId: z.string().uuid(),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  contentBase64: z.string().min(1),
})

const Attach = z.object({
  pageId: z.string().uuid(),
  fileId: z.string().uuid(),
})

@Injectable()
export class PageFileTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly uploader: FileUploader,
  ) {}

  @Tool({
    name: "uploadFileToPage",
    description: "Upload a small file (<=1MB) to a page inline via base64",
    parameters: UploadInline,
  })
  async uploadFileToPage(
    args: z.infer<typeof UploadInline>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const buffer = Buffer.from(args.contentBase64, "base64")
    const fileId = await this.uploader.uploadInline({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: false,
    })
    return { fileId }
  }

  @Tool({
    name: "uploadImageToPage",
    description: "Upload a small image (<=1MB) to a page inline via base64",
    parameters: UploadInline,
  })
  async uploadImageToPage(
    args: z.infer<typeof UploadInline>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const buffer = Buffer.from(args.contentBase64, "base64")
    const fileId = await this.uploader.uploadInline({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: true,
    })
    return { fileId }
  }

  @Tool({
    name: "attachFileToPage",
    description: "Attach an existing workspace file to a page by id",
    parameters: Attach,
  })
  async attachFileToPage(
    args: z.infer<typeof Attach>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    await this.uploader.attach({
      ...args,
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      imageOnly: false,
    })
    return { ok: true as const }
  }

  @Tool({
    name: "attachImageToPage",
    description: "Attach an existing workspace image to a page by id",
    parameters: Attach,
  })
  async attachImageToPage(
    args: z.infer<typeof Attach>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    await this.uploader.attach({
      ...args,
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      imageOnly: true,
    })
    return { ok: true as const }
  }

  @Tool({
    name: "listPageFiles",
    description: "List files attached to a page",
    parameters: z.object({ pageId: z.string().uuid() }),
  })
  async listPageFiles(
    args: { pageId: string },
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== requestContext.workspaceId) {
      throw new PageNotFoundError(args.pageId)
    }
    const files = await this.prisma.pageFile.findMany({
      where: { pageId: args.pageId },
      select: {
        file: {
          select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
        },
      },
    })
    return {
      files: files.map((f) => ({
        id: f.file.id,
        name: f.file.name,
        mimeType: f.file.mimeType,
        size: Number(f.file.fileSize),
        createdAt: f.file.createdAt,
      })),
    }
  }
}
