import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { extractTextFromFile, MAX_INLINE_FILE_BYTES, type StorageClient } from '@repo/storage'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { FileNotFoundError } from '../errors/mcp.errors.js'
import { STORAGE } from '../services/file-uploader.service.js'
import { mcpInput, mcpUuid } from '../utils/mcp-input.js'

const ListFilesInput = z.object({
  workspaceId: z.string().uuid(),
  limit: mcpInput(z.number().int().positive().max(100).default(20)),
  offset: mcpInput(z.number().int().nonnegative().default(0)),
})

const SearchFilesInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(200),
  limit: mcpInput(z.number().int().positive().max(100).default(20)),
})

const FileIdInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: mcpUuid(),
})

const GetFileContentInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: mcpUuid(),
  maxBytes: mcpInput(z.number().int().positive().max(MAX_INLINE_FILE_BYTES).default(MAX_INLINE_FILE_BYTES)),
})

const DeleteFileInput = z.object({
  workspaceId: z.string().uuid(),
  fileId: mcpUuid(),
  confirm: mcpInput(z.boolean().default(false)),
})

type ListFilesArgs = z.infer<typeof ListFilesInput>
type SearchFilesArgs = z.infer<typeof SearchFilesInput>
type FileIdArgs = z.infer<typeof FileIdInput>
type GetFileContentArgs = z.infer<typeof GetFileContentInput>
type DeleteFileArgs = z.infer<typeof DeleteFileInput>

type FileSummary = {
  id: string
  name: string
  mimeType: string
  fileSize: bigint
  createdAt: Date
}

const FILE_SELECT = {
  id: true,
  name: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
} as const

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

function toFilePayload(file: FileSummary) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    fileSize: file.fileSize.toString(),
    createdAt: file.createdAt,
  }
}

async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

@Injectable()
export class FileTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageClient,
  ) {}

  @Tool({
    name: 'list_files',
    description:
      'Возвращает список файлов рабочего пространства (id, имя, mime, размер, ' +
      'дата) с пагинацией. Вызывай когда пользователь просит показать файлы, ' +
      'вложения, аплоады, документы воркспейса. Параметры: workspaceId (uuid), ' +
      'limit (1-100, по умолчанию 20), offset (по умолчанию 0). Не модифицирует данные.',
    parameters: ListFilesInput,
  })
  listFiles(args: ListFilesArgs, _context: Context, req: AuthedRequest) {
    return this.doListFiles(requireAuth(req), args)
  }

  async doListFiles(auth: AuthContext, args: ListFilesArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const files = (await this.prisma.file.findMany({
      where: { workspaceId: args.workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      skip: args.offset,
      select: FILE_SELECT,
    })) as FileSummary[]
    return { files: files.map(toFilePayload) }
  }

  @Tool({
    name: 'search_files',
    description:
      'Ищет файлы рабочего пространства по части имени (без учёта регистра). ' +
      'Вызывай когда пользователь просит "найди файл", "где документ X", ' +
      '"покажи файлы про Y". Параметры: workspaceId (uuid), query (строка ' +
      'поиска по имени), limit (1-100, по умолчанию 20). Не модифицирует данные.',
    parameters: SearchFilesInput,
  })
  searchFiles(args: SearchFilesArgs, _context: Context, req: AuthedRequest) {
    return this.doSearchFiles(requireAuth(req), args)
  }

  async doSearchFiles(auth: AuthContext, args: SearchFilesArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const files = (await this.prisma.file.findMany({
      where: {
        workspaceId: args.workspaceId,
        status: 'ACTIVE',
        name: { contains: args.query, mode: 'insensitive' },
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: FILE_SELECT,
    })) as FileSummary[]
    return { files: files.map(toFilePayload) }
  }

  @Tool({
    name: 'get_file_download_link',
    description:
      'Возвращает ссылку для скачивания файла рабочего пространства и ' +
      'увеличивает счётчик загрузок. Вызывай когда пользователь просит ' +
      '"дай ссылку на файл", "скачать документ", "ссылку для загрузки". ' +
      'Параметры: workspaceId (uuid), fileId (uuid).',
    parameters: FileIdInput,
  })
  getFileDownloadLink(args: FileIdArgs, _context: Context, req: AuthedRequest) {
    return this.doGetFileDownloadLink(requireAuth(req), args)
  }

  async doGetFileDownloadLink(auth: AuthContext, args: FileIdArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const file = await this.prisma.file.findFirst({
      where: { id: args.fileId, workspaceId: args.workspaceId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!file) throw new FileNotFoundError(args.fileId)
    await this.prisma.file.update({
      where: { id: file.id },
      data: { downloadCount: { increment: 1 } },
    })
    return { url: `/api/files/${file.id}` }
  }

  @Tool({
    name: 'get_file_content',
    description:
      'Читает содержимое файла рабочего пространства как текст (поддержка ' +
      'текстовых форматов, PDF, DOCX). Вызывай когда нужно прочитать файл — ' +
      'для пересказа, цитирования или поиска фактов. Параметры: workspaceId ' +
      '(uuid), fileId (uuid), maxBytes (опционально — лимит извлечённого ' +
      'текста). Не модифицирует данные.',
    parameters: GetFileContentInput,
  })
  getFileContent(args: GetFileContentArgs, _context: Context, req: AuthedRequest) {
    return this.doGetFileContent(requireAuth(req), args)
  }

  async doGetFileContent(auth: AuthContext, args: GetFileContentArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const file = await this.prisma.file.findFirst({
      where: { id: args.fileId, workspaceId: args.workspaceId, status: 'ACTIVE' },
      select: { id: true, mimeType: true, ext: true, path: true },
    })
    if (!file) throw new FileNotFoundError(args.fileId)
    const bytes = await streamToBuffer(await this.storage.get(file.path))
    const content = await extractTextFromFile(bytes, file.mimeType, file.ext, args.maxBytes)
    return { content }
  }

  @Tool({
    name: 'delete_file',
    description:
      'Безвозвратно удаляет файл рабочего пространства из хранилища и базы. ' +
      'Вызывай когда пользователь просит "удали файл", "убери документ". ' +
      'Требует подтверждения (confirm=true) и UI confirmation. Параметры: ' +
      'workspaceId (uuid), fileId (uuid), confirm (boolean).',
    parameters: DeleteFileInput,
  })
  deleteFile(args: DeleteFileArgs, _context: Context, req: AuthedRequest) {
    return this.doDeleteFile(requireAuth(req), args)
  }

  async doDeleteFile(auth: AuthContext, args: DeleteFileArgs) {
    if (!args.confirm) {
      throw new BadRequestException('delete_file requires confirm=true')
    }
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const file = await this.prisma.file.findFirst({
      where: { id: args.fileId, workspaceId: args.workspaceId },
      select: { id: true, path: true },
    })
    if (!file) throw new FileNotFoundError(args.fileId)
    await this.storage.delete(file.path)
    await this.prisma.file.delete({ where: { id: file.id } })
    return { deleted: true as const, fileId: file.id }
  }
}
