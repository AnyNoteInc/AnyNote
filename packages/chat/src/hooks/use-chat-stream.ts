"use client"

import { useCallback, useRef, useState } from "react"
import type { ChatMessage, ChatStreamChunk } from "../types/index"

export interface UseChatStreamOptions {
  /** Returns an async iterable of token chunks for the given prompt. */
  submit: (prompt: string, history: ChatMessage[]) => AsyncIterable<ChatStreamChunk>
  /** Optional id factory; defaults to crypto.randomUUID(). */
  generateId?: () => string
  /** When true, allows submitting while a previous response is still streaming. */
  allowConcurrent?: boolean
}

export interface UseChatStreamResult {
  messages: ChatMessage[]
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  isStreaming: boolean
  send: (prompt: string) => Promise<void>
  retry: () => Promise<void>
  reset: () => void
}

const defaultId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function useChatStream(options: UseChatStreamOptions): UseChatStreamResult {
  const { submit, generateId = defaultId, allowConcurrent = false } = options
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  const streamingRef = useRef(false)

  const drive = useCallback(
    async (userMessage: ChatMessage, history: ChatMessage[]) => {
      const assistantId = generateId()
      const assistant: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "streaming",
      }
      setMessages((prev) => [...prev, assistant])
      streamingRef.current = true
      setIsStreaming(true)
      try {
        for await (const chunk of submit(userMessage.content ?? "", history)) {
          if (!chunk.delta) continue
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: (m.content ?? "") + chunk.delta } : m,
            ),
          )
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, status: "done" } : m)),
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, status: "error", errorMessage: message } : m,
          ),
        )
      } finally {
        streamingRef.current = false
        setIsStreaming(false)
      }
    },
    [generateId, submit],
  )

  const send = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) return
      if (streamingRef.current && !allowConcurrent) return
      const userMessage: ChatMessage = {
        id: generateId(),
        role: "user",
        content: prompt,
        status: "done",
      }
      const historySnapshot = [...messagesRef.current]
      setMessages((prev) => [...prev, userMessage])
      await drive(userMessage, [...historySnapshot, userMessage])
    },
    [allowConcurrent, drive, generateId],
  )

  const retry = useCallback(async () => {
    const trimmed = [...messagesRef.current]
    while (trimmed.length > 0) {
      const tail = trimmed[trimmed.length - 1]
      if (tail && tail.role === "assistant" && tail.status === "error") {
        trimmed.pop()
      } else {
        break
      }
    }
    let lastUser: ChatMessage | undefined
    for (let i = trimmed.length - 1; i >= 0; i -= 1) {
      const m = trimmed[i]
      if (m && m.role === "user") {
        lastUser = m
        break
      }
    }
    setMessages(trimmed)
    if (lastUser) await drive(lastUser, trimmed)
  }, [drive])

  const reset = useCallback(() => {
    setMessages([])
    streamingRef.current = false
    setIsStreaming(false)
  }, [])

  return { messages, setMessages, isStreaming, send, retry, reset }
}
