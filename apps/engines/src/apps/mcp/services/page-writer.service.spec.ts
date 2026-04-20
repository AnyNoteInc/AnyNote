import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PrismaClient } from "@repo/db"

import { PageWriter } from "./page-writer.service.js"

describe("PageWriter", () => {
  const mockPrisma = {
    $transaction: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    page: {
      create: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
      findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>(),
    },
    outboxEvent: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient

  let writer: PageWriter

  beforeEach(() => {
    ;(mockPrisma.$transaction as jest.Mock).mockReset()
    ;(mockPrisma.page.create as jest.Mock).mockReset()
    ;(mockPrisma.page.update as jest.Mock).mockReset()
    ;(mockPrisma.page.findUnique as jest.Mock).mockReset()
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockReset()
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(
      (async (fn: (tx: PrismaClient) => Promise<unknown>) => fn(mockPrisma)) as never,
    )
    writer = new PageWriter(mockPrisma)
  })

  describe("createPage", () => {
    it("creates page and enqueues outbox", async () => {
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: "p1" } as never)

      const id = await writer.createPage({
        userId: "u1",
        workspaceId: "w1",
        title: "Test",
        ownership: "TEXT",
      })

      expect(id).toBe("p1")
      expect(mockPrisma.page.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: "w1",
          title: "Test",
          ownership: "TEXT",
          createdById: "u1",
          updatedById: "u1",
        }),
        select: { id: true },
      })
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: "p1",
          workspaceId: "w1",
        }),
      })
    })
  })

  describe("updatePage", () => {
    it("rejects when page belongs to another workspace", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: "p1",
        workspaceId: "other",
      } as never)
      await expect(
        writer.updatePage({ userId: "u1", workspaceId: "w1", pageId: "p1", title: "x" }),
      ).rejects.toThrow(/not found/i)
    })

    it("updates page and enqueues outbox", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "w1" } as never)
      ;(mockPrisma.page.update as jest.Mock).mockResolvedValue({ id: "p1" } as never)

      await writer.updatePage({ userId: "u1", workspaceId: "w1", pageId: "p1", title: "new" })

      expect(mockPrisma.page.update).toHaveBeenCalled()
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })
  })
})
