import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PrismaClient } from "@repo/db"
import type { Queue } from "bullmq"

import { OutboxDrainerService } from "./outbox-drainer.service.js"

type TxFn = (tx: PrismaClient) => Promise<unknown>

describe("OutboxDrainerService", () => {
  const mockPrisma = {
    $transaction: jest.fn<(fn: TxFn) => Promise<unknown>>(),
    $queryRaw: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    $executeRaw: jest.fn<(...a: unknown[]) => Promise<number>>(),
  } as unknown as PrismaClient

  const mockQueue = {
    add: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
  } as unknown as Queue

  let service: OutboxDrainerService

  beforeEach(() => {
    ;(mockPrisma.$transaction as jest.Mock).mockReset()
    ;(mockPrisma.$queryRaw as jest.Mock).mockReset()
    ;(mockPrisma.$executeRaw as jest.Mock).mockReset()
    ;(mockQueue.add as jest.Mock).mockReset()
    process.env.INDEXER_DRAINER_BATCH = "50"
    service = new OutboxDrainerService(mockPrisma, mockQueue)
  })

  it("claims batch and enqueues jobs", async () => {
    const rows = [
      { id: 1n, page_id: "p1", workspace_id: "w1" },
      { id: 2n, page_id: "p2", workspace_id: "w1" },
    ]
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(((fn: TxFn) => {
      ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce(rows as never)
      ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1 as never)
      return fn(mockPrisma)
    }) as never)
    ;(mockQueue.add as jest.Mock).mockResolvedValue({} as never)

    const claimed = await service.drain()

    expect(claimed).toBe(2)
    expect(mockQueue.add).toHaveBeenCalledTimes(2)
    expect(mockQueue.add).toHaveBeenNthCalledWith(
      1,
      "index-page",
      { outboxId: "1", pageId: "p1", workspaceId: "w1" },
      expect.any(Object),
    )
  })

  it("returns 0 when no pending rows", async () => {
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(((fn: TxFn) => {
      ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([] as never)
      return fn(mockPrisma)
    }) as never)
    expect(await service.drain()).toBe(0)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
