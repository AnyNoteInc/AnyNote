import { Injectable } from "@nestjs/common"
import { QdrantClient } from "@qdrant/js-client-rest"

@Injectable()
export class QdrantService {
  readonly client: QdrantClient
  readonly collection: string

  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://localhost:6333",
      apiKey: process.env.QDRANT_API_KEY,
      checkCompatibility: false,
    })
    this.collection = process.env.QDRANT_COLLECTION ?? "page_chunks"
  }
}
