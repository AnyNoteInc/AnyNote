'use client'

import { useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  ContentCopyIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import type { CreatedKey } from './api-key-create-dialog'

type Props = {
  created: CreatedKey | null
  onClose: () => void
}

export function ApiKeyRevealDialog({ created, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  if (!created) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.fullKey)
      setCopied(true)
      setCopyError(null)
    } catch {
      setCopyError('Не удалось скопировать — выделите ключ и скопируйте вручную.')
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Ключ «{created.name}» создан</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="warning">
            Скопируйте ключ сейчас — он больше не появится. Если потеряете, создайте новый.
          </Alert>
          {copyError && <Alert severity="error">{copyError}</Alert>}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1.5,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: 'action.hover',
            }}
          >
            <Typography
              data-testid="api-key-reveal-fullkey"
              sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all', userSelect: 'all' }}
            >
              {created.fullKey}
            </Typography>
            <Tooltip title={copied ? 'Скопировано' : 'Копировать'}>
              <IconButton
                onClick={copy}
                data-testid="api-key-reveal-copy"
                aria-label="Копировать ключ"
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" data-testid="api-key-reveal-close">
          Я скопировал
        </Button>
      </DialogActions>
    </Dialog>
  )
}
