import { useMemo } from "react"
import type { ChatMessage, MessageGroup } from "../types/index"

export function useMessageGroups(messages: ChatMessage[]): MessageGroup[] {
  return useMemo(() => groupMessages(messages), [messages])
}

export function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    if (last && last.role === m.role) {
      last.messages.push(m)
    } else {
      groups.push({ key: m.id, role: m.role, messages: [m] })
    }
  }
  return groups
}
