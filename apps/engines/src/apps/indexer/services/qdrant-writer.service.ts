import { Injectable, Logger } from "@nestjs/common"

import { QdrantService } from "../../../infra/qdrant/qdrant.service.js"

export type QdrantPoint = {
  id: string
  vector: number[]
  payload: {
    pageId: string
    workspaceId: string
    chunkIndex: number
  }
}

const VECTOR_SIZE = 768

@Injectable()
export class QdrantWriter {
  private readonly log = new Logger(QdrantWriter.name)

  constructor(private readonly qdrant: QdrantService) {}

  async ensureCollection(): Promise<void> {
    const existing = await this.qdrant.client.getCollections()
    const collections = existing.collections as { name: string }[] | undefined
    const exists = collections?.some((c) => c.name === this.qdrant.collection)
    if (exists) return
    await this.qdrant.client.createCollection(this.qdrant.collection, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    })
    this.log.log(`Created Qdrant collection ${this.qdrant.collection}`)
  }

  async deleteByPageId(pageId: string): Promise<void> {
    await this.qdrant.client.delete(this.qdrant.collection, {
      filter: {
        must: [{ key: "pageId", match: { value: pageId } }],
      },
    })
  }

  async upsert(points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) return
    await this.qdrant.client.upsert(this.qdrant.collection, { points })
  }
}
