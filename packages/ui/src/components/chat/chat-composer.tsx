"use client"

import AttachFileIcon from "@mui/icons-material/AttachFile"
import SendRoundedIcon from "@mui/icons-material/SendRounded"
import Box from "@mui/material/Box"
import IconButton from "@mui/material/IconButton"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import TextareaAutosize from "@mui/material/TextareaAutosize"
import type { ChangeEvent, KeyboardEvent } from "react"
import { useId, useRef } from "react"

import { ChatFileChip } from "./chat-file-chip"
import type { ChatComposerAttachment, ChatSendPayload } from "./chat-types"

type ChatComposerProps = {
  value: string
  attachments: ChatComposerAttachment[]
  onValueChange: (value: string) => void
  onAttachmentsChange: (attachments: ChatComposerAttachment[]) => void
  onSend: (payload: ChatSendPayload) => void
  disabled?: boolean
  placeholder?: string
}

function buildDraftAttachment(file: File, index: number): ChatComposerAttachment {
  const localId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${index}-${file.name}`

  return {
    localId,
    file,
    status: "queued",
  }
}

export function ChatComposer({
  value,
  attachments,
  onValueChange,
  onAttachmentsChange,
  onSend,
  disabled = false,
  placeholder = "Write a message",
}: ChatComposerProps) {
  const fileInputId = useId()
  const isComposingRef = useRef(false)
  const hasText = value.trim().length > 0

  function handleSubmit() {
    const text = value.trim()
    if (!text || disabled) {
      return
    }

    onSend({
      text,
      attachments,
    })
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) {
      return
    }

    const nextAttachments = Array.from(fileList).map((file, index) => buildDraftAttachment(file, index))
    onAttachmentsChange([...attachments, ...nextAttachments])
    event.target.value = ""
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || isComposingRef.current) {
      return
    }

    event.preventDefault()
    handleSubmit()
  }

  return (
    <Paper
      component="form"
      elevation={0}
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        p: 1.25,
      }}
      variant="outlined"
    >
      {attachments.length > 0 ? (
        <Stack direction="row" flexWrap="wrap" gap={1} mb={1}>
          {attachments.map((attachment) => (
            <ChatFileChip
              key={attachment.localId}
              name={attachment.file.name}
              onDelete={() => {
                onAttachmentsChange(
                  attachments.filter((candidate) => candidate.localId !== attachment.localId),
                )
              }}
              secondaryLabel={attachment.status}
            />
          ))}
        </Stack>
      ) : null}

      <Stack alignItems="flex-end" direction="row" gap={1}>
        <input
          hidden
          id={fileInputId}
          multiple
          onChange={handleFileChange}
          type="file"
        />
        <IconButton
          aria-label="Attach files"
          component="label"
          disabled={disabled}
          htmlFor={fileInputId}
          size="small"
        >
          <AttachFileIcon />
        </IconButton>
        <Box flex={1}>
          <TextareaAutosize
            disabled={disabled}
            maxRows={8}
            minRows={1}
            onChange={(event) => onValueChange(event.target.value)}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              font: "inherit",
              outline: "none",
              resize: "none",
              width: "100%",
            }}
            value={value}
          />
        </Box>
        <IconButton
          aria-label="Send"
          color="primary"
          disabled={!hasText || disabled}
          onClick={handleSubmit}
          size="small"
        >
          <SendRoundedIcon />
        </IconButton>
      </Stack>
    </Paper>
  )
}
