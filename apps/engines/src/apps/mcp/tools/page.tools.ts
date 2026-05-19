import { Inject, Injectable } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { WorkspaceMemberGuard } from '../guards/workspace-member.guard.js'
import { MarkdownParser } from '../services/markdown-parser.service.js'
import { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import { PageWriter } from '../services/page-writer.service.js'
import { StatsService } from '../services/stats.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'
import { getMcpRequestContext, type McpRequestWithContext } from '../utils/mcp-request-context.js'

export const CreatePageInput = z.object({
  parentId: mcpNullableUuidOptional(),
  title: z.string().min(1).max(255),
  ownership: mcpInput(z.enum(['TEXT', 'SKILL', 'AGENT']).default('TEXT')),
  markdown: mcpInput(z.string().max(50_000).optional()),
})

const UpdatePageInput = z.object({
  pageId: mcpUuid(),
  title: mcpInput(z.string().max(255).optional()),
  icon: z.string().nullable().optional(),
  content: mcpInput(z.unknown().optional()),
})

const MovePageInput = z.object({
  pageId: mcpUuid(),
  newParentId: mcpNullableUuidOptional(),
  prevPageId: mcpNullableUuidOptional(),
})

const PageIdInput = z.object({ pageId: mcpUuid() })

@Injectable()
export class PageTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
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
      'Параметры: title (string, обязательный), ownership ' +
      '(TEXT|SKILL|AGENT, по умолчанию TEXT — обычная заметка; ' +
      'SKILL — навык агента; AGENT — описание агента), parentId (uuid, ' +
      'опционально — id родительской страницы; по умолчанию страница ' +
      'создаётся в корне), markdown (string до 50 000 символов, ' +
      'опционально — содержимое страницы в Markdown).',
    parameters: CreatePageInput,
  })
  async createPage(
    args: z.infer<typeof CreatePageInput>,
    _context: Context,
    req: McpRequestWithContext,
  ) {
    const requestContext = getMcpRequestContext(req)
    await this.guard.assert(requestContext.workspaceId, requestContext.userId)
    const content = args.markdown ? this.parser.parse(args.markdown) : undefined
    const pageId = await this.writer.createPage({
      userId: requestContext.userId,
      workspaceId: requestContext.workspaceId,
      parentId: args.parentId,
      title: args.title,
      ownership: args.ownership,
      content,
    })
    return {
      pageId,
      url: `/workspaces/${requestContext.workspaceId}/pages/${pageId}`,
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
    name: 'movePage',
    description:
      'Перемещает страницу к новому родителю или меняет её порядок в ' +
      'списке. Вызывай когда пользователь просит "перенеси страницу", ' +
      '"переставь", "сделай дочерней для". Требует подтверждения.',
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
    name: 'getPageMarkdown',
    description:
      'Возвращает содержимое страницы целиком как Markdown. Вызывай ' +
      'когда нужно прочитать страницу — для пересказа, цитирования, ' +
      'поиска фактов или перед updatePage. Не модифицирует данные.',
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
    name: 'getPageStats',
    description:
      'Возвращает метаданные страницы: автор, дата создания, тип, ' +
      'ownership, иконка. Вызывай когда пользователь спрашивает "кто ' +
      'создал страницу", "когда сделали заметку", "какой тип у страницы X".',
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
