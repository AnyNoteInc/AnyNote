import { describe, expect, it } from "vitest"

import { buildAgentsPayload } from "../src/lib/chat/agents-payload"

describe("buildAgentsPayload", () => {
  it("builds agents payload with required fields", () => {
    const payload = buildAgentsPayload({
      chatId: "11111111-1111-1111-1111-111111111111",
      workspaceId: "22222222-2222-2222-2222-222222222222",
      userId: "33333333-3333-3333-3333-333333333333",
      text: "hello",
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

    expect(payload.threadId).toBe("11111111-1111-1111-1111-111111111111")
    expect(payload.query).toBe("hello")
    expect(payload.instruction.citationsRequired).toBe(true)
  })
})
