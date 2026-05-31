'use client'

import AddIcon from '@mui/icons-material/Add'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import {
  ChatComposer as MuiChatComposer,
  ChatComposerSendButton,
  ChatComposerTextArea,
} from '@mui/x-chat'
import { ChatProvider, useChatComposer, useChatStore } from '@mui/x-chat-headless'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { ChatFileChip } from './chat-file-chip'
import {
  CHAT_COMPOSER_MAX_ROWS,
  CHAT_CONVERSATION_ID,
  CHAT_CONVERSATIONS,
  CHAT_MEMBERS,
  createComposerAdapter,
} from './chat-provider-utils'
import type { ChatComposerAttachment, ChatSendPayload } from './chat-types'

export type ChatComposerThinkingEffort = 'LOW' | 'MEDIUM' | 'HIGH'

export type ChatComposerRecentFile = {
  id: string
  name: string
  fileSize: string
  mimeType?: string
}

type ChatComposerProps = Readonly<{
  value: string
  attachments: ChatComposerAttachment[]
  onValueChange: (value: string) => void
  onAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  onSend: (payload: ChatSendPayload) => void
  disabled?: boolean
  placeholder?: string
  recentFiles?: ReadonlyArray<ChatComposerRecentFile>
  onAttachRecent?: (file: ChatComposerRecentFile) => void
  reasoningSupported?: boolean
  onSelectThinking?: (effort: ChatComposerThinkingEffort) => void
  thinking?: { effort: ChatComposerThinkingEffort } | null
  onClearThinking?: () => void
}>

const THINKING_EFFORTS: ReadonlyArray<{ effort: ChatComposerThinkingEffort; label: string }> = [
  { effort: 'LOW', label: 'Низкое' },
  { effort: 'MEDIUM', label: 'Среднее' },
  { effort: 'HIGH', label: 'Высокое' },
]

const THINKING_EFFORT_LABEL: Record<ChatComposerThinkingEffort, string> = {
  LOW: 'Низкое',
  MEDIUM: 'Среднее',
  HIGH: 'Высокое',
}

/**
 * Mirror of `parseSlashCommand` (apps/web/.../slash-commands.ts, the canonical,
 * unit-tested copy). Duplicated here because `@repo/ui` sits below the app in the
 * dependency graph and cannot import from it; keep the two predicates in sync.
 */
function isSlashMenuOpen(value: string): boolean {
  if (!value.startsWith('/')) return false
  const rest = value.slice(1)
  return !rest.includes(' ') && !rest.includes('\n')
}

function slashQuery(value: string): string {
  return value.startsWith('/') ? value.slice(1) : ''
}

function getAttachmentSignature(attachments: ChatComposerAttachment[]) {
  return attachments
    .map((attachment) => {
      return `${attachment.localId}:${attachment.status}:${attachment.file.name}:${attachment.file.size}`
    })
    .join('|')
}

type ChatComposerInnerProps = Readonly<{
  attachments: ChatComposerAttachment[]
  onAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  disabled: boolean
  placeholder: string
  recentFiles: ReadonlyArray<ChatComposerRecentFile>
  onAttachRecent?: (file: ChatComposerRecentFile) => void
  reasoningSupported: boolean
  onSelectThinking?: (effort: ChatComposerThinkingEffort) => void
  thinking?: { effort: ChatComposerThinkingEffort } | null
  onClearThinking?: () => void
}>

function ChatComposerInner({
  attachments,
  onAttachmentsChange,
  disabled,
  placeholder,
  recentFiles,
  onAttachRecent,
  reasoningSupported,
  onSelectThinking,
  thinking,
  onClearThinking,
}: ChatComposerInnerProps) {
  const composer = useChatComposer()
  const store = useChatStore()
  const previousPropSignatureRef = useRef<string | null>(null)
  const syncingFromPropsRef = useRef(false)
  const propSignature = getAttachmentSignature(attachments)
  const storeSignature = getAttachmentSignature(composer.attachments)
  const hasText = composer.value.trim().length > 0

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const textAreaWrapRef = useRef<HTMLDivElement | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuId = useId()
  const slashMenuId = useId()

  const slashOpen = isSlashMenuOpen(composer.value)
  const query = slashQuery(composer.value).toLowerCase()
  const thinkingMatchesQuery = 'thinking'.includes(query)

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

  const openFilePicker = () => {
    setAddMenuOpen(false)
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    for (const file of files) {
      composer.addAttachment(file)
    }
    event.currentTarget.value = ''
  }

  const handleAttachRecent = (file: ChatComposerRecentFile) => {
    setAddMenuOpen(false)
    onAttachRecent?.(file)
  }

  const handleSelectThinking = (effort: ChatComposerThinkingEffort) => {
    onSelectThinking?.(effort)
    // Strip the leading "/" so the menu closes and the composer is ready for the
    // actual message. onValueChange propagates this to the parent draft state.
    composer.setValue('')
  }

  const showRecent = recentFiles.length > 0
  const showThinkingChip = thinking != null
  const showChipsRow = showThinkingChip || composer.attachments.length > 0

  return (
    <MuiChatComposer disabled={disabled} variant="compact">
      {showChipsRow ? (
        <Stack direction="row" flexBasis="100%" flexWrap="wrap" gap={1}>
          {showThinkingChip ? (
            <Chip
              color="warning"
              data-testid="chat-thinking-chip"
              icon={<PsychologyRoundedIcon fontSize="small" />}
              label={`Thinking · ${THINKING_EFFORT_LABEL[thinking.effort]}`}
              onDelete={onClearThinking}
              size="small"
              variant="outlined"
            />
          ) : null}
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

      <input
        accept="*/*"
        hidden
        multiple
        onChange={handleFileInputChange}
        ref={fileInputRef}
        type="file"
      />

      <IconButton
        aria-controls={addMenuOpen ? addMenuId : undefined}
        aria-expanded={addMenuOpen ? 'true' : undefined}
        aria-haspopup="menu"
        aria-label="Добавить вложение"
        disabled={disabled}
        onClick={() => setAddMenuOpen(true)}
        ref={addButtonRef}
        size="small"
      >
        <AddIcon />
      </IconButton>
      <Menu
        anchorEl={addButtonRef.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        id={addMenuId}
        onClose={() => setAddMenuOpen(false)}
        open={addMenuOpen}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem onClick={openFilePicker}>
          <ListItemIcon>
            <AttachFileRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Добавить фото и файлы</ListItemText>
        </MenuItem>
        {showRecent ? <ListSubheader disableSticky>Недавние файлы</ListSubheader> : null}
        {showRecent
          ? recentFiles.slice(0, 5).map((file) => (
              <MenuItem
                data-testid="chat-recent-file"
                key={file.id}
                onClick={() => handleAttachRecent(file)}
              >
                <ListItemText
                  primary={file.name}
                  slotProps={{ primary: { noWrap: true } }}
                  sx={{ maxWidth: 320 }}
                />
              </MenuItem>
            ))
          : null}
      </Menu>

      <div ref={textAreaWrapRef} style={{ flexGrow: 1, display: 'flex', minWidth: 0 }}>
        <ChatComposerTextArea
          data-testid="chat-composer-textarea"
          disabled={disabled}
          maxRows={CHAT_COMPOSER_MAX_ROWS}
          placeholder={placeholder}
        />
      </div>
      <Menu
        anchorEl={textAreaWrapRef.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        id={slashMenuId}
        onClose={() => composer.setValue('')}
        open={slashOpen && thinkingMatchesQuery}
        slotProps={{ paper: { 'data-testid': 'chat-slash-menu' } as Record<string, unknown> }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <ListSubheader disableSticky>Команды</ListSubheader>
        {reasoningSupported ? (
          [
            <ListSubheader disableSticky key="thinking-head" sx={{ lineHeight: '32px' }}>
              <Stack alignItems="center" direction="row" spacing={1}>
                <PsychologyRoundedIcon fontSize="small" />
                <span>Thinking</span>
              </Stack>
            </ListSubheader>,
            ...THINKING_EFFORTS.map(({ effort, label }) => (
              <MenuItem
                data-testid={`chat-slash-thinking-${effort.toLowerCase()}`}
                key={effort}
                onClick={() => handleSelectThinking(effort)}
                sx={{ pl: 4 }}
              >
                <ListItemText primary={label} />
              </MenuItem>
            )),
          ]
        ) : (
          <MenuItem disabled data-testid="chat-slash-thinking-disabled">
            <ListItemText
              primary="Thinking"
              secondary="Недоступно для текущей модели"
            />
          </MenuItem>
        )}
      </Menu>

      <ChatComposerSendButton aria-label="Send" disabled={disabled || !hasText}>
        <ArrowUpwardIcon />
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
  recentFiles,
  onAttachRecent,
  reasoningSupported = true,
  onSelectThinking,
  thinking,
  onClearThinking,
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
        onAttachRecent={onAttachRecent}
        onAttachmentsChange={onAttachmentsChange}
        onClearThinking={onClearThinking}
        onSelectThinking={onSelectThinking}
        placeholder={placeholder}
        reasoningSupported={reasoningSupported}
        recentFiles={recentFiles ?? []}
        thinking={thinking}
      />
    </ChatProvider>
  )
}

export { CHAT_COMPOSER_MAX_ROWS }
