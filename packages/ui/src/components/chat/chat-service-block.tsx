'use client'

import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import Alert, { AlertColor } from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ChatConfirmHandler, ChatToolPart } from './chat-types'

type ChatServiceBlockProps = {
  part: ChatToolPart
  onConfirm?: ChatConfirmHandler
}

function getSeverity(state: ChatToolPart['state']): AlertColor {
  const state_maps: Record<ChatToolPart['state'], AlertColor> = {
    done: 'success',
    error: 'error',
    required: 'warning',
    running: 'info',
    pending: 'info',
  }
  return state_maps[state] || 'info'
}

function getStateLabel(state: ChatToolPart['state']) {
  const state_maps: Record<ChatToolPart['state'], string> = {
    done: 'Done',
    error: 'Error',
    required: 'Action required',
    running: 'Running',
    pending: 'Pending',
  }
  return state_maps[state] || 'Pending'
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
    return typeof value === 'object' && value !== null ? (value as ParsedDetail) : {}
  } catch {
    return {}
  }
}

export function ChatServiceBlock({ part, onConfirm }: ChatServiceBlockProps) {
  const [resultOpen, setResultOpen] = useState(false)
  const [argsOpen, setArgsOpen] = useState(false)
  const resultDialogTitle = `Результат: ${part.title}`
  const isConfirmation =
    part.kind === 'confirmation' && part.state === 'required' && onConfirm !== undefined
  const detail = isConfirmation ? parseDetail(part.detail) : {}
  const confirmationId = detail.confirmation_id ?? part.id
  const argsPreview =
    detail.args_preview && typeof detail.args_preview === 'object' ? detail.args_preview : null

  return (
    <>
      <Alert severity={getSeverity(part.state)} variant="outlined">
        <Stack spacing={1}>
          <Box
            alignItems="center"
            data-testid="chat-service-block-summary"
            display="flex"
            flexWrap="wrap"
            gap={1}
            minWidth={0}
            rowGap={0.25}
          >
            <Typography
              component="span"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              variant="body2"
            >
              {part.title}
            </Typography>
            <Typography color="text.secondary" component="span" variant="body2">
              {' • '}
            </Typography>
            <Typography color="text.secondary" component="span" variant="body2">
              {getStateLabel(part.state)}
            </Typography>
            {detail.tool ? (
              <>
                <Typography color="text.secondary" component="span" variant="body2">
                  {' • '}
                </Typography>
                <Typography color="text.secondary" component="span" variant="body2">
                  {detail.tool}
                </Typography>
              </>
            ) : null}
            {part.result ? (
              <Typography color="text.secondary" component="span" variant="body2">
                {' • '}
              </Typography>
            ) : null}
            {part.result ? (
              <Button onClick={() => setResultOpen(true)} size="small" variant="outlined">
                Результат
              </Button>
            ) : null}
            {argsPreview ? (
              <Link
                component="button"
                onClick={() => setArgsOpen((v) => !v)}
                sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.25 }}
                type="button"
                underline="hover"
                variant="body2"
              >
                {argsOpen ? 'Скрыть' : 'Подробнее'}
                <ExpandMoreRoundedIcon
                  fontSize="small"
                  sx={{
                    transform: argsOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s',
                  }}
                />
              </Link>
            ) : null}
          </Box>

          {argsPreview ? (
            <Collapse in={argsOpen} unmountOnExit>
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
            </Collapse>
          ) : null}

          {isConfirmation ? (
            <Stack direction="row" spacing={1}>
              <Button
                color="success"
                onClick={() => void onConfirm?.(confirmationId, 'allow')}
                size="small"
                startIcon={<CheckRoundedIcon />}
                variant="contained"
              >
                Разрешить
              </Button>
              <Button
                color="inherit"
                onClick={() => void onConfirm?.(confirmationId, 'deny')}
                size="small"
                startIcon={<CloseRoundedIcon />}
                variant="outlined"
              >
                Отклонить
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Alert>

      {part.result ? (
        <Dialog
          aria-labelledby={`${part.id}-result-title`}
          fullWidth
          maxWidth="md"
          onClose={() => setResultOpen(false)}
          open={resultOpen}
        >
          <DialogTitle id={`${part.id}-result-title`}>{resultDialogTitle}</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 1.5,
                maxHeight: '70vh',
                overflow: 'auto',
                p: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              <Typography component="pre" fontFamily="monospace" m={0} variant="body2">
                {part.result}
              </Typography>
            </Box>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
