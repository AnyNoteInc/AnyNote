import type {
  ChatDraftAttachment,
  ChatMessageStatus,
  ChatRole,
  ChatTextMessagePart,
} from '@mui/x-chat/types'

export type ChatComposerAttachment = ChatDraftAttachment

export type ChatTextPart = ChatTextMessagePart

export type ChatAttacmentPart = {
  type: 'attacment'
  fileId: string
  name: string
  mimeType: string
  fileSize: string
  downloadUrl: string
}

export type ChatServiceBlockState = 'pending' | 'running' | 'done' | 'error' | 'required'

export type ChatToolPart = {
  type: 'tool'
  id: string
  kind: 'tool' | 'confirmation'
  state: ChatServiceBlockState
  title: string
  detail?: string
  result?: string
}

export type ChatMessagePart = ChatTextPart | ChatAttacmentPart | ChatToolPart

export type ChatThreadMessage = {
  id: string
  role: ChatRole
  parts: ChatMessagePart[]
  createdAt?: string | Date
  updatedAt?: string | Date
  status?: ChatMessageStatus
  authorName?: string
  avatarUrl?: string
}

export type ChatSendPayload = {
  text: string
  attachments: ChatComposerAttachment[]
}
