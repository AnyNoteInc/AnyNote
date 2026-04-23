import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatThread } from "../src/components/chat/chat-thread"

function defineScrollMetric(element: HTMLElement, name: "clientHeight" | "scrollHeight", value: number) {
  Object.defineProperty(element, name, {
    configurable: true,
    value,
  })
}

describe("ChatThread", () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ""
  })

  it("uses the page scroll container, keeps the composer sticky, and exposes scroll-to-bottom", async () => {
    const user = userEvent.setup()
    const scrollContainer = document.createElement("section")
    scrollContainer.id = "chat-page-scroll"
    document.body.append(scrollContainer)
    defineScrollMetric(scrollContainer, "clientHeight", 480)
    defineScrollMetric(scrollContainer, "scrollHeight", 1280)
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    })
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      scrollContainer.scrollTop = Number(options.top ?? 0)
    })
    Object.defineProperty(scrollContainer, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })

    render(
      <ChatThread
        composerAttachments={[]}
        composerValue=""
        messages={[
          {
            id: "message-1",
            parts: [{ type: "text", text: "Первое сообщение" }],
            role: "assistant",
          },
        ]}
        onComposerAttachmentsChange={() => {}}
        onComposerValueChange={() => {}}
        onSend={() => {}}
        scrollContainerSelector="#chat-page-scroll"
        scrollKey="chat-1"
      />,
    )

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 1280 })
    })

    expect(screen.getByTestId("chat-message-list").getAttribute("data-scroll-mode")).toBe("page")
    expect(screen.getByTestId("chat-composer-shell").getAttribute("data-sticky")).toBe("true")
    expect(screen.queryByRole("button", { name: "Прокрутить вниз" })).toBeNull()

    act(() => {
      scrollContainer.scrollTop = 80
      fireEvent.scroll(scrollContainer)
    })

    const scrollDownButton = await screen.findByRole("button", { name: "Прокрутить вниз" })
    await user.click(scrollDownButton)

    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "smooth", top: 1280 })
  })
})
