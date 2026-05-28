/** Thin HTTP wrapper around apps/agents POST /v1/search. */
import type { EmbeddingPayload } from './embedding-config.service.js'

export interface AgentsSearchHit {
  pageId: string
  workspaceId: string
  blockNumber: number
  title: string
  content: string
}

export interface AgentsSearchClient {
  searchRag(args: {
    workspaceId: string
    query: string
    k: number
    embedding: EmbeddingPayload
    scoreThreshold?: number
  }): Promise<AgentsSearchHit[]>
}

export function createAgentsSearchClient(baseUrl: string): AgentsSearchClient {
  return {
    async searchRag({ workspaceId, query, k, embedding, scoreThreshold }) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 30_000)
      try {
        const res = await fetch(`${baseUrl}/v1/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            query,
            limit: k,
            embedding,
            scoreThreshold: scoreThreshold ?? 0.7,
          }),
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
