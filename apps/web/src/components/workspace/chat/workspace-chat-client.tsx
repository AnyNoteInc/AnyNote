'use client'

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { Alert, Box, ChatThread, Stack, type ChatSendPayload } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import {
  ConfirmationDialog,
  type PendingConfirmation,
} from '@/components/chat/ConfirmationDialog'
import { PlanPanel, type PlanStepView } from '@/components/chat/PlanPanel'
import { renderChatLink } from '@/components/chat/chat-link-renderer'
import { findResumableAssistantMessageId, type ServerChatMessage } from './chat-message-mappers'
import { useChatStream } from './use-chat-stream'
import { useDraftAttachments } from './use-draft-attachments'

type WorkspaceChatClientProps = {
  chatId: string
  workspaceId: string
  initialMessages: ServerChatMessage[]
}

export function WorkspaceChatClient({
  chatId,
  workspaceId,
  initialMessages,
}: WorkspaceChatClientProps) {
  const [draft, setDraft] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [planSteps, setPlanSteps] = useState<PlanStepView[]>([])
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)
  const utils = trpc.useUtils()
  const query = trpc.chat.getChat.useQuery({ chatId })
  const draftAttachments = useDraftAttachments(workspaceId)
  const resumeAttemptRef = useRef<string | null>(null)

  const handleStreamSettled = useEffectEvent(async () => {
    await Promise.all([
      utils.chat.getChat.invalidate({ chatId }),
      utils.chat.listChats.invalidate({ workspaceId }),
    ])
  })

  const {
    confirmResume,
    error: streamError,
    isStreaming,
    messages,
    replaceFromServer,
    resume,
    send,
  } = useChatStream({
    chatId,
    initialMessages,
    onSettled: handleStreamSettled,
    onPlanStep: (event) => {
      const view: PlanStepView = {
        id: event.id,
        title: event.title,
        position: event.position,
        status: event.status,
      }
      setPlanSteps((prev) => {
        const idx = prev.findIndex((s) => s.id === view.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = view
          return next
        }
        return [...prev, view]
      })
    },
    onConfirmationRequired: (event) => {
      setPendingConfirmation({
        confirmationId: event.confirmation_id,
        tool: event.tool,
        summary: event.summary,
        argsPreview: event.args_preview,
      })
    },
  })

  const serverMessages = useMemo(
    () => query.data?.messages ?? initialMessages,
    [initialMessages, query.data?.messages],
  )

  useEffect(() => {
    replaceFromServer(serverMessages)
  }, [replaceFromServer, serverMessages])

  const resumableAssistantMessageId = useMemo(
    () => findResumableAssistantMessageId(serverMessages),
    [serverMessages],
  )

  useEffect(() => {
    if (!resumableAssistantMessageId) {
      resumeAttemptRef.current = null
      return
    }

    if (isStreaming || resumeAttemptRef.current === resumableAssistantMessageId) {
      return
    }

    resumeAttemptRef.current = resumableAssistantMessageId
    void resume(resumableAssistantMessageId)
  }, [isStreaming, resumableAssistantMessageId, resume])

  const handleSend = useEffectEvent(async (text: string) => {
    if (draftAttachments.hasPendingUploads) {
      setActionError('Дождитесь завершения загрузки файлов перед отправкой.')
      return
    }

    if (draftAttachments.hasFailedUploads) {
      setActionError('Удалите файлы с ошибкой загрузки или загрузите их заново.')
      return
    }

    setActionError(null)
    const started = await send({
      attachments: draftAttachments.uploadedAttachments,
      text,
    })

    if (started) {
      setDraft('')
      draftAttachments.clear()
    }
  })

  const handleComposerSend = useEffectEvent((payload: ChatSendPayload) => {
    void handleSend(payload.text)
  })

  const handleComposerAttachmentsChange = useEffectEvent(
    (attachments: typeof draftAttachments.attachments) => {
      setActionError(null)
      draftAttachments.syncComposerAttachments(attachments)
    },
  )

  const handleComposerValueChange = useEffectEvent((value: string) => {
    setActionError(null)
    setDraft(value)
  })

  const handleConfirm = useCallback(
    async (confirmationId: string, action: 'allow' | 'deny') => {
      await confirmResume(confirmationId, action)
    },
    [confirmResume],
  )

  const combinedError =
    actionError ?? draftAttachments.error ?? streamError ?? query.error?.message ?? null

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        maxWidth: 960,
        mx: 'auto',
        px: { xs: 1.5, sm: 2.5 },
        pt: 2,
      }}
    >
      <Stack flex={1} minHeight={0} spacing={2}>
        {combinedError ? <Alert severity="error">{combinedError}</Alert> : null}
        <PlanPanel steps={planSteps} />
        <ChatThread
          composerAttachments={draftAttachments.attachments}
          composerPlaceholder="Спросите что-нибудь..."
          composerValue={draft}
          disabled={isStreaming}
          messages={messages}
          onComposerAttachmentsChange={handleComposerAttachmentsChange}
          onComposerValueChange={handleComposerValueChange}
          onConfirm={handleConfirm}
          onSend={handleComposerSend}
          renderLink={renderChatLink}
          scrollContainerSelector=".page-content-scroll"
          scrollKey={chatId}
        />
      </Stack>
      <ConfirmationDialog
        pending={pendingConfirmation}
        onResolve={() => setPendingConfirmation(null)}
      />
    </Box>
  )
}
