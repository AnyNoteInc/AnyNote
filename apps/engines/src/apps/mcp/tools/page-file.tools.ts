import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import { assertPageBindingAllows } from '../../api/auth/page-binding.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { FileUploader } from '../services/file-uploader.service.js'
import { mcpUuid } from '../utils/mcp-input.js'

const UploadInline = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  contentBase64: z.string().min(1),
})

const Attach = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  fileId: mcpUuid(),
})

const ListPageFilesInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})

type UploadInlineArgs = z.infer<typeof UploadInline>
type AttachArgs = z.infer<typeof Attach>
type ListPageFilesArgs = z.infer<typeof ListPageFilesInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class PageFileTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly uploader: FileUploader,
  ) {}

  @Tool({
    name: 'uploadFileToPage',
    description: 'Upload a small file (<=1MB) to a page inline via base64',
    parameters: UploadInline,
  })
  uploadFileToPage(args: UploadInlineArgs, _context: Context, req: AuthedRequest) {
    return this.doUploadFileToPage(requireAuth(req), args)
  }

  async doUploadFileToPage(auth: AuthContext, args: UploadInlineArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    const buffer = Buffer.from(args.contentBase64, 'base64')
    const fileId = await this.uploader.uploadInline({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: false,
    })
    return { fileId }
  }

  @Tool({
    name: 'uploadImageToPage',
    description: 'Upload a small image (<=1MB) to a page inline via base64',
    parameters: UploadInline,
  })
  uploadImageToPage(args: UploadInlineArgs, _context: Context, req: AuthedRequest) {
    return this.doUploadImageToPage(requireAuth(req), args)
  }

  async doUploadImageToPage(auth: AuthContext, args: UploadInlineArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    const buffer = Buffer.from(args.contentBase64, 'base64')
    const fileId = await this.uploader.uploadInline({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: true,
    })
    return { fileId }
  }

  @Tool({
    name: 'attachFileToPage',
    description: 'Attach an existing workspace file to a page by id',
    parameters: Attach,
  })
  attachFileToPage(args: AttachArgs, _context: Context, req: AuthedRequest) {
    return this.doAttachFileToPage(requireAuth(req), args)
  }

  async doAttachFileToPage(auth: AuthContext, args: AttachArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    await this.uploader.attach({
      pageId: args.pageId,
      fileId: args.fileId,
      userId: auth.userId,
      workspaceId: args.workspaceId,
      imageOnly: false,
    })
    return { ok: true as const }
  }

  @Tool({
    name: 'attachImageToPage',
    description: 'Attach an existing workspace image to a page by id',
    parameters: Attach,
  })
  attachImageToPage(args: AttachArgs, _context: Context, req: AuthedRequest) {
    return this.doAttachImageToPage(requireAuth(req), args)
  }

  async doAttachImageToPage(auth: AuthContext, args: AttachArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    await this.uploader.attach({
      pageId: args.pageId,
      fileId: args.fileId,
      userId: auth.userId,
      workspaceId: args.workspaceId,
      imageOnly: true,
    })
    return { ok: true as const }
  }

  @Tool({
    name: 'listPageFiles',
    description: 'List files attached to a page',
    parameters: ListPageFilesInput,
  })
  listPageFiles(args: ListPageFilesArgs, _context: Context, req: AuthedRequest) {
    return this.doListPageFiles(requireAuth(req), args)
  }

  async doListPageFiles(auth: AuthContext, args: ListPageFilesArgs) {
    const [, page, files] = await Promise.all([
      assertMember(this.prisma, auth.userId, args.workspaceId),
      this.prisma.page.findUnique({
        where: { id: args.pageId },
        select: { workspaceId: true },
      }),
      this.prisma.pageFile.findMany({
        where: { pageId: args.pageId },
        select: {
          file: {
            select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
          },
        },
      }),
    ])
    if (page?.workspaceId !== args.workspaceId) {
      throw new PageNotFoundError(args.pageId)
    }
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
