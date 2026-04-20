import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import { QdrantWriter } from "./qdrant-writer.service.js"

describe("QdrantWriter", () => {
  const fakeClient = {
    delete: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    upsert: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    getCollections: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    createCollection: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  }
  const qdrantService = {
    client: fakeClient,
    collection: "page_chunks",
  } as unknown as QdrantService

  let writer: QdrantWriter

  beforeEach(() => {
    fakeClient.delete.mockReset()
    fakeClient.upsert.mockReset()
    fakeClient.getCollections.mockReset()
    fakeClient.createCollection.mockReset()
    writer = new QdrantWriter(qdrantService)
  })

  describe("deleteByPageId", () => {
    it("calls delete with filter on pageId", async () => {
      fakeClient.delete.mockResolvedValue({})
      await writer.deleteByPageId("page-1")
      expect(fakeClient.delete).toHaveBeenCalledWith("page_chunks", {
        filter: {
          must: [{ key: "pageId", match: { value: "page-1" } }],
        },
      })
    })
  })

  describe("upsert", () => {
    it("passes through points list", async () => {
      fakeClient.upsert.mockResolvedValue({})
      const points = [
        { id: "a", vector: [0.1, 0.2], payload: { pageId: "p", workspaceId: "w", chunkIndex: 0 } },
      ]
      await writer.upsert(points)
      expect(fakeClient.upsert).toHaveBeenCalledWith("page_chunks", { points })
    })

    it("is a no-op for empty points", async () => {
      await writer.upsert([])
      expect(fakeClient.upsert).not.toHaveBeenCalled()
    })
  })

  describe("ensureCollection", () => {
    it("creates collection if missing", async () => {
      fakeClient.getCollections.mockResolvedValue({ collections: [] })
      await writer.ensureCollection()
      expect(fakeClient.createCollection).toHaveBeenCalledWith("page_chunks", {
        vectors: { size: 768, distance: "Cosine" },
      })
    })

    it("skips if collection exists", async () => {
      fakeClient.getCollections.mockResolvedValue({
        collections: [{ name: "page_chunks" }],
      })
      await writer.ensureCollection()
      expect(fakeClient.createCollection).not.toHaveBeenCalled()
    })
  })
})
