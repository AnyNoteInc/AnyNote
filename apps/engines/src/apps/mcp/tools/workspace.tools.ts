import { Inject, Injectable } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { FileNotFoundError, PageNotFoundError } from '../errors/mcp.errors.js'
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard.js'
import { PageWriter } from '../services/page-writer.service.js'
import { StatsService } from '../services/stats.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'
import { getMcpRequestContext, type McpRequestWithContext } from '../utils/mcp-request-context.js'

const PaginationInput = z.object({
  limit: mcpInput(z.number().int().positive().max(200).default(50)),
  offset: mcpInput(z.number().int().nonnegative().default(0)),
})

const LimitInput = z.object({
  limit: mcpInput(z.number().int().positive().max(200).default(50)),
})

const CreatePageFromFileInput = z.object({
  parentId: mcpNullableUuidOptional(),
  fileId: mcpUuid(),
  title: z.string().min(1).max(255).optional(),
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
    name: 'getWorkspaceStats',
    description:
      'Возвращает счётчики и состав рабочего пространства: число страниц ' +
      'по типам (TEXT/KANBAN/EXCALIDRAW), общее число страниц и список ' +
      'участников. Вызывай когда пользователь спрашивает "сколько страниц", ' +
      '"сколько заметок", "кто в команде", "статистика воркспейса" или ' +
      'просит общий обзор. Без параметров.',
    parameters: z.object({}),
  })
  async getWorkspaceStats(
    _args: Record<string, never>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    return this.stats.getWorkspaceStats(requestContext.workspaceId)
  }

  @Tool({
    name: 'listWorkspaceFiles',
    description:
      'Возвращает список загруженных файлов рабочего пространства ' +
      '(имя, mime, размер, дата загрузки) с пагинацией. Вызывай когда ' +
      'пользователь просит показать вложения, файлы, аплоады, документы ' +
      'воркспейса. Поддерживает limit (1-100) и offset.',
    parameters: PaginationInput,
  })
  async listWorkspaceFiles(
    args: z.infer<typeof PaginationInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const files = await this.prisma.file.findMany({
      where: { workspaceId: requestContext.workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
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
    name: 'listSkills',
    description:
      'Возвращает страницы-навыки (ownership=SKILL) рабочего пространства. ' +
      'Вызывай когда пользователь спрашивает про доступные навыки, скиллы, ' +
      'промпт-страницы или просит показать "что умеет агент в этом ' +
      'воркспейсе". Параметр limit (1-100).',
    parameters: LimitInput,
  })
  async listSkills(
    args: z.infer<typeof LimitInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    return this.listOwnershipPages(requestContext.workspaceId, 'SKILL', args.limit)
  }

  @Tool({
    name: 'listAgents',
    description:
      'Возвращает страницы-агенты (ownership=AGENT) рабочего пространства. ' +
      'Вызывай когда пользователь спрашивает про доступных агентов, ' +
      'персонажей, ассистентов или просит "список агентов". Параметр ' +
      'limit (1-100).',
    parameters: LimitInput,
  })
  async listAgents(
    args: z.infer<typeof LimitInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    return this.listOwnershipPages(requestContext.workspaceId, 'AGENT', args.limit)
  }

  @Tool({
    name: 'createPageFromFile',
    description: 'Create a page and attach an existing workspace file to it',
    parameters: CreatePageFromFileInput,
  })
  async createPageFromFile(
    args: z.infer<typeof CreatePageFromFileInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const file = await this.prisma.file.findUnique({
      where: { id: args.fileId },
      select: { id: true, workspaceId: true, name: true },
    })
    if (!file || file.workspaceId !== requestContext.workspaceId) {
      throw new FileNotFoundError(args.fileId)
    }
    if (args.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: args.parentId },
        select: { workspaceId: true, deletedAt: true },
      })
      if (!parent || parent.workspaceId !== requestContext.workspaceId || parent.deletedAt) {
        throw new PageNotFoundError(args.parentId)
      }
    }
    const title = args.title ?? file.name
    const pageId = await this.writer.createPage({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      parentId: args.parentId,
      title,
      ownership: 'TEXT',
    })
    await this.prisma.pageFile.create({ data: { pageId, fileId: args.fileId } })
    return { pageId }
  }

  private async listOwnershipPages(
    workspaceId: string,
    ownership: 'SKILL' | 'AGENT',
    limit: number,
  ) {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId, ownership, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
    return { pages }
  }
}
