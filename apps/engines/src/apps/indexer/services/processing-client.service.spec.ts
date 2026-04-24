import { jest, describe, it, expect, beforeEach } from "@jest/globals"

const mockPost = jest.fn<(...a: unknown[]) => Promise<unknown>>()
const mockCreate = jest.fn(() => ({ post: mockPost }))

jest.unstable_mockModule("axios", () => ({
  default: { create: mockCreate },
}))

const { ProcessingClient } = await import("./processing-client.service.js")

describe("ProcessingClient", () => {
  beforeEach(() => {
    mockPost.mockReset()
    mockCreate.mockClear()
    process.env.PROCESSING_SERVICE_URL = "http://agents.test:8080"
  })

  it("posts text and returns normalized chunks", async () => {
    mockPost.mockResolvedValue({ data: { chunks: ["тест"], language: "ru" } })
    const client = new ProcessingClient()
    const out = await client.normalize("Тестовый текст", "auto")
    expect(out).toEqual(["тест"])
    expect(mockPost).toHaveBeenCalledWith("/processing/normalize", {
      text: "Тестовый текст",
      language: "auto",
    })
  })

  it("returns empty array when no normalized chunks remain", async () => {
    mockPost.mockResolvedValue({ data: { chunks: [], language: "ru" } })
    const client = new ProcessingClient()
    expect(await client.normalize("!!!", "ru")).toEqual([])
  })

  it("throws after retries on 5xx", async () => {
    mockPost.mockRejectedValue({ response: { status: 500 } })
    const client = new ProcessingClient()
    await expect(client.normalize("x", "ru")).rejects.toBeDefined()
    expect(mockPost).toHaveBeenCalledTimes(3)
  })
})
