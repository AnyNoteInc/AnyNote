import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"
import type { PrismaClient } from "@repo/db"

import type { QdrantWriter } from "./qdrant-writer.service.js"
import { ReindexOnBootService } from "./reindex-on-boot.service.js"

describe("ReindexOnBootService", () => {
  const mockPrisma = {
    page: { findMany: jest.fn<(...a: unknown[]) => Promise<unknown[]>>() },
    outboxEvent: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient
  const mockQdrant = {
    wipeCollection: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as QdrantWriter

  const originalEnv = process.env.INDEXER_REINDEX_ON_BOOT

  beforeEach(() => {
    ;(mockPrisma.page.findMany as jest.Mock).mockReset()
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockReset()
    ;(mockQdrant.wipeCollection as jest.Mock).mockReset()
  })

  afterEach(() => {
    process.env.INDEXER_REINDEX_ON_BOOT = originalEnv
  })

  it("is a no-op when env flag is absent", async () => {
    delete process.env.INDEXER_REINDEX_ON_BOOT
    const svc = new ReindexOnBootService(mockPrisma, mockQdrant)

    await svc.onApplicationBootstrap()

    expect(mockQdrant.wipeCollection).not.toHaveBeenCalled()
    expect(mockPrisma.page.findMany).not.toHaveBeenCalled()
  })

  it("wipes the collection and enqueues every live TEXT page when flag is true", async () => {
    process.env.INDEXER_REINDEX_ON_BOOT = "true"
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "p1", workspaceId: "w1" },
      { id: "p2", workspaceId: "w2" },
    ] as never)
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockResolvedValue({} as never)

    const svc = new ReindexOnBootService(mockPrisma, mockQdrant)
    await svc.onApplicationBootstrap()

    expect(mockQdrant.wipeCollection).toHaveBeenCalled()
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: "p1",
        workspaceId: "w1",
        payload: {},
      },
    })
  })
})
