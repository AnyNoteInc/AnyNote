import type {
  ChatDraftAttachment,
  ChatMessageStatus,
  ChatRole,
  ChatTextMessagePart,
} from "@mui/x-chat/types"

export type ChatComposerAttachment = ChatDraftAttachment

export type ChatTextPart = ChatTextMessagePart

export type ChatFilePart = {
  type: "file"
  fileId: string
  name: string
  mimeType: string
  fileSize: string
  downloadUrl: string
}

export type ChatServiceBlockState = "pending" | "running" | "done" | "error" | "required"

export type ChatServiceStatusPart = {
  type: "service-status"
  id: string
  kind: "tool" | "confirmation"
  state: ChatServiceBlockState
  title: string
  detail?: string
}

export type ChatMessagePart = ChatTextPart | ChatFilePart | ChatServiceStatusPart

export type ChatThreadMessage = {
  id: string
  role: ChatRole
  parts: ChatMessagePart[]
  createdAt?: string | Date
  updatedAt?: string | Date
  status?: ChatMessageStatus
  authorName?: string
  avatarUrl?: string
}

export type ChatSendPayload = {
  text: string
  attachments: ChatComposerAttachment[]
}
