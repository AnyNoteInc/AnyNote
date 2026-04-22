"use client"

import Stack from "@mui/material/Stack"

import { ChatComposer } from "./chat-composer"
import { ChatMessageList } from "./chat-message-list"
import type { ChatComposerAttachment, ChatSendPayload, ChatThreadMessage } from "./chat-types"

type ChatThreadProps = {
  messages: ChatThreadMessage[]
  composerValue: string
  composerAttachments: ChatComposerAttachment[]
  onComposerValueChange: (value: string) => void
  onComposerAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  onSend: (payload: ChatSendPayload) => void
  composerPlaceholder?: string
  disabled?: boolean
  emptyTitle?: string
  emptyDescription?: string
}

export function ChatThread({
  messages,
  composerValue,
  composerAttachments,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onSend,
  composerPlaceholder,
  disabled,
  emptyTitle,
  emptyDescription,
}: ChatThreadProps) {
  return (
    <Stack height="100%" minHeight={0} spacing={2}>
      <ChatMessageList
        emptyDescription={emptyDescription}
        emptyTitle={emptyTitle}
        messages={messages}
      />
      <ChatComposer
        attachments={composerAttachments}
        disabled={disabled}
        onAttachmentsChange={onComposerAttachmentsChange}
        onSend={onSend}
        onValueChange={onComposerValueChange}
        placeholder={composerPlaceholder}
        value={composerValue}
      />
    </Stack>
  )
}
