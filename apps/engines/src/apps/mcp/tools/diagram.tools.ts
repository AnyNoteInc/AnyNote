import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import { assertNotPageBound, assertPageBindingAllows } from '../../api/auth/page-binding.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { DiagramValidatorService, type DiagramKind } from '../services/diagram-validator.service.js'
import { PageWriter } from '../services/page-writer.service.js'
import { mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const CreateDiagramPageInput = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(['MERMAID', 'PLANTUML', 'LIKEC4']),
  source: z.string().min(1).max(100_000),
  title: z.string().min(1).max(255),
  parentId: mcpNullableUuidOptional(),
})
const UpdateDiagramSourceInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  source: z.string().min(1).max(100_000),
})

type CreateDiagramPageArgs = z.infer<typeof CreateDiagramPageInput>
type UpdateDiagramSourceArgs = z.infer<typeof UpdateDiagramSourceInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class DiagramTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly writer: PageWriter,
    private readonly validator: DiagramValidatorService,
  ) {}

  @Tool({
    name: 'createDiagramPage',
    description:
      'Создаёт страницу с диаграммой выбранного типа (MERMAID, PLANTUML, LIKEC4) из ' +
      'исходного кода. Сначала валидирует синтаксис; при ошибке вернёт сообщение для ' +
      'исправления и НЕ создаст страницу. Требует подтверждения. Параметры: ' +
      'workspaceId, kind, source (код диаграммы), title, parentId (опц.).',
    parameters: CreateDiagramPageInput,
  })
  createDiagramPage(args: CreateDiagramPageArgs, _context: Context, req: AuthedRequest) {
    return this.doCreateDiagramPage(requireAuth(req), args)
  }

  async doCreateDiagramPage(auth: AuthContext, args: CreateDiagramPageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertNotPageBound(auth, 'создание новых страниц')
    this.validator.validate(args.kind, args.source)
    const pageId = await this.writer.createDiagramPage({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title: args.title,
      kind: args.kind,
      source: args.source,
    })
    return { pageId, url: `/workspaces/${args.workspaceId}/pages/${pageId}` }
  }

  @Tool({
    name: 'updateDiagramSource',
    description:
      'Перезаписывает исходный код существующей диаграммной страницы (после валидации). ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, source.',
    parameters: UpdateDiagramSourceInput,
  })
  updateDiagramSource(args: UpdateDiagramSourceArgs, _context: Context, req: AuthedRequest) {
    return this.doUpdateDiagramSource(requireAuth(req), args)
  }

  async doUpdateDiagramSource(auth: AuthContext, args: UpdateDiagramSourceArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    assertPageBindingAllows(auth, args.pageId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true, type: true },
    })
    if (!page || page.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.pageId)
    this.validator.validate(page.type as DiagramKind, args.source)
    await this.writer.updateDiagramSource({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      source: args.source,
    })
    return { ok: true as const }
  }
}
