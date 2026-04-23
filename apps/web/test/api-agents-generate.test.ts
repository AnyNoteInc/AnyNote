import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  return {
    activeStreamRegistry: {
      create: vi.fn(),
    },
    getSession: vi.fn(),
    searchRagDocuments: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      chat: { findFirst: vi.fn() },
      chatMessage: { update: vi.fn() },
      file: { findMany: vi.fn() },
      workspaceAiSettings: { findUnique: vi.fn() },
    },
  }
})

vi.mock("@repo/db", () => ({
  FileStatus: { ACTIVE: "ACTIVE" },
  prisma: mocks.prisma,
}))

vi.mock("@/lib/get-session", () => ({
  getSession: mocks.getSession,
}))

vi.mock("@/lib/chat/active-stream-registry", () => ({
  activeStreamRegistry: mocks.activeStreamRegistry,
}))

vi.mock("@/lib/chat/rag-search", () => ({
  searchRagDocuments: mocks.searchRagDocuments,
}))

import { POST } from "../src/app/api/agents/generate/route"

describe("POST /api/agents/generate", () => {
  const chatId = "11111111-1111-1111-1111-111111111111"
  const workspaceId = "22222222-2222-2222-2222-222222222222"
  const userId = "33333333-3333-3333-3333-333333333333"
  const userMessageId = "44444444-4444-4444-4444-444444444444"
  const assistantMessageId = "55555555-5555-5555-5555-555555555555"

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns SSE events for a successful start flow", async () => {
    const entry = {
      assistantMessageId,
      blocks: [],
      chatId,
      content: "",
      errorMessage: undefined,
      lastTouchedAt: Date.now(),
      publishBlocks: vi.fn(),
      publishCreated: vi.fn(),
      publishDelta: vi.fn(),
      publishDone: vi.fn(),
      publishStatus: vi.fn(),
      scheduleCleanup: vi.fn(),
      setUpstreamTask: vi.fn(),
      status: "STREAMING",
      subscribe: vi.fn((subscriber) => {
        subscriber({
          type: "message.delta",
          assistantMessageId,
          text: "Привет",
        })
        subscriber({
          type: "message.status",
          assistantMessageId,
          status: "DONE",
        })
        subscriber({
          type: "message.done",
          assistantMessageId,
        })
        return () => {}
      }),
      upstreamTask: null,
      userMessageId,
    }

    mocks.getSession.mockResolvedValue({
      user: { id: userId },
    })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: "Новый чат",
      workspaceId,
    })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: 0,
      topP: 0,
      systemPrompt: "sys",
      defaultModel: {
        slug: "GigaChat-2",
        provider: {
          slug: "gigachat",
          connection: {},
        },
      },
    })
    mocks.searchRagDocuments.mockResolvedValue([
      {
        id: "66666666-6666-6666-6666-666666666666",
        title: "Found page",
        content: "Found chunk",
      },
    ])
    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      return callback({
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
        chatMessageFile: { createMany: vi.fn() },
      })
    })
    mocks.activeStreamRegistry.create.mockReturnValue(entry)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"type":"done"}\n\n', {
        headers: { "content-type": "text/event-stream" },
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const response = await POST(
      new NextRequest("http://localhost/api/agents/generate", {
        method: "POST",
        body: JSON.stringify({
          chatId,
          text: "Привет",
          fileIds: [],
        }),
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.text()
    const upstreamPayload = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)

    expect(body).toContain('"type":"message.created"')
    expect(body).toContain('"type":"message.delta"')
    expect(mocks.searchRagDocuments).toHaveBeenCalledWith({
      workspaceId,
      query: "Привет",
    })
    expect(upstreamPayload.rag).toEqual({
      documents: [
        {
          id: "66666666-6666-6666-6666-666666666666",
          title: "Found page",
          content: "Found chunk",
        },
      ],
    })
  })
})
