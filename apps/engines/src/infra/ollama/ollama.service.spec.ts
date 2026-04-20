import { beforeEach, describe, expect, it, jest } from "@jest/globals"

// ESM mocking: jest.mock() does not hoist across ESM static imports, so use
// jest.unstable_mockModule + dynamic import of the module under test.
const mockPost = jest.fn()
const mockCreate = jest.fn(() => ({ post: mockPost }))

jest.unstable_mockModule("axios", () => ({
  default: { create: mockCreate },
}))

const { OllamaService } = await import("./ollama.service.js")

describe("OllamaService", () => {
  beforeEach(() => {
    mockPost.mockReset()
    mockCreate.mockClear()
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434"
    process.env.EMBEDDING_MODEL = "nomic-embed-text"
  })

  it("embeds text via /api/embeddings", async () => {
    mockPost.mockResolvedValue({ data: { embedding: [0.1, 0.2, 0.3] } } as never)

    const svc = new OllamaService()
    const vec = await svc.embed("hello")

    expect(vec).toEqual([0.1, 0.2, 0.3])
  })

  it("throws if response missing embedding", async () => {
    mockPost.mockResolvedValue({ data: {} } as never)

    const svc = new OllamaService()
    await expect(svc.embed("hello")).rejects.toThrow(/empty/i)
  })
})
