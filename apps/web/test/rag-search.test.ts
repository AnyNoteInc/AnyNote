import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { searchRagDocuments } from "../src/lib/chat/rag-search"

describe("searchRagDocuments", () => {
  beforeEach(() => {
    process.env.ENGINES_SERVICE_URL = "http://localhost:8082"
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns mapped RAG documents on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            documents: [
              {
                id: "11111111-1111-1111-1111-111111111111",
                title: "Doc",
                content: "Chunk",
                score: 0.9,
                updatedAt: "2026-04-22T00:00:00.000Z",
                pageType: "TEXT",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    )

    const result = await searchRagDocuments({
      workspaceId: "22222222-2222-2222-2222-222222222222",
      query: "hello",
    })

    expect(result).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        title: "Doc",
        content: "Chunk",
      },
    ])
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8082/search/pages",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    )
  })

  it("returns [] on non-2xx responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 500 })))

    const result = await searchRagDocuments({
      workspaceId: "22222222-2222-2222-2222-222222222222",
      query: "hello",
    })

    expect(result).toEqual([])
  })

  it("returns [] on malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } })),
    )

    const result = await searchRagDocuments({
      workspaceId: "22222222-2222-2222-2222-222222222222",
      query: "hello",
    })

    expect(result).toEqual([])
  })

  it("returns [] when the request times out", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn((_, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "AbortError")),
            { once: true },
          )
        })
      }),
    )

    const promise = searchRagDocuments({
      workspaceId: "22222222-2222-2222-2222-222222222222",
      query: "hello",
    })

    await vi.advanceTimersByTimeAsync(5000)

    await expect(promise).resolves.toEqual([])
  })
})
