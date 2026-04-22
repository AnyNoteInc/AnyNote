import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatMessageList } from "../src/components/chat/chat-message-list"

describe("ChatMessageList", () => {
  it("renders assistant content without a fallback Assistant label", () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: "assistant-message",
            parts: [{ type: "text", text: "Ответ ассистента" }],
            role: "assistant",
          },
        ]}
      />,
    )

    expect(screen.getByText("Ответ ассистента")).toBeTruthy()
    expect(screen.queryByText("Assistant")).toBeNull()
  })
})
