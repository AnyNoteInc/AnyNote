'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ChatToolPart } from './chat-types'

type ChatServiceBlockProps = {
  part: ChatToolPart
}

function getSeverity(state: ChatToolPart['state']) {
  switch (state) {
    case 'done':
      return 'success'
    case 'error':
      return 'error'
    case 'required':
      return 'warning'
    default:
      return 'info'
  }
}

function getStateLabel(state: ChatToolPart['state']) {
  switch (state) {
    case 'done':
      return 'Done'
    case 'error':
      return 'Error'
    case 'required':
      return 'Action required'
    case 'running':
      return 'Running'
    default:
      return 'Pending'
  }
}

export function ChatServiceBlock({ part }: ChatServiceBlockProps) {
  const [resultOpen, setResultOpen] = useState(false)
  const resultDialogTitle = `Результат: ${part.title}`

  return (
    <>
      <Alert severity={getSeverity(part.state)} variant="outlined">
        <Box
          alignItems="center"
          data-testid="chat-service-block-summary"
          display="flex"
          flexWrap="nowrap"
          gap={1}
          minWidth={0}
        >
          <Typography component="span" noWrap variant="body2">
            {part.title}
          </Typography>
          <Typography color="text.secondary" component="span" variant="body2">
            {' • '}
          </Typography>
          <Typography color="text.secondary" component="span" variant="body2">
            {getStateLabel(part.state)}
          </Typography>
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
        </Box>
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
