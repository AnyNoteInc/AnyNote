"use client"

import { Box } from "@repo/ui/components"
import {
  ChatEmptyState,
  ChatHeader,
  ChatShell,
  Composer,
  MessageList,
} from "@repo/chat/components"
import { useChatStream } from "@repo/chat/hooks"
import type { ChatStreamChunk } from "@repo/chat/types"

const FAKE_RESPONSE = `Привет! Это **демо** ответа AI ассистента.

Я могу:

- отвечать в markdown
- показывать \`код\`
- стримить токены

\`\`\`ts
const greet = (name: string) => \`hello, \${name}\`
\`\`\`
`

async function* fakeSubmit(): AsyncIterable<ChatStreamChunk> {
  const tokens = FAKE_RESPONSE.split(/(\s+)/)
  for (const token of tokens) {
    await new Promise((r) => setTimeout(r, 40))
    yield { delta: token }
  }
}

export function ChatDemoClient() {
  const stream = useChatStream({ submit: fakeSubmit })
  return (
    <Box sx={{ height: "calc(100vh - 64px)" }}>
      <ChatShell>
        <ChatHeader title="AnyNote AI (demo)" />
        {stream.messages.length === 0 ? (
          <ChatEmptyState
            title="Чем помочь?"
            subtitle="Это демо-страница packages/chat. Стрим имитируется на клиенте."
            suggestions={["Объясни RAG", "Что такое outbox?", "Подскажи горячие клавиши"]}
            onSuggestion={(s: string) => stream.send(s)}
          />
        ) : (
          <MessageList messages={stream.messages} onRetry={() => stream.retry()} />
        )}
        <Composer onSubmit={stream.send} submitting={stream.isStreaming} />
      </ChatShell>
    </Box>
  )
}
