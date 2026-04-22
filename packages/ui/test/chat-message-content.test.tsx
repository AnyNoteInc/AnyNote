import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChatMessageContent } from "../src/components/chat/chat-message-content"

describe("ChatMessageContent", () => {
  it("renders text before file parts", () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          {
            type: "file",
            fileId: "f1",
            name: "brief.pdf",
            mimeType: "application/pdf",
            fileSize: "12 KB",
            downloadUrl: "/api/files/f1",
          },
          { type: "text", text: "Hello there" },
        ]}
      />,
    )

    const text = screen.getByText("Hello there")
    const file = screen.getByRole("link", { name: /brief\.pdf/i })

    expect(text).toBeTruthy()
    expect(file).toBeTruthy()
    expect(container.textContent?.indexOf("Hello there")).toBeLessThan(
      container.textContent?.indexOf("brief.pdf") ?? Number.POSITIVE_INFINITY,
    )
  })
})
