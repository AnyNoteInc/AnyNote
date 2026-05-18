'use client'

import { useEffect, useEffectEvent, useRef, useState, startTransition } from 'react'

import type { ChatThreadMessage } from '@repo/ui/components'

import { decodeWebSseEvents } from '@/lib/chat/sse'
import type { ConfirmationRequiredEvent, PlanStepEvent, WebChatSseEvent } from '@/lib/chat/types'

import {
  appendAssistantText,
  appendPendingMessagePair,
  createServerMessagesSyncKey,
  findAssistantMessageIdByBlockId,
  mapServerMessagesToThreadMessages,
  replaceAssistantToolBlocks,
  updateAssistantStatus,
  type DraftAttachmentSummary,
  type ServerChatMessage,
} from './chat-message-mappers'

type PendingSend = {
  attachments: DraftAttachmentSummary[]
  text: string
}

type UseChatStreamArgs = {
  chatId: string
  initialMessages: ServerChatMessage[]
  onSettled?: () => void | Promise<void>
  onPlanStep?: (event: PlanStepEvent) => void
  onConfirmationRequired?: (event: ConfirmationRequiredEvent) => void
}

type StartSendArgs = PendingSend

function getErrorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback
}

export function useChatStream({
  chatId,
  initialMessages,
  onSettled,
  onPlanStep,
  onConfirmationRequired,
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
  const streamControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const resetStream = useEffectEvent(() => {
    activeAssistantMessageIdRef.current = null
    pendingSendRef.current = null
    streamControllerRef.current = null
    setIsStreaming(false)
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
        setMessages((current) => appendAssistantText(current, event.assistantMessageId, event.text))
        return
      }

      case 'message.service': {
        setMessages((current) =>
          replaceAssistantToolBlocks(
            current,
            event.assistantMessageId,
            event.blocks.map((block) => ({
              id: block.id,
              kind: block.kind,
              state: block.state,
              title: block.title,
              detail: block.detail,
              result: block.result,
            })),
          ),
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

      case 'plan_step': {
        onPlanStep?.(event)
        return
      }

      case 'confirmation_required': {
        onConfirmationRequired?.(event)
        return
      }
    }
  })

  const consumeResponse = useEffectEvent(
    async (response: Response, controller: AbortController) => {
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setError(payload?.error ?? `Запрос завершился с ошибкой ${response.status}.`)
        resetStream()
        return false
      }

      if (!response.body) {
        setError('Пустой поток ответа.')
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

      setError(getErrorMessage(requestError, 'Не удалось открыть поток ответа.'))
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

  const send = useEffectEvent(async ({ attachments, text }: StartSendArgs) => {
    const trimmedText = text.trim()
    if (!trimmedText) {
      return false
    }

    pendingSendRef.current = {
      attachments,
      text: trimmedText,
    }

    return await openStream((signal) =>
      fetch('/api/agents/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          chatId,
          text: trimmedText,
          fileIds: attachments.map((attachment) => attachment.fileId),
        }),
        signal,
      }),
    )
  })

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

  return {
    // NOSONAR(typescript:S6440): confirmResume is intentionally exposed so the
    // chat page can fire it from a click handler (Allow/Deny). The other
    // returned callbacks (send/resume/replaceFromServer) follow the same
    // pattern — useEffectEvent is what gives us a stable reference without
    // triggering re-renders inside the streaming loop.
    confirmResume,
    error,
    isStreaming,
    messages,
    replaceFromServer,
    resume,
    send,
  }
}
