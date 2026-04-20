export type MessageRole = "user" | "assistant" | "system" | "tool"

export type MessageStatus = "sending" | "streaming" | "done" | "error"

export type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "markdown"; text: string }
  | { type: "code"; language?: string; code: string }
  | { type: "tool_call"; toolCallId: string }
  | { type: "attachment"; attachmentId: string }

export interface ChatAttachment {
  id: string
  kind: "image" | "file" | "audio" | "pdf"
  name: string
  mimeType?: string
  sizeBytes?: number
  url?: string
  previewUrl?: string
  status?: "uploading" | "uploaded" | "error"
}

export interface ChatToolCall {
  id: string
  toolName: string
  title?: string
  status: "queued" | "running" | "success" | "error"
  input?: unknown
  output?: unknown
  startedAt?: string | Date
  finishedAt?: string | Date
  errorMessage?: string
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content?: string
  parts?: ChatMessagePart[]
  attachments?: ChatAttachment[]
  toolCalls?: ChatToolCall[]
  status?: MessageStatus
  errorMessage?: string
  createdAt?: string | Date
}

export interface ChatStreamChunk {
  delta: string
}

export interface MessageGroup {
  key: string
  role: MessageRole
  messages: ChatMessage[]
}
