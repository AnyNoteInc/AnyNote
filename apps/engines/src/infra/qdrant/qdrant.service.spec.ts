import { QdrantService } from "./qdrant.service.js"

describe("QdrantService", () => {
  it("constructs with url + apiKey from env", () => {
    process.env.QDRANT_URL = "http://localhost:6333"
    process.env.QDRANT_API_KEY = "dev"
    const svc = new QdrantService()
    expect(svc.client).toBeDefined()
  })

  it("uses QDRANT_COLLECTION env var", () => {
    process.env.QDRANT_COLLECTION = "custom"
    const svc = new QdrantService()
    expect(svc.collection).toBe("custom")
  })

  it("defaults collection to page_chunks", () => {
    delete process.env.QDRANT_COLLECTION
    const svc = new QdrantService()
    expect(svc.collection).toBe("page_chunks")
  })
})
