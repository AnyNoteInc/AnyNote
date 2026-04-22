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
          { type: "text", text: "# Heading\n\nHello **there**" },
        ]}
      />,
    )

    const text = screen.getByRole("heading", { name: "Heading" })
    const file = screen.getByRole("link", { name: /brief\.pdf/i })
    const strong = container.querySelector("strong")

    expect(text).toBeTruthy()
    expect(file).toBeTruthy()
    expect(strong?.textContent).toBe("there")
    expect(container.textContent?.indexOf("Heading")).toBeLessThan(
      container.textContent?.indexOf("brief.pdf") ?? Number.POSITIVE_INFINITY,
    )
  })
})
