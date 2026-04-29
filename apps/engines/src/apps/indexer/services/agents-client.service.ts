import { Injectable } from '@nestjs/common'
import type { AiProviderConnection } from '@repo/db'

export type EmbeddingPayload = {
  provider: 'ollama' | 'openai' | 'gigachat'
  modelSlug: string
  vectorSize: number
  connection: AiProviderConnection
}

export type VectorizationPayload = {
  pageId: string
  workspaceId: string
  title: string
  pageType: string
  contents: Array<{ blockNumber: number; content: string }>
  embedding: EmbeddingPayload
}

@Injectable()
export class AgentsClient {
  private readonly baseUrl: string
  private readonly timeoutMs = 30_000

  constructor() {
    this.baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  }

  async vectorize(payload: VectorizationPayload): Promise<void> {
    await this.request('POST', '/vectorization', payload)
  }

  async deletePageVectors(pageId: string): Promise<void> {
    await this.request('DELETE', `/vectorization/pages/${pageId}`)
  }

  async deleteWorkspaceVectors(workspaceId: string): Promise<void> {
    await this.request('DELETE', `/vectorization/workspaces/${workspaceId}`)
  }

  private async request(method: string, path: string, body?: unknown): Promise<void> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
      if (!res.ok) {
        throw new Error(`agents ${method} ${path} ${res.status}: ${await res.text()}`)
      }
    } finally {
      clearTimeout(t)
    }
  }
}
