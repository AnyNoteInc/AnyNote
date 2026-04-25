import { render, screen, act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatLoadingPhrases } from "../src/components/chat/chat-loading-phrases"

describe("ChatLoadingPhrases", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts with the first phrase", () => {
    render(<ChatLoadingPhrases />)
    expect(screen.getByText("Загрузка")).toBeTruthy()
  })

  it("rotates phrases every 1000 ms", () => {
    render(<ChatLoadingPhrases />)
    expect(screen.getByText("Загрузка")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Вычисления")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Преобразование")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Литье")).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Загрузка")).toBeTruthy()
  })
})
