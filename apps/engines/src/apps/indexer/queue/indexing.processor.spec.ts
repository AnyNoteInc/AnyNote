import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PrismaClient } from "@repo/db"
import type { Job } from "bullmq"

import type { EmbeddingClient } from "../services/embedding-client.service.js"
import type { PageChunker } from "../services/page-chunker.service.js"
import type { ProcessingClient } from "../services/processing-client.service.js"
import type { QdrantWriter } from "../services/qdrant-writer.service.js"
import { IndexingProcessor } from "./indexing.processor.js"

describe("IndexingProcessor", () => {
  const mockPrisma = {
    page: { findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
    $executeRaw: jest.fn<(...a: unknown[]) => Promise<number>>(),
  } as unknown as PrismaClient
  const mockChunker = { chunksFromDoc: jest.fn<(...a: unknown[]) => string[]>() } as unknown as PageChunker
  const mockProcessing = { normalize: jest.fn<(...a: unknown[]) => Promise<string>>() } as unknown as ProcessingClient
  const mockEmbed = { embed: jest.fn<(...a: unknown[]) => Promise<number[]>>() } as unknown as EmbeddingClient
  const mockQdrant = {
    deleteByPageId: jest.fn<(...a: unknown[]) => Promise<void>>(),
    upsert: jest.fn<(...a: unknown[]) => Promise<void>>(),
    ensureCollection: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as QdrantWriter

  let processor: IndexingProcessor

  const makeJob = (data: object): Job => ({ data } as Job)

  beforeEach(() => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.$executeRaw as jest.Mock).mockReset()
    ;(mockChunker.chunksFromDoc as jest.Mock).mockReset()
    ;(mockProcessing.normalize as jest.Mock).mockReset()
    ;(mockEmbed.embed as jest.Mock).mockReset()
    ;(mockQdrant.deleteByPageId as jest.Mock).mockReset()
    ;(mockQdrant.upsert as jest.Mock).mockReset()
    ;(mockQdrant.ensureCollection as jest.Mock).mockReset()
    processor = new IndexingProcessor(mockPrisma, mockChunker, mockProcessing, mockEmbed, mockQdrant)
  })

  it("deletes points and returns when page is missing", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue(null as never)
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1 as never)

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalledWith("p1")
    expect(mockChunker.chunksFromDoc).not.toHaveBeenCalled()
    expect(mockPrisma.$executeRaw).toHaveBeenCalled() // marks DONE
  })

  it("skips wrong page types but still deletes old points", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "EXCALIDRAW",
      ownership: "TEXT",
      deletedAt: null,
      content: {},
    } as never)
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1 as never)

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalled()
    expect(mockChunker.chunksFromDoc).not.toHaveBeenCalled()
  })

  it("processes chunks end-to-end when page is valid", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "TEXT",
      ownership: "TEXT",
      deletedAt: null,
      content: { type: "doc", content: [] },
      workspaceId: "w1",
    } as never)
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1 as never)
    ;(mockChunker.chunksFromDoc as jest.Mock).mockReturnValue(["chunk a", "chunk b"] as never)
    ;(mockProcessing.normalize as jest.Mock)
      .mockResolvedValueOnce("a" as never)
      .mockResolvedValueOnce("b" as never)
    ;(mockEmbed.embed as jest.Mock)
      .mockResolvedValueOnce([0.1, 0.2] as never)
      .mockResolvedValueOnce([0.3, 0.4] as never)

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalledWith("p1")
    expect(mockQdrant.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ vector: [0.1, 0.2], payload: { pageId: "p1", workspaceId: "w1", chunkIndex: 0 } }),
      expect.objectContaining({ vector: [0.3, 0.4], payload: { pageId: "p1", workspaceId: "w1", chunkIndex: 1 } }),
    ])
  })

  it("drops empty normalized chunks", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "TEXT",
      ownership: "TEXT",
      deletedAt: null,
      content: { type: "doc", content: [] },
      workspaceId: "w1",
    } as never)
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1 as never)
    ;(mockChunker.chunksFromDoc as jest.Mock).mockReturnValue(["!!", "real"] as never)
    ;(mockProcessing.normalize as jest.Mock)
      .mockResolvedValueOnce("" as never)
      .mockResolvedValueOnce("real" as never)
    ;(mockEmbed.embed as jest.Mock).mockResolvedValueOnce([0.5] as never)

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockEmbed.embed).toHaveBeenCalledTimes(1)
    expect(mockQdrant.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ vector: [0.5], payload: expect.objectContaining({ chunkIndex: 1 }) }),
    ])
  })
})
