"use client"

import { Alert, Box } from "@repo/ui/components"
import {
  ChatEmptyState,
  ChatHeader,
  ChatShell,
  Composer,
  MessageList,
} from "@repo/chat/components"
import { useChatStream } from "@repo/chat/hooks"
import type { ChatMessage, ChatStreamChunk } from "@repo/chat/types"
import { useMemo, useRef } from "react"

type Props = {
  workspaceId: string
  workspaceName: string
  hasModelConfigured: boolean
}

export function ChatPageClient({ workspaceId, workspaceName, hasModelConfigured }: Props) {
  const threadIdRef = useRef<string>(typeof crypto !== "undefined" ? crypto.randomUUID() : "thread")

  const submit = useMemo(() => {
    return async function* (
      prompt: string,
      history: ChatMessage[],
    ): AsyncIterable<ChatStreamChunk> {
      const payload = {
        workspaceId,
        threadId: threadIdRef.current,
        prompt,
        history: history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content ?? "",
          })),
      }
      const res = await fetch("/api/agents/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Upstream ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nlIdx: number
        while ((nlIdx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, nlIdx)
          buffer = buffer.slice(nlIdx + 2)
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"))
          if (!dataLine) continue
          const json = dataLine.slice(5).trim()
          if (!json) continue
          try {
            const event: { type: string; content?: string; message?: string } = JSON.parse(json)
            if (event.type === "token" && event.content) {
              yield { delta: event.content }
            } else if (event.type === "error") {
              throw new Error(event.message ?? "Agents error")
            } else if (event.type === "done") {
              return
            }
          } catch (err) {
            if (err instanceof Error) throw err
            throw new Error(String(err))
          }
        }
      }
    }
  }, [workspaceId])

  const stream = useChatStream({ submit })

  return (
    <Box sx={{ height: "calc(100vh - 64px)" }}>
      <ChatShell>
        <ChatHeader title={`AnyNote AI · ${workspaceName}`} />
        {!hasModelConfigured && (
          <Box sx={{ px: 3, pt: 2 }}>
            <Alert severity="warning">
              Модель не выбрана. Откройте Настройки → AI агент, чтобы выбрать модель по умолчанию.
            </Alert>
          </Box>
        )}
        {stream.messages.length === 0 ? (
          <ChatEmptyState
            title="О чём поговорим?"
            subtitle={
              hasModelConfigured
                ? "Спросите что-нибудь — ответ придёт стримом из apps/agents."
                : "Сначала настройте модель в разделе AI агент."
            }
          />
        ) : (
          <MessageList messages={stream.messages} onRetry={() => stream.retry()} />
        )}
        <Composer
          onSubmit={stream.send}
          submitting={stream.isStreaming}
          disabled={!hasModelConfigured}
        />
      </ChatShell>
    </Box>
  )
}
