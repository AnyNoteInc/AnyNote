'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  EditIcon,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import {
  TelegramSubscriptionDialog,
  type EditableSubscription,
} from './telegram-subscription-dialog'

type ChipColor = 'default' | 'success' | 'error' | 'warning' | 'info'
type Notice = { severity: 'error' | 'info' | 'success'; text: string }

const CONNECTION_STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Ожидает', color: 'default' },
  ACTIVE: { label: 'Активен', color: 'success' },
  DISABLED: { label: 'Отключен', color: 'default' },
  ERROR: { label: 'Ошибка', color: 'error' },
}

const CHAT_STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  ACTIVE: { label: 'Активен', color: 'success' },
  LEFT: { label: 'Покинут', color: 'default' },
}

const DELIVERY_STATUS_LABELS: Record<string, { label: string; color: ChipColor }> = {
  PENDING: { label: 'В очереди', color: 'default' },
  SENT: { label: 'Отправлено', color: 'success' },
  FAILED: { label: 'Ошибка', color: 'error' },
  SKIPPED: { label: 'Пропущено', color: 'default' },
}

const AUDIT_RESULT_LABELS: Record<string, { label: string; color: ChipColor }> = {
  OK: { label: 'Успех', color: 'success' },
  DENIED: { label: 'Отказано', color: 'warning' },
  ERROR: { label: 'Ошибка', color: 'error' },
}

const BOTFATHER_HINT =
  'Создайте бота у @BotFather в Телеграм и вставьте токен вида 123456789:AAEhB…'

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusChip(
  labels: Record<string, { label: string; color: ChipColor }>,
  status: string,
  tooltip?: string | null,
) {
  const s = labels[status] ?? { label: status, color: 'default' as const }
  const chip = <Chip size="small" label={s.label} color={s.color} />
  return tooltip ? (
    <Tooltip title={tooltip}>
      <span>{chip}</span>
    </Tooltip>
  ) : (
    chip
  )
}

export function WorkspaceTelegramSection({
  workspaceId,
  canManage,
}: {
  workspaceId: string
  canManage: boolean
}) {
  const utils = trpc.useUtils()
  // Every telegram.* workspace procedure is OWNER/ADMIN-gated in the router,
  // so queries only run for managers — others see the info alert (7A pattern).
  const connQ = trpc.telegram.getConnection.useQuery({ workspaceId }, { enabled: canManage })
  const connection = connQ.data ?? null
  const hasConnection = Boolean(connection)

  const chatsQ = trpc.telegram.listChats.useQuery(
    { workspaceId },
    { enabled: canManage && hasConnection },
  )
  const subsQ = trpc.telegram.listSubscriptions.useQuery(
    { workspaceId },
    { enabled: canManage && hasConnection },
  )

  const [notice, setNotice] = useState<Notice | null>(null)
  const [token, setToken] = useState('')
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [subscriptionDialog, setSubscriptionDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; subscription: EditableSubscription } | null
  >(null)

  const onError = (e: { message: string }) => setNotice({ severity: 'error', text: e.message })
  const invalidateConnection = () => utils.telegram.getConnection.invalidate({ workspaceId })

  const connect = trpc.telegram.connect.useMutation({
    onSuccess: (data) => {
      invalidateConnection()
      setToken('')
      setNotice(
        data.status === 'ACTIVE'
          ? { severity: 'success', text: 'Бот подключён и активен.' }
          : {
              severity: 'error',
              text: 'Не удалось подключить бота. Проверьте токен и повторите.',
            },
      )
    },
    onError,
  })
  const verify = trpc.telegram.verify.useMutation({
    onSuccess: (data) => {
      invalidateConnection()
      setNotice(
        data.status === 'ACTIVE'
          ? { severity: 'success', text: 'Подключение подтверждено — бот активен.' }
          : {
              severity: 'info',
              text: 'Телеграм не подтвердил подключение. Проверьте токен и повторите.',
            },
      )
    },
    onError,
  })
  const disconnect = trpc.telegram.disconnect.useMutation({
    onSuccess: () => {
      invalidateConnection()
      utils.telegram.deliveries.invalidate()
      setDisconnectOpen(false)
      setNotice({ severity: 'info', text: 'Бот отключён. Ожидавшие отправки сообщения пропущены.' })
    },
    onError: (e) => {
      setDisconnectOpen(false)
      onError(e)
    },
  })
  const removeChat = trpc.telegram.removeChat.useMutation({
    onSuccess: () => {
      utils.telegram.listChats.invalidate({ workspaceId })
      utils.telegram.listSubscriptions.invalidate({ workspaceId })
      setNotice(null)
    },
    onError,
  })
  const deleteSubscription = trpc.telegram.deleteSubscription.useMutation({
    onSuccess: () => {
      utils.telegram.listSubscriptions.invalidate({ workspaceId })
      setNotice(null)
    },
    onError,
  })

  // Reconnect (status DISABLED) reuses the same token form: connect upserts.
  const showConnectForm =
    canManage && !connQ.isPending && (!connection || connection.status === 'DISABLED')
  const activeChats = (chatsQ.data ?? []).filter((c) => c.status === 'ACTIVE')

  return (
    <SettingsCard
      title="Телеграм"
      description="Бот пространства: уведомления о страницах и комментариях командных разделов в чаты Телеграм, команды /search и /get для привязавших аккаунт участников."
    >
      {!canManage ? (
        <Alert severity="info">
          Управлять интеграцией с Телеграм могут владелец и администраторы.
        </Alert>
      ) : null}
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}
      {canManage && connQ.isError ? <Alert severity="error">{connQ.error.message}</Alert> : null}
      {canManage && connQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : null}

      {canManage && connection ? (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Typography variant="subtitle2">
                {connection.botUsername ? `@${connection.botUsername}` : 'Бот'}
              </Typography>
              {statusChip(CONNECTION_STATUS_LABELS, connection.status, connection.lastError)}
              {connection.consecutiveFailures > 0 ? (
                <Chip
                  size="small"
                  color="warning"
                  label={`Сбоев подряд: ${connection.consecutiveFailures}`}
                />
              ) : null}
            </Stack>
            {connection.status !== 'DISABLED' ? (
              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
                <Button
                  size="small"
                  onClick={() => verify.mutate({ workspaceId })}
                  loading={verify.isPending}
                >
                  Проверить
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => setDisconnectOpen(true)}
                  disabled={disconnect.isPending}
                >
                  Отключить
                </Button>
              </Stack>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {showConnectForm ? (
        <Stack spacing={1.5}>
          {connection?.status === 'DISABLED' ? (
            <Typography variant="body2" color="text.secondary">
              Подключение отключено. Вставьте токен, чтобы подключить бота заново.
            </Typography>
          ) : null}
          <TextField
            type="password"
            label="Токен бота"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            helperText={BOTFATHER_HINT}
            autoComplete="off"
            slotProps={{ htmlInput: { 'data-testid': 'telegram-token-input', maxLength: 200 } }}
          />
          <Button
            variant="contained"
            data-testid="telegram-connect"
            onClick={() => connect.mutate({ workspaceId, botToken: token.trim() })}
            loading={connect.isPending}
            disabled={!token.trim()}
            sx={{ alignSelf: 'flex-start' }}
          >
            Подключить
          </Button>
        </Stack>
      ) : null}

      {canManage && hasConnection ? (
        <>
          <Divider />
          <Box>
            <Typography variant="subtitle1">Чаты</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Добавьте бота в чат или группу — чат появится здесь после первого сообщения.
            </Typography>
            {chatsQ.isError ? <Alert severity="error">{chatsQ.error.message}</Alert> : null}
            {chatsQ.data?.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Пока нет ни одного чата.
              </Typography>
            ) : null}
            <Stack spacing={1}>
              {chatsQ.data?.map((chat) => (
                <Box
                  key={chat.id}
                  data-testid="telegram-chat-row"
                  sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}
                >
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={1}
                      sx={{ flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2">{chat.title ?? `Чат ${chat.chatId}`}</Typography>
                      <Chip size="small" variant="outlined" label={chat.type} />
                      {statusChip(CHAT_STATUS_LABELS, chat.status)}
                    </Stack>
                    <IconButton
                      size="small"
                      aria-label="Удалить чат"
                      onClick={() => removeChat.mutate({ workspaceId, chatId: chat.id })}
                      disabled={removeChat.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Box>

          <Divider />
          <Box>
            <Typography variant="subtitle1">Подписки разделов</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Уведомления отправляются только в явно подписанные чаты и только о событиях командных
              разделов.
            </Typography>
            {subsQ.isError ? <Alert severity="error">{subsQ.error.message}</Alert> : null}
            {subsQ.data?.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Подписок пока нет.
              </Typography>
            ) : null}
            {subsQ.data?.length ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Чат</TableCell>
                      <TableCell>Раздел</TableCell>
                      <TableCell>События</TableCell>
                      <TableCell align="right">Действия</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subsQ.data.map((sub) => (
                      <TableRow key={sub.id} data-testid="telegram-subscription-row">
                        <TableCell>{sub.chat.title ?? 'Чат'}</TableCell>
                        <TableCell>{sub.collection.title ?? 'Без названия'}</TableCell>
                        <TableCell>
                          <Chip size="small" variant="outlined" label={sub.events.length} />
                        </TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            aria-label="Изменить подписку"
                            onClick={() =>
                              setSubscriptionDialog({
                                mode: 'edit',
                                subscription: {
                                  id: sub.id,
                                  events: sub.events,
                                  chatTitle: sub.chat.title ?? 'Чат',
                                  collectionTitle: sub.collection.title ?? 'Без названия',
                                },
                              })
                            }
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label="Удалить подписку"
                            onClick={() => deleteSubscription.mutate({ workspaceId, id: sub.id })}
                            disabled={deleteSubscription.isPending}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : null}
            <Button
              variant="outlined"
              size="small"
              data-testid="telegram-subscription-create"
              onClick={() => setSubscriptionDialog({ mode: 'create' })}
              sx={{ mt: 1 }}
            >
              Добавить подписку
            </Button>
          </Box>

          <Divider />
          <TelegramDeliveriesBlock workspaceId={workspaceId} enabled={canManage && hasConnection} />

          <Divider />
          <TelegramAuditBlock workspaceId={workspaceId} enabled={canManage && hasConnection} />
        </>
      ) : null}

      {disconnectOpen ? (
        <Dialog open onClose={() => setDisconnectOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Отключить бота?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Доставка уведомлений остановится, ожидающие сообщения будут пропущены. Чаты и подписки
              сохранятся — их можно будет использовать после повторного подключения.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDisconnectOpen(false)}>Отмена</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => disconnect.mutate({ workspaceId })}
              loading={disconnect.isPending}
            >
              Отключить
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {subscriptionDialog ? (
        <TelegramSubscriptionDialog
          workspaceId={workspaceId}
          chats={activeChats.map((c) => ({ id: c.id, title: c.title ?? `Чат ${c.chatId}` }))}
          subscription={subscriptionDialog.mode === 'edit' ? subscriptionDialog.subscription : null}
          onClose={() => setSubscriptionDialog(null)}
        />
      ) : null}
    </SettingsCard>
  )
}

function TelegramDeliveriesBlock({
  workspaceId,
  enabled,
}: {
  workspaceId: string
  enabled: boolean
}) {
  const q = trpc.telegram.deliveries.useInfiniteQuery(
    { workspaceId },
    { getNextPageParam: (page) => page.nextCursor ?? undefined, enabled },
  )
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Журнал доставок
      </Typography>
      {q.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : q.isError ? (
        <Alert severity="error">{q.error.message}</Alert>
      ) : (
        (() => {
          const items = q.data.pages.flatMap((p) => p.items)
          if (items.length === 0) {
            return (
              <Typography variant="body2" color="text.secondary">
                Доставок пока нет.
              </Typography>
            )
          }
          return (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Событие</TableCell>
                      <TableCell>Статус</TableCell>
                      <TableCell align="right">Попытки</TableCell>
                      <TableCell>Дата</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                            {d.eventType}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {statusChip(
                            DELIVERY_STATUS_LABELS,
                            d.status,
                            d.lastError ?? d.responseSnippet,
                          )}
                        </TableCell>
                        <TableCell align="right">{d.attempts}</TableCell>
                        <TableCell>{formatDate(d.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {q.hasNextPage ? (
                <Button
                  size="small"
                  onClick={() => q.fetchNextPage()}
                  loading={q.isFetchingNextPage}
                  sx={{ mt: 1 }}
                >
                  Показать ещё
                </Button>
              ) : null}
            </>
          )
        })()
      )}
    </Box>
  )
}

function TelegramAuditBlock({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const q = trpc.telegram.auditLog.useInfiniteQuery(
    { workspaceId },
    { getNextPageParam: (page) => page.nextCursor ?? undefined, enabled },
  )
  return (
    <Box data-testid="telegram-audit">
      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        Журнал команд
      </Typography>
      {q.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : q.isError ? (
        <Alert severity="error">{q.error.message}</Alert>
      ) : (
        (() => {
          const items = q.data.pages.flatMap((p) => p.items)
          if (items.length === 0) {
            return (
              <Typography variant="body2" color="text.secondary">
                Команд пока не было.
              </Typography>
            )
          }
          return (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Команда</TableCell>
                      <TableCell>Отправитель</TableCell>
                      <TableCell>Результат</TableCell>
                      <TableCell>Детали</TableCell>
                      <TableCell>Дата</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                            {a.command}
                            {a.argsSummary ? ` ${a.argsSummary}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                            {a.telegramUserId}
                          </Typography>
                        </TableCell>
                        <TableCell>{statusChip(AUDIT_RESULT_LABELS, a.result)}</TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {a.detail ?? '—'}
                          </Typography>
                        </TableCell>
                        <TableCell>{formatDate(a.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {q.hasNextPage ? (
                <Button
                  size="small"
                  onClick={() => q.fetchNextPage()}
                  loading={q.isFetchingNextPage}
                  sx={{ mt: 1 }}
                >
                  Показать ещё
                </Button>
              ) : null}
            </>
          )
        })()
      )}
    </Box>
  )
}
