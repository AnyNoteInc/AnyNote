import type { ChatThreadMessage } from '@repo/ui/components'

import { createPendingMessagePair, type DraftAttachmentSummary } from './chat-message-mappers'

// Monotonic, module-level counter so temp ids are deterministic and unique
// within a session. We deliberately avoid Date.now()/Math.random() so the ids
// are stable under test/replay and never collide within a single send burst.
let optimisticCounter = 0

export const OPTIMISTIC_USER_ID_PREFIX = 'temp-user-'
export const OPTIMISTIC_ASSISTANT_ID_PREFIX = 'temp-asst-'

export type OptimisticPair = {
  userMessage: ChatThreadMessage
  assistantMessage: ChatThreadMessage
}

/**
 * Builds the optimistic user + assistant message pair shown the instant the
 * user hits send, before the `/api/agents/generate` SSE round-trip resolves.
 *
 * The pair is produced by the same `createPendingMessagePair` builder that
 * `message.created` uses, so the part shapes (text + attachment) and statuses
 * ('sent' user, 'streaming' assistant) are identical to the real pair. The ids
 * are temporary (`temp-user-*` / `temp-asst-*`) and get reconciled to the real
 * server ids when `message.created` arrives.
 */
export function buildOptimisticPair(args: {
  text: string
  attachments: DraftAttachmentSummary[]
}): OptimisticPair {
  const id = (optimisticCounter += 1)
  const userMessageId = `${OPTIMISTIC_USER_ID_PREFIX}${id}`
  const assistantMessageId = `${OPTIMISTIC_ASSISTANT_ID_PREFIX}${id}`

  const [userMessage, assistantMessage] = createPendingMessagePair({
    assistantMessageId,
    userMessageId,
    text: args.text,
    attachments: args.attachments,
  })

  return { userMessage, assistantMessage }
}
