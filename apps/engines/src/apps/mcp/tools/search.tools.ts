import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import { EmbeddingConfigService } from '../services/embedding-config.service.js'
import { PageFtsService } from '../services/page-fts.service.js'

export const AGENTS_SEARCH_CLIENT = 'AGENTS_SEARCH_CLIENT'

export const SearchPagesInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).default(10),
})
export type SearchPagesArgs = z.infer<typeof SearchPagesInput>

export const SearchByTitleInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(10),
})
export type SearchByTitleArgs = z.infer<typeof SearchByTitleInput>

export type TitlePageHit = { id: string; title: string; type: string; icon: string | null }

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class SearchTools {
  constructor(
    @Inject(AGENTS_SEARCH_CLIENT) private readonly agentsClient: AgentsSearchClient,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly fts: PageFtsService,
    private readonly embeddingConfig: EmbeddingConfigService,
  ) {}

  @Tool({
    name: 'search_pages',
    description:
      'Поиск по страницам рабочего пространства: сначала полнотекстовый поиск по ' +
      'названию и тексту, затем семантический (RAG) поиск, если в воркспейсе ' +
      'настроена модель эмбеддингов. Возвращает объединённый список без дублей. ' +
      'Параметры: workspaceId (uuid), query (1-500), k (1-20, default 10).',
    parameters: SearchPagesInput,
  })
  async searchPages(args: SearchPagesArgs, _context: Context, req: AuthedRequest) {
    return this.doSearchPages(requireAuth(req), args)
  }

  async doSearchPages(auth: AuthContext, args: SearchPagesArgs): Promise<{ results: AgentsSearchHit[] }> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)

    const titleHits: AgentsSearchHit[] = (await this.fts.search(args.workspaceId, args.query)).map((h) => ({
      pageId: h.pageId,
      workspaceId: args.workspaceId,
      blockNumber: h.blockNumber ?? 0,
      title: h.title,
      content: h.excerpt ?? '',
    }))

    let ragHits: AgentsSearchHit[] = []
    const embedding = await this.embeddingConfig.forWorkspace(args.workspaceId)
    if (embedding) {
      try {
        ragHits = await this.agentsClient.searchRag({
          workspaceId: args.workspaceId,
          query: args.query,
          k: args.k,
          embedding,
        })
      } catch {
        ragHits = []
      }
    }

    const seen = new Set<string>()
    const results: AgentsSearchHit[] = []
    for (const hit of [...titleHits, ...ragHits]) {
      if (seen.has(hit.pageId)) continue
      seen.add(hit.pageId)
      results.push(hit)
      if (results.length >= args.k) break
    }
    return { results }
  }

  @Tool({
    name: 'searchPagesByTitle',
    description:
      'Поиск страниц по названию (и тексту) через полнотекстовый индекс Postgres. ' +
      'Используй для запросов вида "найди страницу с названием X", "на какой ' +
      'странице встречается Y". Возвращает несколько кандидатов: id, title, type, icon. ' +
      'Параметры: workspaceId (uuid), query (1-200), limit (1-20, default 10).',
    parameters: SearchByTitleInput,
  })
  async searchPagesByTitle(args: SearchByTitleArgs, _context: Context, req: AuthedRequest) {
    return this.doSearchPagesByTitle(requireAuth(req), args)
  }

  async doSearchPagesByTitle(auth: AuthContext, args: SearchByTitleArgs): Promise<{ pages: TitlePageHit[] }> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hits = await this.fts.search(args.workspaceId, args.query)
    return {
      pages: hits.slice(0, args.limit).map((h) => ({ id: h.pageId, title: h.title, type: h.type, icon: h.icon })),
    }
  }
}
