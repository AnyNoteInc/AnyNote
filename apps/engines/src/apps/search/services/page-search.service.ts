import { Injectable } from "@nestjs/common"

import { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import { EmbeddingClient } from "../../indexer/services/embedding-client.service.js"

export type RagSearchDocument = {
  pageId: string
  workspaceId: string
  chunkIndex: number
  title: string
  content: string
  pageType: string
  createdById: string
  createdAt: string
  updatedAt: string
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

type RankedRagSearchDocument = RagSearchDocument & {
  score: number
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

    const bestPerPage = new Map<string, RankedRagSearchDocument>()
    for (const hit of hits) {
      const payload = (hit.payload ?? {}) as {
        pageId?: string
        workspaceId?: string
        chunkIndex?: number
        title?: string
        content?: string
        pageType?: string
        createdById?: string
        createdAt?: string
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
        pageId: payload.pageId,
        workspaceId: payload.workspaceId ?? args.workspaceId,
        chunkIndex: payload.chunkIndex ?? 0,
        title: payload.title ?? "",
        content: payload.content ?? "",
        pageType: payload.pageType ?? "",
        createdById: payload.createdById ?? "",
        createdAt: payload.createdAt ?? "",
        updatedAt: payload.updatedAt ?? "",
        score: hit.score,
      })
    }

    const documents = [...bestPerPage.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
      .map(({ score: _score, ...document }) => document)

    return { documents }
  }
}
