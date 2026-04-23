import { Injectable } from "@nestjs/common"

import { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import { EmbeddingClient } from "../../indexer/services/embedding-client.service.js"

export type RagSearchDocument = {
  id: string
  title: string
  content: string
  score: number
  updatedAt: string
  pageType: string
}

export type SearchArgs = {
  workspaceId: string
  query: string
  topK?: number
  scoreThreshold?: number
}

type QdrantHit = {
  id: string | number
  score: number
  payload?: Record<string, unknown> | null
}

const DEFAULT_TOP_K = 5
const DEFAULT_SCORE_THRESHOLD = 0.35
const SEARCH_LIMIT_MULTIPLIER = 3

@Injectable()
export class PageSearchService {
  constructor(
    private readonly embedding: EmbeddingClient,
    private readonly qdrant: QdrantService,
  ) {}

  async search(args: SearchArgs): Promise<{ documents: RagSearchDocument[] }> {
    const topK = args.topK ?? DEFAULT_TOP_K
    const scoreThreshold = args.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
    const vector = await this.embedding.embed(args.query)

    const hits = (await this.qdrant.client.search(this.qdrant.collection, {
      vector,
      filter: { must: [{ key: "workspaceId", match: { value: args.workspaceId } }] },
      limit: topK * SEARCH_LIMIT_MULTIPLIER,
      score_threshold: scoreThreshold,
      with_payload: true,
    })) as QdrantHit[]

    const bestPerPage = new Map<string, RagSearchDocument>()
    for (const hit of hits) {
      const payload = (hit.payload ?? {}) as {
        pageId?: string
        title?: string
        content?: string
        pageType?: string
        updatedAt?: string
      }

      if (!payload.pageId) {
        continue
      }

      const existing = bestPerPage.get(payload.pageId)
      if (existing && existing.score >= hit.score) {
        continue
      }

      bestPerPage.set(payload.pageId, {
        id: payload.pageId,
        title: payload.title ?? "",
        content: payload.content ?? "",
        score: hit.score,
        updatedAt: payload.updatedAt ?? "",
        pageType: payload.pageType ?? "",
      })
    }

    const documents = [...bestPerPage.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)

    return { documents }
  }
}
