import { describe, expect, it } from "vitest"
import { groupMessages } from "../src/hooks/use-message-groups"
import type { ChatMessage } from "../src/types/index"

const m = (id: string, role: ChatMessage["role"]): ChatMessage => ({ id, role, content: "" })

describe("groupMessages", () => {
  it("returns empty for no messages", () => {
    expect(groupMessages([])).toEqual([])
  })

  it("groups consecutive same-role messages", () => {
    const groups = groupMessages([
      m("1", "user"),
      m("2", "assistant"),
      m("3", "assistant"),
      m("4", "user"),
    ])
    expect(groups.map((g) => [g.role, g.messages.length])).toEqual([
      ["user", 1],
      ["assistant", 2],
      ["user", 1],
    ])
  })

  it("uses first message id as group key", () => {
    const [g] = groupMessages([m("a", "user"), m("b", "user")])
    expect(g!.key).toBe("a")
  })
})
