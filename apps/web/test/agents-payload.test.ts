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
          id: "44444444-4444-4444-4444-444444444444",
          title: "Doc",
          content: "Chunk",
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
          id: "44444444-4444-4444-4444-444444444444",
          title: "Doc",
          content: "Chunk",
        },
      ],
    })
  })
})
