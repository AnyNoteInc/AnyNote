import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { excludeDatabaseRowPages, pageVisibilityWhere } from '../page-visibility.js'
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
  markdown: mcpInput(z.string().max(50_000).optional()),
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

const ListPagesInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: mcpNullableUuidOptional(),
  type: mcpInput(
    z
      .enum(['TEXT', 'EXCALIDRAW', 'GENOGRAM', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO', 'DATABASE', 'KANBAN', 'FORM'])
      .optional(),
  ),
  query: mcpInput(z.string().max(200).optional()),
  limit: mcpInput(z.number().int().positive().max(500).default(200)),
})

const AppendToPageInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  markdown: z.string().min(1).max(50_000),
})

type CreatePageArgs = z.infer<typeof CreatePageInput>
type UpdatePageArgs = z.infer<typeof UpdatePageInput>
type MovePageArgs = z.infer<typeof MovePageInput>
type PageIdArgs = z.infer<typeof PageIdInput>
type ListPagesArgs = z.infer<typeof ListPagesInput>
type AppendToPageArgs = z.infer<typeof AppendToPageInput>

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
      'Меняет существующую страницу: title, icon, содержимое. Вызывай когда ' +
      'пользователь просит "переименуй страницу", "обнови заголовок", ' +
      '"измени/перезапиши содержимое страницы X", "запиши этот текст на ' +
      'страницу". Требует подтверждения. Сначала прочитай страницу через ' +
      'getPageMarkdown — никогда не пиши содержимое вслепую. ' +
      'ВАЖНО: чтобы записать текст/содержимое, ПЕРЕДАВАЙ его в параметре ' +
      '`markdown` (обычная строка Markdown до 50 000 символов) — он ' +
      'разбирается в формат страницы. Не передавай сырой текст в `content`. ' +
      'Параметры: workspaceId, pageId, title?, icon?, markdown? (Markdown-' +
      'строка нового содержимого).',
    parameters: UpdatePageInput,
  })
  updatePage(args: UpdatePageArgs, _context: Context, req: AuthedRequest) {
    return this.doUpdatePage(requireAuth(req), args)
  }

  async doUpdatePage(auth: AuthContext, args: UpdatePageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    // Prefer markdown: the agent passes a Markdown string, which we parse into a
    // Tiptap doc so PageWriter can rebuild contentYjs and the editor renders it
    // (a raw string/markdown left in `content` shows as an empty page). Fall back
    // to a pre-built `content` doc when no markdown is supplied.
    const content = typeof args.markdown === 'string' ? this.parser.parse(args.markdown) : args.content
    await this.writer.updatePage({
      pageId: args.pageId,
      title: args.title,
      icon: args.icon,
      content,
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
    // findFirst (not findUnique) so the visibility predicate — a relational OR over
    // collection/share — can be applied; a private page owned by another user must
    // read as not-found for the requesting user.
    const [, page] = await Promise.all([
      assertMember(this.prisma, auth.userId, args.workspaceId),
      this.prisma.page.findFirst({
        where: {
          id: args.pageId,
          workspaceId: args.workspaceId,
          AND: [pageVisibilityWhere(auth.userId)],
        },
        select: { content: true },
      }),
    ])
    if (!page) {
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
      this.stats.getPageStats(args.pageId, args.workspaceId, auth.userId),
    ])
    return stats
  }

  @Tool({
    name: 'archivePage',
    description:
      'Архивирует страницу (убирает из дерева и поиска). Требует подтверждения. Параметры: workspaceId, pageId.',
    parameters: PageIdInput,
  })
  archivePage(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doSetArchived(requireAuth(req), args, true)
  }

  @Tool({
    name: 'restorePage',
    description:
      'Восстанавливает архивированную страницу. Требует подтверждения. Параметры: workspaceId, pageId.',
    parameters: PageIdInput,
  })
  restorePage(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doSetArchived(requireAuth(req), args, false)
  }

  async doSetArchived(auth: AuthContext, args: PageIdArgs, archived: boolean) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    await this.writer.setArchived({ userId: auth.userId, workspaceId: args.workspaceId, pageId: args.pageId, archived })
    return { ok: true as const }
  }

  @Tool({
    name: 'appendToPage',
    description:
      'Дописывает Markdown в КОНЕЦ существующей TEXT-страницы (не перезаписывает). ' +
      'Используй для мелких правок/дополнений ("добавь раздел", "допиши итоги"). ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, markdown (1-50000).',
    parameters: AppendToPageInput,
  })
  appendToPage(args: AppendToPageArgs, _context: Context, req: AuthedRequest) {
    return this.doAppendToPage(requireAuth(req), args)
  }

  async doAppendToPage(auth: AuthContext, args: AppendToPageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const appended = this.parser.parse(args.markdown)
    await this.writer.appendContent({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      appended,
    })
    return { ok: true as const }
  }

  @Tool({
    name: 'listPages',
    description:
      'Список страниц рабочего пространства (дерево). Используй чтобы осмотреть ' +
      'структуру и предложить родителя для новой страницы, или найти страницу по ' +
      'части названия. parentId: null — только корневые, uuid — дети узла, опустить — все. ' +
      'Возвращает id, title, type, icon, parentId. Параметры: workspaceId, parentId?, ' +
      'type?, query?, limit (def 200).',
    parameters: ListPagesInput,
  })
  listPages(args: ListPagesArgs, _context: Context, req: AuthedRequest) {
    return this.doListPages(requireAuth(req), args)
  }

  async doListPages(auth: AuthContext, args: ListPagesArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const pages = await this.prisma.page.findMany({
      where: {
        workspaceId: args.workspaceId,
        archivedAt: null,
        deletedAt: null,
        AND: [pageVisibilityWhere(auth.userId), excludeDatabaseRowPages()],
        ...(args.parentId === undefined ? {} : { parentId: args.parentId }),
        ...(args.type ? { type: args.type } : {}),
        ...(args.query ? { title: { contains: args.query, mode: 'insensitive' } } : {}),
      },
      select: { id: true, title: true, type: true, icon: true, parentId: true },
      orderBy: { createdAt: 'asc' },
      take: args.limit,
    })
    return { pages }
  }
}
