'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, type WebhookEventType } from './webhook-events'

/**
 * Create-subscription dialog. Mounted only while open so the form state
 * resets naturally between uses. The returned secret is handed to the parent
 * (the one-time secret dialog) — it never crosses the wire again.
 */
export function WebhookCreateDialog({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string
  onClose: () => void
  onCreated: (secret: string) => void
}) {
  const utils = trpc.useUtils()
  const create = trpc.webhook.create.useMutation({
    onSuccess: (data) => {
      utils.webhook.list.invalidate({ workspaceId })
      onCreated(data.secret)
    },
  })

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<WebhookEventType[]>([])

  const toggleEvent = (ev: WebhookEventType) =>
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]))

  const submit = () => {
    if (events.length === 0) return
    create.mutate({ workspaceId, name: name.trim(), url: url.trim(), events })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Добавить вебхук</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
          <TextField
            label="Имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <TextField
            label="URL"
            placeholder="https://example.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            helperText="Только https:// адреса. После создания на адрес будет отправлен проверочный запрос."
          />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              События
            </Typography>
            <Stack>
              {WEBHOOK_EVENT_TYPES.map((ev) => (
                <FormControlLabel
                  key={ev}
                  control={
                    <Checkbox
                      size="small"
                      checked={events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                  }
                  label={
                    <Box sx={{ py: 0.25 }}>
                      <Typography variant="body2">{WEBHOOK_EVENT_LABELS[ev].label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {WEBHOOK_EVENT_LABELS[ev].desc}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Отмена</Button>
        <Button
          variant="contained"
          onClick={submit}
          loading={create.isPending}
          disabled={!name.trim() || !url.trim() || events.length === 0}
        >
          {create.isPending ? 'Проверка адреса…' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
