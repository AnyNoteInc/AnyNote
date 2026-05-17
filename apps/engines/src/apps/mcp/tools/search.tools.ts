import { Inject, Injectable } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import { getMcpRequestContext, type McpRequestWithContext } from '../utils/mcp-request-context.js'

export const AGENTS_SEARCH_CLIENT = 'AGENTS_SEARCH_CLIENT'

const SearchPagesInput = z.object({
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).default(10),
})

@Injectable()
export class SearchTools {
  constructor(
    @Inject(AGENTS_SEARCH_CLIENT)
    private readonly agentsClient: AgentsSearchClient,
  ) {}

  @Tool({
    name: 'search_pages',
    description:
      'Semantic RAG search across the current workspace. Returns matching block excerpts ' +
      'with pageId, blockNumber, title, and content.',
    parameters: SearchPagesInput,
  })
  async searchPages(
    args: z.infer<typeof SearchPagesInput>,
    _context: Context,
    req: McpRequestWithContext,
  ): Promise<{ results: AgentsSearchHit[] }> {
    const { workspaceId } = getMcpRequestContext(req)
    const results = await this.agentsClient.searchRag({
      workspaceId,
      query: args.query,
      k: args.k,
    })
    return { results }
  }
}
