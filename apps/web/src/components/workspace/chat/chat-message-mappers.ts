import type {
  ChatFilePart,
  ChatMessagePart,
  ChatServiceStatusPart,
  ChatThreadMessage,
} from "@repo/ui/components"
import type { inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "@repo/trpc"

type RouterOutputs = inferRouterOutputs<AppRouter>

export type ChatQueryData = RouterOutputs["chat"]["getChat"]
export type ServerChatMessage = ChatQueryData["messages"][number]

export type DraftAttachmentSummary = Omit<ChatFilePart, "type" | "downloadUrl">

function getPartSyncKey(part: ServerChatMessage["parts"][number]) {
  switch (part.type) {
    case "text":
      return `text:${part.text}`
    case "file":
      return [
        "file",
        part.fileId,
        part.name,
        part.mimeType,
        part.fileSize,
        part.downloadUrl,
      ].join(":")
    default:
      return JSON.stringify(part)
  }
}

export function createServerMessagesSyncKey(messages: ServerChatMessage[]): string {
  return messages
    .map((message) => {
      return [
        message.id,
        message.role,
        message.status,
        message.errorMessage ?? "",
        message.createdAt,
        message.updatedAt,
        message.parts.map(getPartSyncKey).join("|"),
      ].join("~")
    })
    .join("||")
}

function mapRole(role: ServerChatMessage["role"]): ChatThreadMessage["role"] {
  return role === "USER" ? "user" : "assistant"
}

function mapStatus(
  status: "STREAMING" | "DONE" | "ERROR",
): ChatThreadMessage["status"] {
  switch (status) {
    case "STREAMING":
      return "streaming"
    case "ERROR":
      return "error"
    default:
      return "sent"
  }
}

function createErrorStatusPart(messageId: string, errorMessage: string): ChatServiceStatusPart {
  return {
    id: `${messageId}-error`,
    type: "service-status",
    kind: "tool",
    state: "error",
    title: "Ошибка генерации",
    detail: errorMessage,
  }
}

function stripServiceParts(parts: ChatMessagePart[]) {
  return parts.filter((part) => part.type !== "service-status")
}

function toServiceStatusParts(
  blocks: Array<Omit<ChatServiceStatusPart, "type">>,
): ChatServiceStatusPart[] {
  return blocks.map((block) => ({
    ...block,
    type: "service-status",
  }))
}

function withStatusParts(
  persistedParts: ChatMessagePart[],
  serviceParts: ChatServiceStatusPart[],
): ChatMessagePart[] {
  return [...persistedParts, ...serviceParts]
}

export function mapServerMessageToThreadMessage(message: ServerChatMessage): ChatThreadMessage {
  const persistedParts = [...message.parts]
  const errorParts =
    message.status === "ERROR" && message.errorMessage
      ? [createErrorStatusPart(message.id, message.errorMessage)]
      : []

  return {
    id: message.id,
    role: mapRole(message.role),
    status: mapStatus(message.status),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    parts: withStatusParts(persistedParts, errorParts),
  }
}

export function mapServerMessagesToThreadMessages(
  messages: ServerChatMessage[],
): ChatThreadMessage[] {
  return messages.map(mapServerMessageToThreadMessage)
}

export function findResumableAssistantMessageId(
  messages: ServerChatMessage[] | undefined,
): string | null {
  const lastMessage = messages?.at(-1)
  if (!lastMessage) {
    return null
  }

  if (lastMessage.role !== "ASSISTANT" || lastMessage.status !== "STREAMING") {
    return null
  }

  return lastMessage.id
}

export function createPendingMessagePair(args: {
  assistantMessageId: string
  userMessageId: string
  text: string
  attachments: DraftAttachmentSummary[]
}): ChatThreadMessage[] {
  const now = new Date().toISOString()

  return [
    {
      id: args.userMessageId,
      role: "user",
      status: "sent",
      createdAt: now,
      updatedAt: now,
      parts: [
        { type: "text", text: args.text },
        ...args.attachments.map((attachment) => ({
          type: "file" as const,
          fileId: attachment.fileId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          downloadUrl: `/api/files/${attachment.fileId}`,
        })),
      ],
    },
    {
      id: args.assistantMessageId,
      role: "assistant",
      status: "streaming",
      createdAt: now,
      updatedAt: now,
      parts: [],
    },
  ]
}

export function appendPendingMessagePair(
  messages: ChatThreadMessage[],
  args: Parameters<typeof createPendingMessagePair>[0],
): ChatThreadMessage[] {
  const withoutDuplicates = messages.filter((message) => {
    return message.id !== args.userMessageId && message.id !== args.assistantMessageId
  })

  return [...withoutDuplicates, ...createPendingMessagePair(args)]
}

export function appendAssistantText(
  messages: ChatThreadMessage[],
  assistantMessageId: string,
  text: string,
): ChatThreadMessage[] {
  if (!messages.some((message) => message.id === assistantMessageId)) {
    return messages
  }

  return messages.map((message) => {
    if (message.id !== assistantMessageId) {
      return message
    }

    const persistedParts = stripServiceParts(message.parts)
    const serviceParts = message.parts.filter(
      (part): part is ChatServiceStatusPart => part.type === "service-status",
    )
    const textIndex = persistedParts.findIndex((part) => part.type === "text")
    const nextParts = [...persistedParts]

    if (textIndex >= 0) {
      const textPart = nextParts[textIndex]
      if (textPart?.type === "text") {
        nextParts[textIndex] = {
          ...textPart,
          text: textPart.text + text,
        }
      }
    } else {
      nextParts.unshift({ type: "text", text })
    }

    return {
      ...message,
      parts: withStatusParts(nextParts, serviceParts),
      status: "streaming",
      updatedAt: new Date().toISOString(),
    }
  })
}

export function replaceAssistantServiceBlocks(
  messages: ChatThreadMessage[],
  assistantMessageId: string,
  blocks: Array<Omit<ChatServiceStatusPart, "type">>,
): ChatThreadMessage[] {
  if (!messages.some((message) => message.id === assistantMessageId)) {
    return messages
  }

  return messages.map((message) => {
    if (message.id !== assistantMessageId) {
      return message
    }

    return {
      ...message,
      parts: withStatusParts(stripServiceParts(message.parts), toServiceStatusParts(blocks)),
      updatedAt: new Date().toISOString(),
    }
  })
}

export function updateAssistantStatus(args: {
  messages: ChatThreadMessage[]
  assistantMessageId: string
  status: "STREAMING" | "DONE" | "ERROR"
  errorMessage?: string
}): ChatThreadMessage[] {
  if (!args.messages.some((message) => message.id === args.assistantMessageId)) {
    return args.messages
  }

  return args.messages.map((message) => {
    if (message.id !== args.assistantMessageId) {
      return message
    }

    const persistedParts = stripServiceParts(message.parts)
    const terminalParts =
      args.status === "ERROR" && args.errorMessage
        ? withStatusParts(persistedParts, [createErrorStatusPart(message.id, args.errorMessage)])
        : persistedParts

    return {
      ...message,
      status: mapStatus(args.status),
      parts: terminalParts,
      updatedAt: new Date().toISOString(),
    }
  })
}
