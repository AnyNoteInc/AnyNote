import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { MarkdownParser } from '../services/markdown-parser.service.js'
import { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import { PageWriter } from '../services/page-writer.service.js'
import { StatsService } from '../services/stats.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

export const CreatePageInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: mcpNullableUuidOptional(),
  title: z.string().min(1).max(255),
  ownership: mcpInput(z.enum(['TEXT', 'SKILL', 'AGENT']).default('TEXT')),
  markdown: mcpInput(z.string().max(50_000).optional()),
})

const UpdatePageInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  title: mcpInput(z.string().max(255).optional()),
  icon: z.string().nullable().optional(),
  content: mcpInput(z.unknown().optional()),
})

const MovePageInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  newParentId: mcpNullableUuidOptional(),
  prevPageId: mcpNullableUuidOptional(),
})

const PageIdInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})

type CreatePageArgs = z.infer<typeof CreatePageInput>
type UpdatePageArgs = z.infer<typeof UpdatePageInput>
type MovePageArgs = z.infer<typeof MovePageInput>
type PageIdArgs = z.infer<typeof PageIdInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class PageTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly writer: PageWriter,
    private readonly renderer: MarkdownRenderer,
    private readonly parser: MarkdownParser,
    private readonly stats: StatsService,
  ) {}

  @Tool({
    name: 'createPage',
    description:
      'Создаёт новую страницу-заметку в рабочем пространстве. Вызывай ' +
      'когда пользователь просит "создай страницу", "добавь заметку", ' +
      '"заведи новую страницу про X". Опечатка "стараницу" обычно означает ' +
      '"страницу". Если это короткий follow-up после ответа ассистента ' +
      'в чате, создай страницу из последнего ответа ассистента. Если ' +
      'пользователь говорит ' +
      '"создай страницу из разговора / чата / диалога" или ' +
      '"сохрани обсуждение в страницу" — сначала суммаризируй историю ' +
      'беседы в структурированный Markdown (заголовок + основные ' +
      'шаги/факты списками) и передай его в параметре `markdown`. ' +
      'Если пользователь просит создать страницу с текстом/содержанием ' +
      'из текущей беседы (например, "создай страницу с текстом, который ' +
      'описан выше", "запиши это на страницу") — извлеки нужный ' +
      'текст из истории переписки и передай его в параметре `markdown`. ' +
      'ВАЖНО: всегда вызывай createPage ОДИН РАЗ, передавая ' +
      'параметры `title` и `markdown` вместе — не делай ' +
      'двух вызовов сначала с title, потом с markdown. ' +
      'Требует подтверждения пользователя через UI confirmation. ' +
      'Параметры: workspaceId (uuid, обязательный), title (string, обязательный), ownership ' +
      '(TEXT|SKILL|AGENT, по умолчанию TEXT — обычная заметка; ' +
      'SKILL — навык агента; AGENT — описание агента), parentId (uuid, ' +
      'опционально — id родительской страницы; по умолчанию страница ' +
      'создаётся в корне), markdown (string до 50 000 символов, ' +
      'опционально — содержимое страницы в Markdown).',
    parameters: CreatePageInput,
  })
  createPage(args: CreatePageArgs, _context: Context, req: AuthedRequest) {
    return this.doCreatePage(requireAuth(req), args)
  }

  async doCreatePage(auth: AuthContext, args: CreatePageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const content = args.markdown ? this.parser.parse(args.markdown) : undefined
    const pageId = await this.writer.createPage({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title: args.title,
      ownership: args.ownership,
      content,
    })
    return {
      pageId,
      url: `/workspaces/${args.workspaceId}/pages/${pageId}`,
    }
  }

  @Tool({
    name: 'updatePage',
    description:
      'Меняет существующую страницу: title, icon, content. Вызывай когда ' +
      'пользователь просит "переименуй страницу", "обнови заголовок", ' +
      '"измени содержимое страницы X". Требует подтверждения. Сначала ' +
      'прочитай страницу через getPageMarkdown — никогда не пиши ' +
      'содержимое вслепую.',
    parameters: UpdatePageInput,
  })
  updatePage(args: UpdatePageArgs, _context: Context, req: AuthedRequest) {
    return this.doUpdatePage(requireAuth(req), args)
  }

  async doUpdatePage(auth: AuthContext, args: UpdatePageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    await this.writer.updatePage({
      pageId: args.pageId,
      title: args.title,
      icon: args.icon,
      content: args.content,
      userId: auth.userId,
      workspaceId: args.workspaceId,
    })
    return { ok: true as const }
  }

  @Tool({
    name: 'movePage',
    description:
      'Перемещает страницу к новому родителю или меняет её порядок в ' +
      'списке. Вызывай когда пользователь просит "перенеси страницу", ' +
      '"переставь", "сделай дочерней для". Требует подтверждения.',
    parameters: MovePageInput,
  })
  movePage(args: MovePageArgs, _context: Context, req: AuthedRequest) {
    return this.doMovePage(requireAuth(req), args)
  }

  async doMovePage(auth: AuthContext, args: MovePageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    await this.writer.movePage({
      pageId: args.pageId,
      newParentId: args.newParentId,
      prevPageId: args.prevPageId,
      userId: auth.userId,
      workspaceId: args.workspaceId,
    })
    return { ok: true as const }
  }

  @Tool({
    name: 'getPageMarkdown',
    description:
      'Возвращает содержимое страницы целиком как Markdown. Вызывай ' +
      'когда нужно прочитать страницу — для пересказа, цитирования, ' +
      'поиска фактов или перед updatePage. Не модифицирует данные.',
    parameters: PageIdInput,
  })
  getPageMarkdown(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doGetPageMarkdown(requireAuth(req), args)
  }

  async doGetPageMarkdown(auth: AuthContext, args: PageIdArgs) {
    const [, page] = await Promise.all([
      assertMember(this.prisma, auth.userId, args.workspaceId),
      this.prisma.page.findUnique({
        where: { id: args.pageId },
        select: { workspaceId: true, content: true },
      }),
    ])
    if (page?.workspaceId !== args.workspaceId) {
      throw new PageNotFoundError(args.pageId)
    }
    return { markdown: this.renderer.render(page.content as never) }
  }

  @Tool({
    name: 'getPageStats',
    description:
      'Возвращает метаданные страницы: автор, дата создания, тип, ' +
      'ownership, иконка. Вызывай когда пользователь спрашивает "кто ' +
      'создал страницу", "когда сделали заметку", "какой тип у страницы X".',
    parameters: PageIdInput,
  })
  getPageStats(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doGetPageStats(requireAuth(req), args)
  }

  async doGetPageStats(auth: AuthContext, args: PageIdArgs) {
    const [, stats] = await Promise.all([
      assertMember(this.prisma, auth.userId, args.workspaceId),
      this.stats.getPageStats(args.pageId, args.workspaceId),
    ])
    return stats
  }
}
