import { createHash } from 'node:crypto'
import { extname } from 'node:path'

import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import { storage as defaultStorage, type StorageClient } from '@repo/storage'

import { PRISMA } from '../../../infra/db/db.providers.js'
import {
  FileNotFoundError,
  FileTooLargeError,
  PageNotFoundError,
  UnsupportedMimeTypeError,
  WorkspaceStorageLimitError,
} from '../errors/mcp.errors.js'

export const STORAGE = Symbol('STORAGE_CLIENT')

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

export type UploadInlineInput = {
  userId: string
  workspaceId: string
  pageId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  imageOnly: boolean
}

export type AttachInput = {
  userId: string
  workspaceId: string
  pageId: string
  fileId: string
  imageOnly: boolean
}

export type UploadGeneratedInput = Omit<UploadInlineInput, 'imageOnly'>

/** Cap for server-GENERATED artifacts (PDF export) — mirrors apps/web's
 *  ATTACHMENT_MAX_BYTES (50MB), NOT the 1MB inline-base64 limit: the bytes
 *  never ride an LLM tool-call payload. */
const GENERATED_MAX_BYTES = 52_428_800

@Injectable()
export class FileUploader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageClient = defaultStorage,
  ) {}

  async uploadInline(input: UploadInlineInput): Promise<string> {
    const limit = Number(process.env.UPLOAD_INLINE_MAX_BYTES ?? 1_048_576)
    if (input.buffer.length > limit) {
      throw new FileTooLargeError(input.buffer.length, limit)
    }
    if (input.imageOnly && !IMAGE_MIME_TYPES.includes(input.mimeType)) {
      throw new UnsupportedMimeTypeError(input.mimeType)
    }
    return this.persistFileOnPage(input)
  }

  /** Persist a server-generated artifact (e.g. an exported PDF) as a page
   *  attachment — same File+PageFile transaction as uploadInline, without the
   *  inline-base64 size cap and MIME allow-list. */
  async uploadGenerated(input: UploadGeneratedInput): Promise<string> {
    if (input.buffer.length > GENERATED_MAX_BYTES) {
      throw new FileTooLargeError(input.buffer.length, GENERATED_MAX_BYTES)
    }
    return this.persistFileOnPage(input)
  }

  private persistFileOnPage(input: UploadGeneratedInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const workspaces = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM workspaces
        WHERE id = ${input.workspaceId}::uuid
        FOR UPDATE
      `
      if (workspaces.length !== 1) throw new PageNotFoundError(input.pageId)
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }

      // Plan storage quota — mirrors /api/files/upload (the web route sums
      // ACTIVE file sizes against WorkspaceLimit.maxFileBytes and 413s):
      // MCP-created files count toward the same quota and must not bypass it.
      const usage = await tx.file.aggregate({
        where: {
          workspaceId: input.workspaceId,
          OR: [{ status: 'ACTIVE' }, { status: 'PENDING', expiresAt: { gt: new Date() } }],
        },
        _sum: { fileSize: true },
      })
      const limits = await tx.workspaceLimit.findUnique({
        where: { workspaceId: input.workspaceId },
      })
      const used = usage._sum.fileSize ?? 0n
      if (limits && used + BigInt(input.buffer.length) > limits.maxFileBytes) {
        throw new WorkspaceStorageLimitError(limits.maxFileBytes)
      }

      const hash = createHash('sha256').update(input.buffer).digest('hex')
      const ext = (extname(input.fileName).replace(/^\./, '') || 'bin').slice(0, 16)

      const file = await tx.file.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          name: input.fileName,
          ext,
          fileSize: BigInt(input.buffer.length),
          mimeType: input.mimeType,
          hash,
          path: 'pending',
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      const key = `workspaces/${input.workspaceId}/files/${file.id}.${ext}`
      await this.storage.put(key, input.buffer, {
        contentType: input.mimeType,
        size: input.buffer.length,
      })
      await tx.file.update({ where: { id: file.id }, data: { path: key } })

      await tx.pageFile.create({ data: { pageId: input.pageId, fileId: file.id } })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })

      return file.id
    })
  }

  async attach(input: AttachInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      const file = await tx.file.findUnique({
        where: { id: input.fileId },
        select: { id: true, workspaceId: true, mimeType: true },
      })
      if (!file || file.workspaceId !== input.workspaceId) {
        throw new FileNotFoundError(input.fileId)
      }
      if (input.imageOnly && !IMAGE_MIME_TYPES.includes(file.mimeType)) {
        throw new UnsupportedMimeTypeError(file.mimeType)
      }
      await tx.pageFile.create({ data: { pageId: input.pageId, fileId: input.fileId } })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }
}
