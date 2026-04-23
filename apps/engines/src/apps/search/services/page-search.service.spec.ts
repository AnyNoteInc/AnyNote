import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import type { EmbeddingClient } from "../../indexer/services/embedding-client.service.js"
import { PageSearchService } from "./page-search.service.js"

describe("PageSearchService", () => {
  const mockEmbed = { embed: jest.fn<(...a: unknown[]) => Promise<number[]>>() } as unknown as EmbeddingClient
  const mockQdrantClient = { search: jest.fn<(...a: unknown[]) => Promise<unknown[]>>() }
  const mockQdrant = { client: mockQdrantClient, collection: "page_chunks" } as unknown as QdrantService

  let service: PageSearchService

  beforeEach(() => {
    ;(mockEmbed.embed as jest.Mock).mockReset()
    ;(mockQdrantClient.search as jest.Mock).mockReset()
    service = new PageSearchService(mockEmbed, mockQdrant)
  })

  const makeHit = (args: { pageId: string; score: number; chunkIndex?: number; content?: string }) => ({
    id: `id-${args.pageId}-${args.chunkIndex ?? 0}`,
    score: args.score,
    payload: {
      pageId: args.pageId,
      workspaceId: "w1",
      chunkIndex: args.chunkIndex ?? 0,
      title: `Title ${args.pageId}`,
      content: args.content ?? `content ${args.pageId}-${args.chunkIndex ?? 0}`,
      pageType: "TEXT",
      createdById: "u1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T01:00:00.000Z",
    },
  })

  it("embeds query, calls Qdrant with workspace filter, maps hits to documents", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1, 0.2] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([makeHit({ pageId: "p1", score: 0.9 })] as never)

    const result = await service.search({ workspaceId: "w1", query: "hello", topK: 5 })

    expect(mockEmbed.embed).toHaveBeenCalledWith("hello")
    expect(mockQdrantClient.search).toHaveBeenCalledWith(
      "page_chunks",
      expect.objectContaining({
        vector: [0.1, 0.2],
        filter: { must: [{ key: "workspaceId", match: { value: "w1" } }] },
        limit: 15,
        score_threshold: 0.35,
        with_payload: true,
      }),
    )
    expect(result.documents).toEqual([
      {
        id: "p1",
        title: "Title p1",
        content: "content p1-0",
        score: 0.9,
        updatedAt: "2026-04-22T01:00:00.000Z",
        pageType: "TEXT",
      },
    ])
  })

  it("dedupes by pageId, keeping the highest-scoring chunk per page", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([
      makeHit({ pageId: "p1", score: 0.7, chunkIndex: 0, content: "low" }),
      makeHit({ pageId: "p1", score: 0.9, chunkIndex: 1, content: "high" }),
      makeHit({ pageId: "p2", score: 0.8, chunkIndex: 0, content: "p2-best" }),
    ] as never)

    const result = await service.search({ workspaceId: "w1", query: "x" })

    expect(result.documents).toHaveLength(2)
    expect(result.documents[0]).toMatchObject({ id: "p1", content: "high", score: 0.9 })
    expect(result.documents[1]).toMatchObject({ id: "p2", content: "p2-best", score: 0.8 })
  })

  it("caps at topK pages after dedupe", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeHit({ pageId: `p${i}`, score: 0.9 - i * 0.05 })) as never,
    )

    const result = await service.search({ workspaceId: "w1", query: "x", topK: 3 })

    expect(result.documents).toHaveLength(3)
    expect(result.documents.map((document) => document.id)).toEqual(["p0", "p1", "p2"])
  })

  it("returns empty documents when Qdrant returns no hits", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([] as never)

    const result = await service.search({ workspaceId: "w1", query: "no match" })

    expect(result.documents).toEqual([])
  })

  it("passes custom scoreThreshold and topK to Qdrant", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([] as never)

    await service.search({ workspaceId: "w1", query: "x", topK: 7, scoreThreshold: 0.5 })

    expect(mockQdrantClient.search).toHaveBeenCalledWith(
      "page_chunks",
      expect.objectContaining({ limit: 21, score_threshold: 0.5 }),
    )
  })
})
