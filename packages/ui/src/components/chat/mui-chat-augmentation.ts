import type { ChatFilePart, ChatServiceStatusPart } from "./chat-types"

declare module "@mui/x-chat/types" {
  interface ChatCustomMessagePartMap {
    file: ChatFilePart
    "service-status": ChatServiceStatusPart
  }
}

export {}
