'use client'

import { useEffect, useEffectEvent, useRef, useState, startTransition } from 'react'

import type { ChatThreadMessage } from '@repo/ui/components'

import { decodeWebSseEvents } from '@/lib/chat/sse'
import type { WebChatSseEvent } from '@/lib/chat/types'

import {
  appendAssistantTextDelta,
  appendAssistantThinking,
  appendPendingMessagePair,
  createServerMessagesSyncKey,
  findAssistantMessageIdByBlockId,
  mapServerMessagesToThreadMessages,
  markAssistantErrored,
  reconcileOptimisticIds,
  replaceAssistantSegments,
  updateAssistantStatus,
  type DraftAttachmentSummary,
  type ServerChatMessage,
} from './chat-message-mappers'
import { buildOptimisticPair } from './optimistic'

type ThinkingEffort = 'LOW' | 'MEDIUM' | 'HIGH'

type PendingSend = {
  attachments: DraftAttachmentSummary[]
  text: string
}

type SendOptions = {
  useThinking?: boolean
  thinkingEffort?: ThinkingEffort
}

type UseChatStreamArgs = {
  chatId: string | null
  ensureChat?: () => Promise<string | null>
  initialMessages: ServerChatMessage[]
  onSettled?: () => void | Promise<void>
}

type StartSendArgs = PendingSend & SendOptions

function getErrorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback
}

export function useChatStream({
  chatId,
  ensureChat,
  initialMessages,
  onSettled,
}: UseChatStreamArgs) {
  const [error, setError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [messages, setMessages] = useState<ChatThreadMessage[]>(() =>
    mapServerMessagesToThreadMessages(initialMessages),
  )
  const activeAssistantMessageIdRef = useRef<string | null>(null)
  const lastServerSyncKeyRef = useRef(createServerMessagesSyncKey(initialMessages))
  const messagesRef = useRef(messages)
  const pendingSendRef = useRef<PendingSend | null>(null)
  const optimisticPairRef = useRef<{ userId: string; assistantId: string } | null>(null)
  const streamControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const resetStream = useEffectEvent(() => {
    activeAssistantMessageIdRef.current = null
    pendingSendRef.current = null
    optimisticPairRef.current = null
    streamControllerRef.current = null
    setIsStreaming(false)
  })

  // When a send fails before any stream is produced (non-ok response, empty
  // body, or the fetch itself rejecting), the optimistic assistant placeholder
  // is still on screen showing the streaming spinner. Flip it to an error
  // bubble so we never leave a dangling streaming placeholder. No-op once
  // message.created has reconciled the ids (the optimistic ref is cleared).
  const failOptimisticAssistant = useEffectEvent((errorMessage: string) => {
    const optimisticPair = optimisticPairRef.current
    if (!optimisticPair) {
      return
    }

    setMessages((current) =>
      markAssistantErrored(current, optimisticPair.assistantId, errorMessage),
    )
  })

  const finishStream = useEffectEvent(async () => {
    resetStream()
    await onSettled?.()
  })

  const applyEvent = useEffectEvent((event: WebChatSseEvent) => {
    switch (event.type) {
      case 'message.created': {
        const pendingSend = pendingSendRef.current
        if (!pendingSend) {
          return
        }

        activeAssistantMessageIdRef.current = event.assistantMessageId

        const optimisticPair = optimisticPairRef.current
        if (optimisticPair) {
          // The pair is already on screen (inserted optimistically the instant
          // the user hit send). Reconcile the temp ids to the real server ids
          // in place — appending a fresh pair here would duplicate it.
          optimisticPairRef.current = null
          setMessages((current) =>
            reconcileOptimisticIds(current, {
              optimisticUserId: optimisticPair.userId,
              optimisticAssistantId: optimisticPair.assistantId,
              userMessageId: event.userMessageId,
              assistantMessageId: event.assistantMessageId,
            }),
          )
          return
        }

        // Fallback (e.g. resume paths that did not insert optimistically):
        // build the pair from the real ids.
        setMessages((current) =>
          appendPendingMessagePair(current, {
            assistantMessageId: event.assistantMessageId,
            userMessageId: event.userMessageId,
            attachments: pendingSend.attachments,
            text: pendingSend.text,
          }),
        )
        return
      }

      case 'message.delta': {
        activeAssistantMessageIdRef.current = event.assistantMessageId
        setMessages((current) =>
          appendAssistantTextDelta(
            current,
            event.assistantMessageId,
            event.segmentIndex,
            event.text,
          ),
        )
        return
      }

      case 'message.segments': {
        activeAssistantMessageIdRef.current = event.assistantMessageId
        setMessages((current) =>
          replaceAssistantSegments(current, event.assistantMessageId, event.segments),
        )
        return
      }

      case 'message.thinking': {
        activeAssistantMessageIdRef.current = event.assistantMessageId
        setMessages((current) =>
          appendAssistantThinking(current, event.assistantMessageId, event.text),
        )
        return
      }

      case 'message.status': {
        setMessages((current) =>
          updateAssistantStatus({
            messages: current,
            assistantMessageId: event.assistantMessageId,
            status: event.status,
            errorMessage: event.errorMessage,
          }),
        )
        return
      }

      case 'message.done': {
        void finishStream()
        return
      }

      // plan_step and confirmation_required events are no longer surfaced via
      // callbacks: confirmations now render inline through message.segments tool
      // segments (see ChatConfirmInline), and the plan panel was removed.
      default:
        return
    }
  })

  const consumeResponse = useEffectEvent(
    async (response: Response, controller: AbortController) => {
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        const message = payload?.error ?? `Запрос завершился с ошибкой ${response.status}.`
        setError(message)
        failOptimisticAssistant(message)
        resetStream()
        return false
      }

      if (!response.body) {
        const message = 'Пустой поток ответа.'
        setError(message)
        failOptimisticAssistant(message)
        resetStream()
        return false
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }

          const decoded = decoder.decode(value, { stream: true })
          const parsed = decodeWebSseEvents({ buffer, chunk: decoded })
          buffer = parsed.buffer

          for (const event of parsed.events) {
            applyEvent(event)
          }
        }
      } catch (streamError) {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(streamError, 'Поток ответа был прерван.'))
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
        if (activeAssistantMessageIdRef.current !== null || pendingSendRef.current !== null) {
          await finishStream()
        }
      }

      return true
    },
  )

  const openStream = useEffectEvent(async (request: (signal: AbortSignal) => Promise<Response>) => {
    if (isStreaming) {
      return false
    }

    const controller = new AbortController()
    streamControllerRef.current = controller
    setError(null)
    setIsStreaming(true)

    try {
      const response = await request(controller.signal)
      return await consumeResponse(response, controller)
    } catch (requestError) {
      if (controller.signal.aborted) {
        return false
      }

      const message = getErrorMessage(requestError, 'Не удалось открыть поток ответа.')
      setError(message)
      failOptimisticAssistant(message)
      resetStream()
      return false
    }
  })

  const replaceFromServer = useEffectEvent((serverMessages: ServerChatMessage[]) => {
    if (isStreaming) {
      return
    }

    const nextServerSyncKey = createServerMessagesSyncKey(serverMessages)
    if (lastServerSyncKeyRef.current === nextServerSyncKey) {
      return
    }

    lastServerSyncKeyRef.current = nextServerSyncKey

    startTransition(() => {
      setMessages(mapServerMessagesToThreadMessages(serverMessages))
    })
  })

  const send = useEffectEvent(
    async ({ attachments, text, useThinking, thinkingEffort }: StartSendArgs) => {
      const trimmedText = text.trim()
      if (!trimmedText || isStreaming) {
        return false
      }

      const targetChatId = chatId ?? (await ensureChat?.())
      if (!targetChatId) {
        setError('Не удалось создать чат.')
        return false
      }

      pendingSendRef.current = {
        attachments,
        text: trimmedText,
      }

      // Optimistic insert: show the user's message and an empty streaming
      // assistant placeholder immediately, before the /api/agents/generate SSE
      // round-trip. message.created later reconciles these temp ids to the real
      // server ids (see applyEvent). Point activeAssistantMessageIdRef at the
      // temp assistant so any delta arriving ahead of message.created targets
      // the placeholder.
      const { userMessage, assistantMessage } = buildOptimisticPair({
        attachments,
        text: trimmedText,
      })
      optimisticPairRef.current = { userId: userMessage.id, assistantId: assistantMessage.id }
      activeAssistantMessageIdRef.current = assistantMessage.id
      setMessages((current) => [...current, userMessage, assistantMessage])

      return await openStream((signal) =>
        fetch('/api/agents/generate', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            chatId: targetChatId,
            text: trimmedText,
            fileIds: attachments.map((attachment) => attachment.fileId),
            ...(useThinking !== undefined ? { useThinking } : {}),
            ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
          }),
          signal,
        }),
      )
    },
  )

  const confirmResume = useEffectEvent(
    async (confirmationId: string, action: 'allow' | 'deny') => {
      if (isStreaming) return false
      const targetMessageId = findAssistantMessageIdByBlockId(messagesRef.current, confirmationId)
      if (!targetMessageId) {
        setError('Не найдено сообщение с подтверждением.')
        return false
      }
      activeAssistantMessageIdRef.current = targetMessageId
      return await openStream((signal) =>
        fetch('/api/agent/resume', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatId, confirmationId, action }),
          signal,
        }),
      )
    },
  )

  const resume = useEffectEvent(async (assistantMessageId: string) => {
    if (!assistantMessageId || isStreaming) {
      return false
    }

    activeAssistantMessageIdRef.current = assistantMessageId
    return await openStream((signal) =>
      fetch(`/api/agents/streams/${assistantMessageId}`, {
        headers: {
          Accept: 'text/event-stream',
        },
        signal,
      }),
    )
  })

  useEffect(() => {
    return () => {
      streamControllerRef.current?.abort()
    }
  }, [])

  // confirmResume is intentionally exposed so the chat page can fire it from
  // a click handler (Allow/Deny). The other returned callbacks
  // (send/resume/replaceFromServer) follow the same pattern — useEffectEvent
  // gives a stable reference without re-renders inside the streaming loop.
  return {
    confirmResume, // NOSONAR — S6440: useEffectEvent intentionally returned for click-handler use; whole hook uses this pattern
    error,
    isStreaming,
    messages,
    replaceFromServer,
    resume,
    send,
  }
}
