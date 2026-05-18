'use client'

import { ChatMessage, ChatMessageList as MuiChatMessageList } from '@mui/x-chat'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
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

type ChatMessageListProps = {
  messages: ChatThreadMessage[]
  emptyTitle?: string
  emptyDescription?: string
  showEmptyState?: boolean
  scrollMode?: 'internal' | 'page'
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
}

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

function getAuthorLabel(message: ChatThreadMessage) {
  return message.authorName?.trim() || null
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

function getInitials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase())
    .join('')
}

export function ChatMessageList({
  messages,
  emptyTitle,
  emptyDescription,
  showEmptyState = true,
  scrollMode = 'internal',
  renderLink,
  onConfirm,
}: Readonly<ChatMessageListProps>) {
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
        overlay={
          showEmptyState && messages.length === 0 ? (
            <ChatEmptyState description={emptyDescription} title={emptyTitle} />
          ) : null
        }
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
          const label = getAuthorLabel(message)
          const showAvatar = !isUser && Boolean(message.avatarUrl || label)

          return (
            <ChatMessage key={message.id} messageId={message.id}>
              <Stack
                alignItems={isUser ? 'flex-end' : 'flex-start'}
                direction="row"
                justifyContent={isUser ? 'flex-end' : 'flex-start'}
                spacing={1.5}
                width="100%"
              >
                {showAvatar ? (
                  <Avatar alt={label ?? ''} src={message.avatarUrl} sx={{ width: 32, height: 32 }}>
                    {label ? getInitials(label) : null}
                  </Avatar>
                ) : null}
                <Box maxWidth={{ xs: '100%', sm: '85%', md: '76%' }}>
                  {label ? (
                    <Typography color="text.secondary" gutterBottom variant="caption">
                      {label}
                    </Typography>
                  ) : null}
                  {isEmptyStreamingAssistant ? null : (
                    <Box
                      suppressHydrationWarning
                      sx={{
                        bgcolor: isUser ? 'primary.main' : 'background.paper',
                        border: 1,
                        borderColor: isUser ? 'primary.main' : 'divider',
                        borderRadius: 3,
                        boxShadow: 1,
                        color: isUser ? 'primary.contrastText' : 'text.primary',
                        px: 1.5,
                        py: 1.25,
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
                      />
                    </Box>
                  )}
                  {timestamp || status || isEmptyStreamingAssistant ? (
                    <Typography color="text.secondary" mt={0.75} variant="caption">
                      {timestamp ? `${timestamp} • ` : null}
                      {isEmptyStreamingAssistant ? <ChatLoadingPhrases /> : status}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            </ChatMessage>
          )
        }}
        sx={{
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
