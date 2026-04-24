import { Injectable } from "@nestjs/common"

export type VectorizationPayload = {
  pageId: string
  workspaceId: string
  title: string
  pageType: string
  contents: Array<{ blockNumber: number; content: string }>
}

@Injectable()
export class AgentsClient {
  private readonly baseUrl: string
  private readonly timeoutMs = 30_000

  constructor() {
    this.baseUrl = process.env.AGENTS_SERVICE_URL ?? "http://localhost:8080"
  }

  async vectorize(payload: VectorizationPayload): Promise<void> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}/vectorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      })
      if (!res.ok) {
        throw new Error(`agents /vectorization ${res.status}: ${await res.text()}`)
      }
    } finally {
      clearTimeout(t)
    }
  }
}
