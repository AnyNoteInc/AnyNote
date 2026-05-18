/**
 * Thin HTTP wrapper around apps/agents POST /v1/search.
 *
 * NOTE: the agents search endpoint requires an `embedding` provider config
 * (provider, model_slug, vector_size, connection) that is workspace-specific.
 * Until workspace AI settings are threaded through the MCP request context this
 * client cannot forward them — the caller must supply them via `embeddingConfig`
 * or the endpoint must be extended to read them from workspace settings.
 * TODO: wire embeddingConfig from workspace AI settings (WorkspaceAiSettings).
 */

export interface AgentsSearchHit {
  pageId: string
  workspaceId: string
  blockNumber: number
  title: string
  content: string
}

export interface AgentsSearchClient {
  searchRag(args: { workspaceId: string; query: string; k: number }): Promise<AgentsSearchHit[]>
}

export function createAgentsSearchClient(baseUrl: string): AgentsSearchClient {
  return {
    async searchRag({ workspaceId, query, k }) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 30_000)
      try {
        const res = await fetch(`${baseUrl}/v1/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, query, limit: k }),
          signal: ctl.signal,
        })
        if (!res.ok) {
          throw new Error(`agents search ${res.status}: ${await res.text()}`)
        }
        const data = (await res.json()) as {
          results: Array<{
            page_id: string
            workspace_id: string
            block_number: number
            title: string
            content: string
          }>
        }
        return data.results.map((r) => ({
          pageId: r.page_id,
          workspaceId: r.workspace_id,
          blockNumber: r.block_number,
          title: r.title,
          content: r.content,
        }))
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
