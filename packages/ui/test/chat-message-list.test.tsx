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

  it("renders timestamps with a deterministic HH:MM format", () => {
    render(
      <ChatMessageList
        messages={[
          {
            id: "message-with-time",
            parts: [{ type: "text", text: "Сообщение со временем" }],
            role: "user",
            createdAt: "2026-04-22T08:05:00.000Z",
            status: "sent",
          },
        ]}
      />,
    )

    expect(screen.getByText("08:05 • Sent")).toBeTruthy()
  })
})
