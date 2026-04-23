import type { ChatAttacmentPart, ChatToolPart } from './chat-types'

declare module '@mui/x-chat/types' {
  interface ChatCustomMessagePartMap {
    attacment: ChatAttacmentPart
    tool: ChatToolPart
  }
}

export {}
