import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'

export const AGENTS_SEARCH_CLIENT = 'AGENTS_SEARCH_CLIENT'

export const SearchPagesInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).default(10),
})
export type SearchPagesArgs = z.infer<typeof SearchPagesInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class SearchTools {
  constructor(
    @Inject(AGENTS_SEARCH_CLIENT)
    private readonly agentsClient: AgentsSearchClient,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Tool({
    name: 'search_pages',
    description:
      'Семантический поиск по страницам рабочего пространства через embeddings. ' +
      'Параметры: workspaceId (uuid, обязательный), query (1-500 символов), k (1-20, default 10).',
    parameters: SearchPagesInput,
  })
  async searchPages(
    args: SearchPagesArgs,
    _context: Context,
    req: AuthedRequest,
  ): Promise<{ results: AgentsSearchHit[] }> {
    return this.doSearchPages(requireAuth(req), args)
  }

  async doSearchPages(
    auth: AuthContext,
    args: SearchPagesArgs,
  ): Promise<{ results: AgentsSearchHit[] }> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const results = await this.agentsClient.searchRag({
      workspaceId: args.workspaceId,
      query: args.query,
      k: args.k,
    })
    return { results }
  }
}
