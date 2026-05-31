import type { ChatAttacmentPart, ChatThinkingPart, ChatToolPart } from './chat-types'

declare module '@mui/x-chat/types' {
  interface ChatCustomMessagePartMap {
    attacment: ChatAttacmentPart
    thinking: ChatThinkingPart
    tool: ChatToolPart
  }
}

export {}
