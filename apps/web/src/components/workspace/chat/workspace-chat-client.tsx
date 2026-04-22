"use client"

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import { Alert, Box, ChatThread, Stack } from "@repo/ui/components"

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
    await query.refetch()
  })

  const stream = useChatStream({
    chatId,
    initialMessages,
    onSettled: handleStreamSettled,
  })

  const serverMessages = useMemo(
    () => query.data?.messages ?? initialMessages,
    [initialMessages, query.data?.messages],
  )

  useEffect(() => {
    stream.replaceFromServer(serverMessages)
  }, [serverMessages, stream])

  const resumableAssistantMessageId = useMemo(
    () => findResumableAssistantMessageId(serverMessages),
    [serverMessages],
  )

  useEffect(() => {
    if (!resumableAssistantMessageId) {
      resumeAttemptRef.current = null
      return
    }

    if (stream.isStreaming || resumeAttemptRef.current === resumableAssistantMessageId) {
      return
    }

    resumeAttemptRef.current = resumableAssistantMessageId
    void stream.resume(resumableAssistantMessageId)
  }, [resumableAssistantMessageId, stream])

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
    const started = await stream.send({
      attachments: draftAttachments.uploadedAttachments,
      text,
    })

    if (started) {
      setDraft("")
      draftAttachments.clear()
    }
  })

  const combinedError = actionError ?? draftAttachments.error ?? stream.error ?? query.error?.message ?? null

  return (
    <Box sx={{ height: "100%", width: "100%" }}>
      <Box
        sx={{
          height: "100%",
          maxWidth: 960,
          mx: "auto",
          px: { xs: 1.5, sm: 2.5 },
          py: 2,
        }}
      >
        <Stack height="100%" spacing={2}>
          {combinedError ? <Alert severity="error">{combinedError}</Alert> : null}
          <ChatThread
            composerAttachments={draftAttachments.attachments}
            composerPlaceholder="Спросите что-нибудь..."
            composerValue={draft}
            disabled={stream.isStreaming}
            messages={stream.messages}
            onComposerAttachmentsChange={(attachments) => {
              setActionError(null)
              draftAttachments.syncComposerAttachments(attachments)
            }}
            onComposerValueChange={(value) => {
              setActionError(null)
              setDraft(value)
            }}
            onSend={({ text }) => {
              void handleSend(text)
            }}
          />
        </Stack>
      </Box>
    </Box>
  )
}
