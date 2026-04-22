export type StreamStatus = "STREAMING" | "DONE" | "ERROR"

export type ServiceBlock = {
  id: string
  kind: "tool" | "confirmation"
  state: "pending" | "running" | "done" | "error" | "required"
  title: string
  detail?: string
}

export type AgentsStreamEvent =
  | { type: "token"; text: string }
  | ({
      type: "status"
    } & ServiceBlock)
  | { type: "done" }
  | { type: "error"; code: string; message: string }

export type WebChatSseEvent =
  | { type: "message.created"; assistantMessageId: string; userMessageId: string }
  | { type: "message.delta"; assistantMessageId: string; text: string }
  | { type: "message.service"; assistantMessageId: string; blocks: ServiceBlock[] }
  | {
      type: "message.status"
      assistantMessageId: string
      status: StreamStatus
      errorMessage?: string
    }
  | { type: "message.done"; assistantMessageId: string }

export type StartChatGenerationBody = {
  chatId: string
  text: string
  fileIds: string[]
}
