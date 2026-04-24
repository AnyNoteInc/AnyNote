import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals"

import { AgentsClient } from "./agents-client.service.js"

describe("AgentsClient", () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    process.env.AGENTS_SERVICE_URL = "http://agents:8080"
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("POSTs payload to /vectorization and resolves on 2xx", async () => {
    const mockFetch = jest.fn(async () => new Response("{}", { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const client = new AgentsClient()
    await client.vectorize({
      pageId: "p", workspaceId: "w", title: "", pageType: "TEXT", contents: [],
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agents:8080/vectorization")
    expect(init.method).toBe("POST")
  })

  it("throws on 5xx with readable message", async () => {
    globalThis.fetch = jest.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    const client = new AgentsClient()
    await expect(
      client.vectorize({ pageId: "p", workspaceId: "w", title: "", pageType: "TEXT", contents: [] })
    ).rejects.toThrow(/500.*boom/)
  })
})
