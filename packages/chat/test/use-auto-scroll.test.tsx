import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useAutoScroll } from "../src/hooks/use-auto-scroll"

describe("useAutoScroll", () => {
  it("starts pinned by default and exposes a containerRef + scrollToBottom", () => {
    const { result } = renderHook(() => useAutoScroll())
    expect(result.current.isPinned).toBe(true)
    expect(typeof result.current.scrollToBottom).toBe("function")
    // ref is initialized to null; consumer attaches it via ref={containerRef}
    expect(result.current.containerRef.current).toBeNull()
  })
})
