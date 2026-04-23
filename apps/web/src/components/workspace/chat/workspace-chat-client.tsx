"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import { Alert, Box, ChatThread, Stack, type ChatSendPayload } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import {
  findResumableAssistantMessageId,
  type ServerChatMessage,
} from "./chat-message-mappers"
import { useChatStream } from "./use-chat-stream"
import { useDraftAttachments } from "./use-draft-attachments"

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
  const [draft, setDraft] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)
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
      setActionError("Дождитесь завершения загрузки файлов перед отправкой.")
      return
    }

    if (draftAttachments.hasFailedUploads) {
      setActionError("Удалите файлы с ошибкой загрузки или загрузите их заново.")
      return
    }

    setActionError(null)
    const started = await send({
      attachments: draftAttachments.uploadedAttachments,
      text,
    })

    if (started) {
      setDraft("")
      draftAttachments.clear()
    }
  })

  const handleComposerSend = useEffectEvent((payload: ChatSendPayload) => {
    void handleSend(payload.text)
  })

  const handleComposerAttachmentsChange = useEffectEvent((attachments: typeof draftAttachments.attachments) => {
    setActionError(null)
    draftAttachments.syncComposerAttachments(attachments)
  })

  const handleComposerValueChange = useEffectEvent((value: string) => {
    setActionError(null)
    setDraft(value)
  })

  const combinedError = actionError ?? draftAttachments.error ?? streamError ?? query.error?.message ?? null

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        maxWidth: 960,
        mx: "auto",
        px: { xs: 1.5, sm: 2.5 },
        pt: 2,
      }}
    >
      <Stack flex={1} minHeight={0} spacing={2}>
        {combinedError ? <Alert severity="error">{combinedError}</Alert> : null}
        <ChatThread
          composerAttachments={draftAttachments.attachments}
          composerPlaceholder="Спросите что-нибудь..."
          composerValue={draft}
          disabled={isStreaming}
          messages={messages}
          onComposerAttachmentsChange={handleComposerAttachmentsChange}
          onComposerValueChange={handleComposerValueChange}
          onSend={handleComposerSend}
          scrollContainerSelector=".page-content-scroll"
          scrollKey={chatId}
        />
      </Stack>
    </Box>
  )
}
