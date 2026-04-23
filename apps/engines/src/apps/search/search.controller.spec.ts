import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { PageSearchService } from "./services/page-search.service.js"
import { SearchController } from "./search.controller.js"

describe("SearchController", () => {
  const mockService = { search: jest.fn<(...a: unknown[]) => Promise<unknown>>() } as unknown as PageSearchService
  let controller: SearchController

  beforeEach(() => {
    ;(mockService.search as jest.Mock).mockReset()
    controller = new SearchController(mockService)
  })

  it("returns documents from the service for a valid payload", async () => {
    ;(mockService.search as jest.Mock).mockResolvedValue({
      documents: [
        {
          id: "p1",
          title: "T",
          content: "C",
          score: 0.9,
          updatedAt: "2026-04-22T00:00:00.000Z",
          pageType: "TEXT",
        },
      ],
    } as never)

    const result = await controller.searchPages({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      query: "hello",
    })

    expect(mockService.search).toHaveBeenCalledWith({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      query: "hello",
      topK: undefined,
      scoreThreshold: undefined,
    })
    expect(result.documents).toHaveLength(1)
  })

  it("rejects invalid workspaceId with 400", async () => {
    await expect(controller.searchPages({ workspaceId: "not-a-uuid", query: "x" } as never)).rejects.toMatchObject({
      status: 400,
    })
  })

  it("rejects empty query with 400", async () => {
    await expect(
      controller.searchPages({
        workspaceId: "11111111-1111-1111-1111-111111111111",
        query: "  ",
      } as never),
    ).rejects.toMatchObject({ status: 400 })
  })
})
