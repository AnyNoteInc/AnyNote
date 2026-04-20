import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useChatStream } from "../src/hooks/use-chat-stream"

async function* yieldDeltas(deltas: string[]) {
  for (const d of deltas) yield { delta: d }
}

describe("useChatStream", () => {
  it("appends user + streaming assistant message and resolves to done", async () => {
    const submit = () => yieldDeltas(["Hello", " ", "world"])
    const { result } = renderHook(() => useChatStream({ submit }))

    await act(async () => {
      await result.current.send("hi")
    })

    await waitFor(() => expect(result.current.isStreaming).toBe(false))
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]!.role).toBe("user")
    expect(result.current.messages[1]!.role).toBe("assistant")
    expect(result.current.messages[1]!.content).toBe("Hello world")
    expect(result.current.messages[1]!.status).toBe("done")
  })

  it("flips assistant to error on submit throw", async () => {
    // eslint-disable-next-line require-yield -- intentionally throws before yielding
    async function* boom(): AsyncIterable<{ delta: string }> {
      throw new Error("nope")
    }
    const { result } = renderHook(() => useChatStream({ submit: () => boom() }))

    await act(async () => {
      await result.current.send("hi")
    })

    expect(result.current.messages[1]!.status).toBe("error")
    expect(result.current.messages[1]!.errorMessage).toBe("nope")
  })

  it("ignores empty prompts", async () => {
    const { result } = renderHook(() =>
      useChatStream({ submit: () => yieldDeltas(["x"]) }),
    )
    await act(async () => {
      await result.current.send("   ")
    })
    expect(result.current.messages).toEqual([])
  })
})
