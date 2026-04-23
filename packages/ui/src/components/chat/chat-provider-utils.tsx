'use client'

import './mui-chat-augmentation'

import type {
  ChatAdapter,
  ChatConversation,
  ChatMessage,
  ChatMessageChunk,
  ChatPartRendererMap,
  ChatStreamEnvelope,
  ChatUser,
} from '@mui/x-chat-headless'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock } from './chat-service-block'
import type { ChatSendPayload, ChatThreadMessage, ChatToolPart } from './chat-types'

export const CHAT_CONVERSATION_ID = 'workspace-chat-thread'
export const CHAT_COMPOSER_MAX_ROWS = 12

export const CHAT_CONVERSATIONS: ChatConversation[] = [{ id: CHAT_CONVERSATION_ID }]
export const CHAT_MEMBERS: ChatUser[] = [
  { id: 'current-user', role: 'user' },
  { id: 'assistant-user', role: 'assistant' },
]

function createClosedStream(): ReadableStream<ChatMessageChunk | ChatStreamEnvelope> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

export const noopChatAdapter: ChatAdapter = {
  sendMessage: async () => createClosedStream(),
}

export function createComposerAdapter(args: {
  disabled?: boolean
  onSend: (payload: ChatSendPayload) => void
}): ChatAdapter {
  return {
    sendMessage: async (input) => {
      const text = extractTextFromParts(input.message.parts)
      if (!text || args.disabled) {
        return createClosedStream()
      }

      args.onSend({
        text,
        attachments: input.attachments ?? [],
      })

      return createClosedStream()
    },
  }
}

export function extractTextFromParts(
  parts: ReadonlyArray<{ type: string; text?: string }>,
): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => {
      return part.type === 'text' && typeof part.text === 'string'
    })
    .map((part) => part.text)
    .join('')
    .trim()
}

function toIsoString(value: string | Date | undefined) {
  if (!value) {
    return undefined
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

function normalizeStatus(status: ChatThreadMessage['status']): ChatMessage['status'] | undefined {
  if (!status) {
    return undefined
  }

  switch (status.toUpperCase()) {
    case 'STREAMING':
      return 'streaming'
    case 'DONE':
      return 'sent'
    case 'ERROR':
      return 'error'
    default:
      return status
  }
}

export function buildProviderMessages(messages: ChatThreadMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    author:
      message.authorName || message.avatarUrl
        ? {
            id: `author-${message.id}`,
            avatarUrl: message.avatarUrl,
            displayName: message.authorName,
            role: message.role,
          }
        : undefined,
    conversationId: CHAT_CONVERSATION_ID,
    createdAt: toIsoString(message.createdAt),
    parts: message.parts,
    role: message.role,
    status: normalizeStatus(message.status),
    updatedAt: toIsoString(message.updatedAt),
  }))
}

export const chatPartRenderers: ChatPartRendererMap = {
  attacment: ({ part }) => {
    return <ChatFileChip href={part.downloadUrl} name={part.name} secondaryLabel={part.fileSize} />
  },
  tool: ({ part }) => <ChatServiceBlock part={part as ChatToolPart} />,
}
