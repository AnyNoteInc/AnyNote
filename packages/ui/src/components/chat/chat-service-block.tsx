'use client'

import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Collapse from '@mui/material/Collapse'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { ChatConfirmInline } from './chat-confirm-inline'
import type { ChatConfirmHandler, ChatToolPart } from './chat-types'

type ChatServiceBlockProps = Readonly<{
  part: ChatToolPart
  onConfirm?: ChatConfirmHandler
  onAllowAll?: (tool: string) => void
}>

const TICK_COLOR: Record<ChatToolPart['state'], string> = {
  done: 'grey.600',
  error: 'error.main',
  pending: 'grey.500',
  required: 'grey.500',
  running: 'grey.500',
}

function getStateLabel(state: ChatToolPart['state']) {
  const stateMaps: Record<ChatToolPart['state'], string> = {
    done: 'Done',
    error: 'Error',
    pending: 'Pending',
    required: 'Action required',
    running: 'Running',
  }
  return stateMaps[state] || 'Pending'
}

type ParsedDetail = {
  confirmation_id?: string
  tool?: string
  summary?: string
  args_preview?: unknown
}

function parseDetail(detail: string | undefined): ParsedDetail {
  if (!detail) return {}
  try {
    const value = JSON.parse(detail) as unknown
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

export function ChatServiceBlock({ part, onConfirm, onAllowAll }: ChatServiceBlockProps) {
  const [open, setOpen] = useState(false)
  const detail = parseDetail(part.detail)
  const isConfirmation =
    part.kind === 'confirmation' && part.state === 'required' && onConfirm !== undefined

  if (isConfirmation) {
    const confirmationId = detail.confirmation_id ?? part.id
    return (
      <ChatConfirmInline
        argsPreview={detail.args_preview}
        confirmationId={confirmationId}
        onAllowAll={onAllowAll}
        onResolve={(id, action) => void onConfirm?.(id, action)}
        summary={detail.summary ?? part.title}
        tool={detail.tool ?? part.title}
      />
    )
  }

  const argsPreview =
    detail.args_preview && typeof detail.args_preview === 'object' ? detail.args_preview : null
  const hasDetails = argsPreview !== null || Boolean(part.result)

  return (
    <Box>
      <ButtonBase
        data-testid="chat-service-block-summary"
        disabled={!hasDetails}
        onClick={() => setOpen((value) => !value)}
        sx={{
          borderRadius: 1,
          display: 'flex',
          gap: 1,
          minWidth: 0,
          px: 0.5,
          py: 0.5,
          textAlign: 'left',
          width: '100%',
          ...(hasDetails ? { '&:hover': { bgcolor: 'action.hover' } } : {}),
        }}
      >
        <Box
          aria-hidden
          sx={{
            alignItems: 'center',
            bgcolor: TICK_COLOR[part.state],
            borderRadius: 0.75,
            color: 'common.white',
            display: 'flex',
            flexShrink: 0,
            fontSize: 11,
            height: 16,
            justifyContent: 'center',
            lineHeight: 1,
            width: 16,
          }}
        >
          {part.state === 'error' ? '!' : '✓'}
        </Box>
        <Typography
          sx={{
            flex: 1,
            fontSize: 13.5,
            minWidth: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {part.title}
        </Typography>
        <Typography
          color="text.secondary"
          component="span"
          sx={{ flexShrink: 0, fontSize: 12.5 }}
        >
          {detail.tool ? `${detail.tool} • ` : ''}
          {getStateLabel(part.state)}
        </Typography>
        {hasDetails ? (
          <ExpandMoreRoundedIcon
            fontSize="small"
            sx={{
              color: 'text.secondary',
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          />
        ) : null}
      </ButtonBase>

      {hasDetails ? (
        <Collapse in={open} unmountOnExit>
          <Stack spacing={1} sx={{ pt: 0.75, px: 0.5 }}>
            {argsPreview ? (
              <Box
                sx={{
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  maxHeight: 240,
                  overflow: 'auto',
                  p: 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Typography component="pre" fontFamily="monospace" m={0} variant="caption">
                  {JSON.stringify(argsPreview, null, 2)}
                </Typography>
              </Box>
            ) : null}
            {part.result ? (
              <Box
                sx={{
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  maxHeight: 320,
                  overflow: 'auto',
                  p: 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Typography component="pre" fontFamily="monospace" m={0} variant="body2">
                  {part.result}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </Collapse>
      ) : null}
    </Box>
  )
}
