import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PrismaClient } from "@repo/db"

import { OutboxCronService } from "./outbox-cron.service.js"

describe("OutboxCronService", () => {
  const mockPrisma = {
    page: {
      findMany: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    },
    $executeRaw: jest.fn<(...a: unknown[]) => Promise<number>>(),
  } as unknown as PrismaClient

  let service: OutboxCronService

  beforeEach(() => {
    ;(mockPrisma.page.findMany as jest.Mock).mockReset()
    ;(mockPrisma.$executeRaw as jest.Mock).mockReset()
    process.env.INDEXER_QUIET_PERIOD_MINUTES = "5"
    service = new OutboxCronService(mockPrisma)
  })

  it("queries only TEXT pages idle for 5+ minutes", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([])

    await service.tick()

    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: "TEXT",
        ownership: "TEXT",
        deletedAt: null,
        updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      select: { id: true, workspaceId: true },
      take: 500,
    })
  })

  it("upserts outbox row per page with ON CONFLICT DO NOTHING", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "p1", workspaceId: "w1" },
      { id: "p2", workspaceId: "w1" },
    ])
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1)

    const inserted = await service.tick()

    expect(inserted).toBe(2)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
  })

  it("returns 0 when no eligible pages", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([])
    expect(await service.tick()).toBe(0)
  })
})
