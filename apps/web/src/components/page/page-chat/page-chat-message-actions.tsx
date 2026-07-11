'use client'

import { useEffect, useRef, useState } from 'react'

import {
  AddRoundedIcon,
  Box,
  Button,
  CheckIcon,
  CloseIcon,
  ContentCopyIcon,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  UndoIcon,
} from '@repo/ui/components'

const FLASH_MS = 1500

type Props = Readonly<{
  /** The assistant-generated text (markdown) of this answer. */
  text: string
  /** Append the answer to the end of the current page; false when no editor. */
  onAppend: () => boolean
  /** Restore the page to its pre-request snapshot; false when it failed. */
  onUndo: () => boolean
  /** Whether a pre-request snapshot exists for this answer (current session). */
  canUndo: boolean
}>

/** Copy / insert-into-page / undo-page-changes row under an assistant answer
 *  in the page chat (spec item 6). Undo asks for an inline confirmation and
 *  restores the page to the snapshot captured when the request was sent. */
export function PageChatMessageActions({ text, onAppend, onUndo, canUndo }: Props) {
  const [copied, setCopied] = useState(false)
  const [appended, setAppended] = useState(false)
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  const [undone, setUndone] = useState(false)
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  const flash = (set: (value: boolean) => void) => {
    set(true)
    timersRef.current.push(window.setTimeout(() => set(false), FLASH_MS))
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      flash(setCopied)
    } catch {
      // Clipboard denied (permissions/insecure context) — nothing to surface.
    }
  }

  const handleAppend = () => {
    if (onAppend()) flash(setAppended)
  }

  const handleUndoConfirm = () => {
    setConfirmingUndo(false)
    if (onUndo()) flash(setUndone)
  }

  if (confirmingUndo) {
    return (
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'center', mt: 0.5 }}
        data-testid="page-chat-undo-confirm-row"
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Отменить изменения страницы?
        </Typography>
        <Button
          size="small"
          color="error"
          variant="text"
          onClick={handleUndoConfirm}
          data-testid="page-chat-undo-confirm"
          sx={{ minWidth: 0, px: 1, py: 0, fontSize: 12 }}
        >
          Отменить
        </Button>
        <IconButton
          size="small"
          aria-label="Не отменять"
          onClick={() => setConfirmingUndo(false)}
          data-testid="page-chat-undo-cancel"
          sx={{ p: 0.25 }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Stack>
    )
  }

  return (
    <Stack
      direction="row"
      spacing={0.25}
      sx={{ alignItems: 'center', mt: 0.5, color: 'text.secondary' }}
      data-testid="page-chat-message-actions"
    >
      <Tooltip title="Копировать ответ">
        <IconButton
          size="small"
          aria-label="Копировать ответ"
          onClick={() => void handleCopy()}
          data-testid="page-chat-copy"
          sx={{ p: 0.5 }}
        >
          {copied ? (
            <CheckIcon sx={{ fontSize: 16 }} color="success" />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Tooltip>
      <Tooltip title="Вставить в конец страницы">
        <IconButton
          size="small"
          aria-label="Вставить в конец страницы"
          onClick={handleAppend}
          data-testid="page-chat-append"
          sx={{ p: 0.5 }}
        >
          {appended ? (
            <CheckIcon sx={{ fontSize: 16 }} color="success" />
          ) : (
            <AddRoundedIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Tooltip>
      <Tooltip
        title={
          canUndo
            ? 'Отменить изменения страницы из этого запроса'
            : 'Отмена доступна только для ответов текущей сессии'
        }
      >
        {/* span: MUI tooltips need an enabled wrapper around a disabled button */}
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <IconButton
            size="small"
            aria-label="Отменить изменения страницы"
            onClick={() => setConfirmingUndo(true)}
            disabled={!canUndo}
            data-testid="page-chat-undo"
            sx={{ p: 0.5 }}
          >
            {undone ? (
              <CheckIcon sx={{ fontSize: 16 }} color="success" />
            ) : (
              <UndoIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Box>
      </Tooltip>
    </Stack>
  )
}
