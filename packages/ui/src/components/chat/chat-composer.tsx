'use client'

import AttachFileIcon from '@mui/icons-material/AttachFile'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import Stack from '@mui/material/Stack'
import {
  ChatComposer as MuiChatComposer,
  ChatComposerAttachButton,
  ChatComposerSendButton,
  ChatComposerTextArea,
} from '@mui/x-chat'
import { ChatProvider, useChatComposer, useChatStore } from '@mui/x-chat-headless'
import { useEffect, useMemo, useRef } from 'react'

import { ChatFileChip } from './chat-file-chip'
import {
  CHAT_COMPOSER_MAX_ROWS,
  CHAT_CONVERSATION_ID,
  CHAT_CONVERSATIONS,
  CHAT_MEMBERS,
  createComposerAdapter,
} from './chat-provider-utils'
import type { ChatComposerAttachment, ChatSendPayload } from './chat-types'

type ChatComposerProps = {
  value: string
  attachments: ChatComposerAttachment[]
  onValueChange: (value: string) => void
  onAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  onSend: (payload: ChatSendPayload) => void
  disabled?: boolean
  placeholder?: string
}

function getAttachmentSignature(attachments: ChatComposerAttachment[]) {
  return attachments
    .map((attachment) => {
      return `${attachment.localId}:${attachment.status}:${attachment.file.name}:${attachment.file.size}`
    })
    .join('|')
}

type ChatComposerInnerProps = {
  attachments: ChatComposerAttachment[]
  onAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  disabled: boolean
  placeholder: string
}

function ChatComposerInner({
  attachments,
  onAttachmentsChange,
  disabled,
  placeholder,
}: ChatComposerInnerProps) {
  const composer = useChatComposer()
  const store = useChatStore()
  const previousPropSignatureRef = useRef<string | null>(null)
  const syncingFromPropsRef = useRef(false)
  const propSignature = getAttachmentSignature(attachments)
  const storeSignature = getAttachmentSignature(composer.attachments)
  const hasText = composer.value.trim().length > 0

  useEffect(() => {
    const propChanged = previousPropSignatureRef.current !== propSignature
    previousPropSignatureRef.current = propSignature

    if (!propChanged || propSignature === storeSignature) {
      return
    }

    syncingFromPropsRef.current = true
    store.setComposerAttachments(attachments)
  }, [attachments, propSignature, store, storeSignature])

  useEffect(() => {
    if (syncingFromPropsRef.current) {
      if (storeSignature === propSignature) {
        syncingFromPropsRef.current = false
      }
      return
    }

    if (storeSignature !== propSignature) {
      onAttachmentsChange(composer.attachments)
    }
  }, [composer.attachments, onAttachmentsChange, propSignature, storeSignature])

  return (
    <MuiChatComposer disabled={disabled} variant="compact">
      {composer.attachments.length > 0 ? (
        <Stack direction="row" flexBasis="100%" flexWrap="wrap" gap={1}>
          {composer.attachments.map((attachment) => (
            <ChatFileChip
              key={attachment.localId}
              name={attachment.file.name}
              onDelete={() => {
                composer.removeAttachment(attachment.localId)
              }}
              secondaryLabel={attachment.status}
            />
          ))}
        </Stack>
      ) : null}
      <ChatComposerAttachButton aria-label="Attach files" disabled={disabled}>
        <AttachFileIcon />
      </ChatComposerAttachButton>
      <ChatComposerTextArea
        data-testid="chat-composer-textarea"
        disabled={disabled}
        maxRows={CHAT_COMPOSER_MAX_ROWS}
        placeholder={placeholder}
      />
      <ChatComposerSendButton aria-label="Send" disabled={disabled || !hasText}>
        <SendRoundedIcon />
      </ChatComposerSendButton>
    </MuiChatComposer>
  )
}

export function ChatComposer({
  value,
  attachments,
  onValueChange,
  onAttachmentsChange,
  onSend,
  disabled = false,
  placeholder = 'Write a message',
}: ChatComposerProps) {
  const adapter = useMemo(() => {
    return createComposerAdapter({
      disabled,
      onSend,
    })
  }, [disabled, onSend])

  return (
    <ChatProvider
      activeConversationId={CHAT_CONVERSATION_ID}
      adapter={adapter}
      composerValue={value}
      conversations={CHAT_CONVERSATIONS}
      members={CHAT_MEMBERS}
      onComposerValueChange={onValueChange}
    >
      <ChatComposerInner
        attachments={attachments}
        disabled={disabled}
        onAttachmentsChange={onAttachmentsChange}
        placeholder={placeholder}
      />
    </ChatProvider>
  )
}

export { CHAT_COMPOSER_MAX_ROWS }
