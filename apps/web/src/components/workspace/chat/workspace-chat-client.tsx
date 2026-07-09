'use client'

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'

import { Alert, Box, ChatThread, Stack, type ChatSendPayload } from '@repo/ui/components'

type ThinkingEffort = 'LOW' | 'MEDIUM' | 'HIGH'

import { trpc } from '@/trpc/client'

import { renderChatLink } from '@/components/chat/chat-link-renderer'
import { findResumableAssistantMessageId, type ServerChatMessage } from './chat-message-mappers'
import { useChatStream } from './use-chat-stream'
import { useDraftAttachments } from './use-draft-attachments'
import { buildChatHref } from './navigation'

type WorkspaceChatClientProps = {
  chatId: string | null
  workspaceId: string
  initialMessages: ServerChatMessage[]
  /** Page-panel mode (spec §7): binds new chats to the page, suppresses URL
   *  navigation, injects page/selection context on every send. */
  variant?: 'workspace' | 'page'
  pageId?: string
  getPageContext?: () => { content: string; isSelection: boolean } | null
  onChatCreated?: (chatId: string) => void
  contextChipLabel?: string | null
}

export function WorkspaceChatClient({
  chatId,
  workspaceId,
  initialMessages,
  variant = 'workspace',
  pageId,
  getPageContext,
  onChatCreated,
  contextChipLabel,
}: WorkspaceChatClientProps) {
  const [activeChatId, setActiveChatId] = useState<string | null>(chatId)
  const [draft, setDraft] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const utils = trpc.useUtils()
  const query = trpc.chat.getChat.useQuery(
    { chatId: activeChatId ?? '00000000-0000-0000-0000-000000000000' },
    { enabled: activeChatId !== null },
  )
  const createChat = trpc.chat.createChat.useMutation()
  const updateChatSettings = trpc.chat.updateChatSettings.useMutation()
  const draftAttachments = useDraftAttachments()
  const resumeAttemptRef = useRef<string | null>(null)

  const [thinking, setThinking] = useState<{ effort: ThinkingEffort } | null>(null)

  const recentFilesQuery = trpc.file.listRecent.useQuery(
    { workspaceId, limit: 5 },
    { enabled: Boolean(workspaceId) },
  )
  const recentFiles = useMemo(
    () =>
      (recentFilesQuery.data ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
      })),
    [recentFilesQuery.data],
  )

  const availableModelsQuery = trpc.aiSettings.listAvailableModels.useQuery({ workspaceId })
  const chatAiModelId = query.data?.chat.aiModelId ?? null
  // Best-effort reasoning gate: when the chat pins an explicit model we look up
  // its supportsReasoning flag; otherwise (workspace default model) we can't
  // resolve it from listAvailableModels alone, so we keep the slash command
  // enabled and let the generate route apply the real per-chat reasoning flag.
  const reasoningSupported = useMemo(() => {
    if (!chatAiModelId) return true
    const models = (availableModelsQuery.data ?? []).flatMap((provider) => provider.models)
    const model = models.find((m) => m.id === chatAiModelId)
    return model ? model.supportsReasoning : true
  }, [availableModelsQuery.data, chatAiModelId])

  useEffect(() => {
    setActiveChatId(chatId)
  }, [chatId])

  // Hydrate the local thinking chip from the persisted chat settings whenever a
  // chat loads or changes (server is the source of truth on first paint).
  const persistedUseThinking = query.data?.chat.useThinking ?? null
  const persistedThinkingEffort = (query.data?.chat.thinkingEffort ?? null) as ThinkingEffort | null
  useEffect(() => {
    if (persistedUseThinking === null) return
    setThinking(persistedUseThinking ? { effort: persistedThinkingEffort ?? 'MEDIUM' } : null)
  }, [activeChatId, persistedUseThinking, persistedThinkingEffort])

  // When the chat doesn't exist yet, settings let us create the row already
  // carrying its thinking config so the getChat hydration never observes a
  // transient `useThinking:false` that would clobber a fresh local selection
  // (see handleSelectThinking). Ignored when a chat already exists.
  const ensureChat = useEffectEvent(
    async (settings?: { useThinking?: boolean; thinkingEffort?: ThinkingEffort }) => {
      if (activeChatId) return activeChatId

      const created = await createChat.mutateAsync({
        workspaceId,
        ...(variant === 'page' && pageId ? { pageId } : {}),
        ...(settings?.useThinking !== undefined ? { useThinking: settings.useThinking } : {}),
        ...(settings?.thinkingEffort !== undefined
          ? { thinkingEffort: settings.thinkingEffort }
          : {}),
      })
      setActiveChatId(created.id)
      if (variant === 'page') {
        if (pageId) await utils.chat.listByPage.invalidate({ workspaceId, pageId })
        onChatCreated?.(created.id)
      } else {
        const href = buildChatHref(created.id)
        window.history.replaceState(null, '', href)
        await utils.chat.listChats.invalidate({ workspaceId })
      }
      return created.id
    },
  )

  const handleStreamSettled = useEffectEvent(async () => {
    await Promise.all([
      activeChatId ? utils.chat.getChat.invalidate({ chatId: activeChatId }) : Promise.resolve(),
      variant === 'page'
        ? pageId
          ? utils.chat.listByPage.invalidate({ workspaceId, pageId })
          : Promise.resolve()
        : utils.chat.listChats.invalidate({ workspaceId }),
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
    chatId: activeChatId,
    ensureChat,
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
      useThinking: thinking !== null,
      ...(thinking ? { thinkingEffort: thinking.effort } : {}),
      ...(variant === 'page' ? { pageContext: getPageContext?.() ?? undefined } : {}),
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

  const handleAttachRecent = useEffectEvent(
    (file: { id: string; name: string; fileSize: string; mimeType?: string }) => {
      setActionError(null)
      draftAttachments.addUploaded({
        fileId: file.id,
        name: file.name,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
      })
    },
  )

  const handleSelectThinking = useEffectEvent(async (effort: ThinkingEffort) => {
    setThinking({ effort })

    // New chat: create the row already carrying the thinking config so the
    // getChat hydration reads `useThinking:true` and never resets the chip we
    // just set locally. Existing chat: ensureChat returns its id unchanged, so
    // persist the change through updateChatSettings instead.
    const existingChatId = activeChatId
    const targetChatId = await ensureChat({ useThinking: true, thinkingEffort: effort })
    if (!targetChatId || existingChatId === null) return

    await updateChatSettings.mutateAsync({
      chatId: targetChatId,
      useThinking: true,
      thinkingEffort: effort,
    })
  })

  const handleClearThinking = useEffectEvent(async () => {
    setThinking(null)
    if (!activeChatId) return
    await updateChatSettings.mutateAsync({ chatId: activeChatId, useThinking: false })
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
        ...(variant === 'page'
          ? { height: '100%', px: 1 }
          : { maxWidth: 960, mx: 'auto', px: { xs: 1.5, sm: 2.5 }, pt: 2 }),
      }}
    >
      <Stack flex={1} minHeight={0} spacing={2}>
        {combinedError ? <Alert severity="error">{combinedError}</Alert> : null}
        <ChatThread
          composerAttachments={draftAttachments.attachments}
          composerAutoFocus={activeChatId === null}
          composerPlaceholder="Спросите что-нибудь..."
          composerReasoningSupported={reasoningSupported}
          composerRecentFiles={recentFiles}
          composerContextChip={
            variant === 'page' ? { label: contextChipLabel ?? 'Контекст: Текущая страница' } : null
          }
          composerThinking={thinking}
          composerValue={draft}
          disabled={isStreaming || createChat.isPending}
          messages={messages}
          onComposerAttachRecent={handleAttachRecent}
          onComposerAttachmentsChange={handleComposerAttachmentsChange}
          onComposerClearThinking={handleClearThinking}
          onComposerSelectThinking={handleSelectThinking}
          onComposerValueChange={handleComposerValueChange}
          onConfirm={handleConfirm}
          onSend={handleComposerSend}
          renderLink={renderChatLink}
          scrollContainerSelector={variant === 'page' ? undefined : '.page-content-scroll'}
          scrollKey={activeChatId ?? 'new-chat'}
        />
      </Stack>
    </Box>
  )
}
