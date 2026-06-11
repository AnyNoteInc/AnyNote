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
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENT_TYPES, type WebhookEventType } from './webhook-events'

export type SubscriptionChatOption = { id: string; title: string }

export type EditableSubscription = {
  id: string
  events: string[]
  chatTitle: string
  collectionTitle: string
}

/**
 * Create/edit dialog for a chat × collection subscription. Mounted only while
 * open so form state resets naturally. The router only allows editing the
 * event list — in edit mode the chat and collection are shown read-only.
 */
export function TelegramSubscriptionDialog({
  workspaceId,
  chats,
  subscription,
  onClose,
}: {
  workspaceId: string
  chats: SubscriptionChatOption[]
  subscription: EditableSubscription | null
  onClose: () => void
}) {
  const utils = trpc.useUtils()
  const isEdit = subscription !== null

  // TEAM-only is enforced by the router; the client filters the picker to match.
  const collectionsQ = trpc.collection.list.useQuery({ workspaceId }, { enabled: !isEdit })
  const teamCollections = (collectionsQ.data ?? []).filter((c) => c.kind === 'TEAM')

  const [chatId, setChatId] = useState('')
  const [collectionId, setCollectionId] = useState('')
  const [events, setEvents] = useState<WebhookEventType[]>(() =>
    subscription ? WEBHOOK_EVENT_TYPES.filter((ev) => subscription.events.includes(ev)) : [],
  )

  const onSuccess = () => {
    utils.telegram.listSubscriptions.invalidate({ workspaceId })
    onClose()
  }
  const create = trpc.telegram.createSubscription.useMutation({ onSuccess })
  const update = trpc.telegram.updateSubscription.useMutation({ onSuccess })
  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error

  const toggleEvent = (ev: WebhookEventType) =>
    setEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]))

  const canSubmit = events.length > 0 && (isEdit || (chatId !== '' && collectionId !== ''))

  const submit = () => {
    if (!canSubmit) return
    if (isEdit) update.mutate({ workspaceId, id: subscription.id, events })
    else create.mutate({ workspaceId, chatId, collectionId, events })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isEdit ? 'Изменить подписку' : 'Добавить подписку'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? <Alert severity="error">{error.message}</Alert> : null}

          {isEdit ? (
            <Box>
              <Typography variant="body2">
                Чат: <strong>{subscription.chatTitle}</strong>
              </Typography>
              <Typography variant="body2">
                Раздел: <strong>{subscription.collectionTitle}</strong>
              </Typography>
            </Box>
          ) : (
            <>
              {chats.length === 0 ? (
                <Alert severity="info">
                  Нет активных чатов. Добавьте бота в чат — он появится после первого сообщения.
                </Alert>
              ) : null}
              <FormControl fullWidth size="small" disabled={chats.length === 0}>
                <InputLabel id="telegram-subscription-chat-label">Чат</InputLabel>
                <Select
                  labelId="telegram-subscription-chat-label"
                  label="Чат"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                >
                  {chats.map((chat) => (
                    <MenuItem key={chat.id} value={chat.id}>
                      {chat.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {collectionsQ.isSuccess && teamCollections.length === 0 ? (
                <Alert severity="info">
                  В пространстве нет командных разделов — подписаться можно только на них.
                </Alert>
              ) : null}
              <FormControl fullWidth size="small" disabled={teamCollections.length === 0}>
                <InputLabel id="telegram-subscription-collection-label">Раздел</InputLabel>
                <Select
                  labelId="telegram-subscription-collection-label"
                  label="Раздел"
                  value={collectionId}
                  onChange={(e) => setCollectionId(e.target.value)}
                >
                  {teamCollections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.title ?? 'Без названия'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}

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
        <Button variant="contained" onClick={submit} loading={pending} disabled={!canSubmit}>
          {isEdit ? 'Сохранить' : 'Создать'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
