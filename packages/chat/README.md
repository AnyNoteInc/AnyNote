# @repo/chat

UI-first React package providing a complete chat shell for AnyNote's
AI assistant surfaces. Backend-agnostic — the host owns transport
(HTTP/SSE), persistence, and tool execution; this package only
renders.

## Subpath imports

```ts
import {
  ChatShell,
  ChatHeader,
  MessageList,
  Composer,
  ChatEmptyState,
} from "@repo/chat/components"

import { useChatStream, useAutoScroll, useMessageGroups } from "@repo/chat/hooks"

import type { ChatMessage, MessageRole } from "@repo/chat/types"

import { chatTokens } from "@repo/chat/theme"
```

The package root (`@repo/chat`) intentionally exports nothing — same
tree-shaking convention as `@repo/ui`.

## Quick example

```tsx
"use client"

import { ChatShell, ChatHeader, MessageList, Composer } from "@repo/chat/components"
import { useChatStream } from "@repo/chat/hooks"

export function MyChat() {
  const stream = useChatStream({
    submit: async function* (prompt) {
      const res = await fetch("/api/agents/generate", { method: "POST", body: JSON.stringify({ prompt }) })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        yield { delta: decoder.decode(value) }
      }
    },
  })

  return (
    <ChatShell>
      <ChatHeader title="AnyNote AI" />
      <MessageList messages={stream.messages} onRetry={() => stream.retry()} />
      <Composer onSubmit={stream.send} submitting={stream.isStreaming} />
    </ChatShell>
  )
}
```

## Tests

```bash
pnpm --filter @repo/chat test
```

Vitest + @testing-library/react. JSDOM environment.
