'use client'

import { ChatMessage, ChatMessageList as MuiChatMessageList } from '@mui/x-chat'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { ChatProvider } from '@mui/x-chat-headless'
import { useMemo } from 'react'

import { ChatEmptyState } from './chat-empty-state'
import { ChatLoadingPhrases } from './chat-loading-phrases'
import { ChatMessageContent, type ChatRenderLink } from './chat-message-content'
import {
  buildChatPartRenderers,
  buildProviderMessages,
  CHAT_CONVERSATION_ID,
  CHAT_CONVERSATIONS,
  CHAT_MEMBERS,
  noopChatAdapter,
} from './chat-provider-utils'
import type { ChatConfirmHandler, ChatThreadMessage } from './chat-types'

type ChatMessageListProps = Readonly<{
  messages: ChatThreadMessage[]
  emptyTitle?: string
  emptyDescription?: string
  showEmptyState?: boolean
  scrollMode?: 'internal' | 'page'
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
}>

function formatTimestamp(value: ChatThreadMessage['createdAt']) {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

function getStatusLabel(message: ChatThreadMessage) {
  if (!message.status) {
    return null
  }

  switch (message.status) {
    case 'sent':
      return 'Отправлено'
    case 'streaming':
      return 'Печатает'
    case 'error':
      return 'Ошибка'
    default:
      return message.status[0]?.toUpperCase() + message.status.slice(1)
  }
}

export function ChatMessageList({
  messages,
  // emptyTitle / emptyDescription stay on the props type (still passed by
  // ChatThread) but the empty state now shows a random greeting, so the list
  // no longer threads fixed copy through to it.
  showEmptyState = true,
  scrollMode = 'internal',
  renderLink,
  onConfirm,
}: ChatMessageListProps) {
  const providerMessages = useMemo(() => buildProviderMessages(messages), [messages])
  const partRenderers = useMemo(() => buildChatPartRenderers({ onConfirm }), [onConfirm])
  const usesPageScroll = scrollMode === 'page'

  return (
    <ChatProvider
      activeConversationId={CHAT_CONVERSATION_ID}
      adapter={noopChatAdapter}
      conversations={CHAT_CONVERSATIONS}
      members={CHAT_MEMBERS}
      messages={providerMessages}
      partRenderers={partRenderers}
    >
      <MuiChatMessageList
        autoScroll={!usesPageScroll}
        data-scroll-mode={scrollMode}
        data-testid="chat-message-list"
        items={providerMessages.map((message) => message.id)}
        overlay={showEmptyState && messages.length === 0 ? <ChatEmptyState /> : null}
        renderItem={({ id, index }) => {
          const message = messages[index]

          if (!message || message.id !== id) {
            return null
          }

          const isUser = message.role === 'user'
          const isEmptyStreamingAssistant =
            message.role === 'assistant' &&
            message.status === 'streaming' &&
            message.parts.length === 0
          const timestamp = formatTimestamp(message.createdAt)
          const status = getStatusLabel(message)

          return (
            <ChatMessage key={message.id} messageId={message.id}>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  ml: isUser ? 'auto' : 0,
                  maxWidth: isUser ? { xs: '100%', sm: '88%' } : '100%',
                  width: isUser ? 'fit-content' : '100%',
                }}
              >
                {isEmptyStreamingAssistant ? null : (
                  <Box
                    suppressHydrationWarning
                    sx={{
                      color: 'text.primary',
                      ...(isUser
                        ? {
                            bgcolor: 'action.hover',
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 3,
                            px: 2,
                            py: 1.25,
                          }
                        : null),
                      '& .MuiChatMessage-bubble': {
                        backgroundColor: 'transparent',
                        borderRadius: 0,
                        padding: 0,
                      },
                    }}
                  >
                    <ChatMessageContent
                      onConfirm={onConfirm}
                      parts={message.parts}
                      renderLink={renderLink}
                      variant={isUser ? 'user' : 'assistant'}
                    />
                  </Box>
                )}
                {timestamp || status || isEmptyStreamingAssistant ? (
                  <Typography
                    color="text.secondary"
                    mt={0.75}
                    sx={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}
                    variant="caption"
                  >
                    {timestamp ? `${timestamp} • ` : null}
                    {isEmptyStreamingAssistant ? <ChatLoadingPhrases /> : status}
                  </Typography>
                ) : null}
              </Box>
            </ChatMessage>
          )
        }}
        sx={{
          // @mui/x-chat paints its root with palette.background.default (cream);
          // the chat output area should inherit the white page canvas instead.
          backgroundColor: 'transparent',
          flex: usesPageScroll ? 'none' : 1,
          minHeight: usesPageScroll ? 'auto' : 0,
          overflow: 'visible',
          px: 2,
          py: 2,
          ...(usesPageScroll
            ? {
                '& .MuiChatMessageList-scroller': {
                  overflowY: 'visible !important',
                  overscrollBehavior: 'auto !important',
                },
                '& .MuiChatMessageList-content': {
                  minHeight: 'auto',
                },
              }
            : null),
        }}
      />
    </ChatProvider>
  )
}
