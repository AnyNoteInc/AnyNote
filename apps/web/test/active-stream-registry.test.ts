import { describe, expect, it } from "vitest"

import { createActiveStreamRegistry } from "../src/lib/chat/active-stream-registry"

describe("active stream registry", () => {
  it("broadcasts deltas to multiple subscribers", () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create({
      assistantMessageId: "assistant-1",
      chatId: "chat-1",
      userMessageId: "user-1",
    })

    const left: string[] = []
    const right: string[] = []

    entry.subscribe((event) => {
      if (event.type === "message.delta") {
        left.push(event.text)
      }
    })
    entry.subscribe((event) => {
      if (event.type === "message.delta") {
        right.push(event.text)
      }
    })

    entry.publishDelta("При")
    entry.publishDelta("вет")

    expect(left).toEqual(["При", "вет"])
    expect(right).toEqual(["При", "вет"])
  })
})
