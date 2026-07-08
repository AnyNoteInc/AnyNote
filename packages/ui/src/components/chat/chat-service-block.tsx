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

export function toolDotColor(
  state: ChatToolPart['state'],
): 'grey' | 'primary' | 'error' | 'warning' {
  switch (state) {
    case 'done':
      return 'primary'
    case 'error':
      return 'error'
    case 'required':
      return 'warning'
    default:
      return 'grey'
  }
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
          component="span"
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            fontSize: 12.5,
          }}
        >
          {detail.tool ?? ''}
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
                <Typography
                  component="pre"
                  variant="caption"
                  sx={{
                    fontFamily: 'monospace',
                    m: 0,
                  }}
                >
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
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{
                    fontFamily: 'monospace',
                    m: 0,
                  }}
                >
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
