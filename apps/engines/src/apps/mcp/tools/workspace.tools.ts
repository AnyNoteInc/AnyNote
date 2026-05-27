import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { FileNotFoundError, PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from '../services/page-writer.service.js'
import { StatsService } from '../services/stats.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const GetWorkspaceStatsInput = z.object({
  workspaceId: z.string().uuid(),
})

const PaginationInput = z.object({
  workspaceId: z.string().uuid(),
  limit: mcpInput(z.number().int().positive().max(200).default(50)),
  offset: mcpInput(z.number().int().nonnegative().default(0)),
})

const LimitInput = z.object({
  workspaceId: z.string().uuid(),
  limit: mcpInput(z.number().int().positive().max(200).default(50)),
})

const CreatePageFromFileInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: mcpNullableUuidOptional(),
  fileId: mcpUuid(),
  title: z.string().min(1).max(255).optional(),
})

type GetWorkspaceStatsArgs = z.infer<typeof GetWorkspaceStatsInput>
type PaginationArgs = z.infer<typeof PaginationInput>
type LimitArgs = z.infer<typeof LimitInput>
type CreatePageFromFileArgs = z.infer<typeof CreatePageFromFileInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class WorkspaceTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
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
      'просит общий обзор. Параметр: workspaceId (uuid, обязательный).',
    parameters: GetWorkspaceStatsInput,
  })
  getWorkspaceStats(args: GetWorkspaceStatsArgs, _context: Context, req: AuthedRequest) {
    return this.doGetWorkspaceStats(requireAuth(req), args)
  }

  async doGetWorkspaceStats(auth: AuthContext, args: GetWorkspaceStatsArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.stats.getWorkspaceStats(args.workspaceId)
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
  listWorkspaceFiles(args: PaginationArgs, _context: Context, req: AuthedRequest) {
    return this.doListWorkspaceFiles(requireAuth(req), args)
  }

  async doListWorkspaceFiles(auth: AuthContext, args: PaginationArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const files = await this.prisma.file.findMany({
      where: { workspaceId: args.workspaceId, status: 'ACTIVE' },
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
      'воркспейсе". Параметры: workspaceId (uuid, обязательный), limit (1-100).',
    parameters: LimitInput,
  })
  listSkills(args: LimitArgs, _context: Context, req: AuthedRequest) {
    return this.doListSkills(requireAuth(req), args)
  }

  async doListSkills(auth: AuthContext, args: LimitArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.listOwnershipPages(args.workspaceId, 'SKILL', args.limit)
  }

  @Tool({
    name: 'listAgents',
    description:
      'Возвращает страницы-агенты (ownership=AGENT) рабочего пространства. ' +
      'Вызывай когда пользователь спрашивает про доступных агентов, ' +
      'персонажей, ассистентов или просит "список агентов". Параметры: ' +
      'workspaceId (uuid, обязательный), limit (1-100).',
    parameters: LimitInput,
  })
  listAgents(args: LimitArgs, _context: Context, req: AuthedRequest) {
    return this.doListAgents(requireAuth(req), args)
  }

  async doListAgents(auth: AuthContext, args: LimitArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.listOwnershipPages(args.workspaceId, 'AGENT', args.limit)
  }

  @Tool({
    name: 'createPageFromFile',
    description: 'Create a page and attach an existing workspace file to it',
    parameters: CreatePageFromFileInput,
  })
  createPageFromFile(args: CreatePageFromFileArgs, _context: Context, req: AuthedRequest) {
    return this.doCreatePageFromFile(requireAuth(req), args)
  }

  async doCreatePageFromFile(auth: AuthContext, args: CreatePageFromFileArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const file = await this.prisma.file.findUnique({
      where: { id: args.fileId },
      select: { id: true, workspaceId: true, name: true },
    })
    if (file?.workspaceId !== args.workspaceId) {
      throw new FileNotFoundError(args.fileId)
    }
    if (args.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: args.parentId },
        select: { workspaceId: true, deletedAt: true },
      })
      if (parent?.workspaceId !== args.workspaceId || parent?.deletedAt) {
        throw new PageNotFoundError(args.parentId)
      }
    }
    const title = args.title ?? file.name
    const pageId = await this.writer.createPage({
      userId: auth.userId,
      workspaceId: args.workspaceId,
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
