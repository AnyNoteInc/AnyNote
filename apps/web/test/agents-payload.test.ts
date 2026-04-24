import { describe, expect, it } from "vitest"

import { buildAgentsPayload } from "../src/lib/chat/agents-payload"

describe("buildAgentsPayload", () => {
  it("serializes rag documents into the agents payload", () => {
    const payload = buildAgentsPayload({
      chatId: "11111111-1111-1111-1111-111111111111",
      workspaceId: "22222222-2222-2222-2222-222222222222",
      userId: "33333333-3333-3333-3333-333333333333",
      text: "hello",
      rag: [
        {
          pageId: "44444444-4444-4444-4444-444444444444",
          workspaceId: "22222222-2222-2222-2222-222222222222",
          chunkIndex: 3,
          title: "Doc",
          content: "Chunk",
          pageType: "TEXT",
          createdById: "33333333-3333-3333-3333-333333333333",
          createdAt: "2026-04-22T10:00:00.000Z",
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
      ],
      settings: {
        temperature: 0,
        topP: 0,
        systemPrompt: "sys",
        defaultModel: {
          slug: "model",
          provider: {
            slug: "provider",
            connection: {},
          },
        },
      },
    })

    expect(payload.rag).toEqual({
      documents: [
        {
          pageId: "44444444-4444-4444-4444-444444444444",
          workspaceId: "22222222-2222-2222-2222-222222222222",
          chunkIndex: 3,
          title: "Doc",
          content: "Chunk",
          pageType: "TEXT",
          createdById: "33333333-3333-3333-3333-333333333333",
          createdAt: "2026-04-22T10:00:00.000Z",
          updatedAt: "2026-04-22T10:05:00.000Z",
        },
      ],
    })
  })
})
