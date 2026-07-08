'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  DeleteIcon,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@repo/ui/components'

import {
  MCP_TRANSPORTS,
  MCP_TRANSPORT_LABELS,
  type McpTransport,
} from '@repo/trpc/helpers/mcp-transports'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

export function WorkspaceMcpSection({
  workspaceId,
  isOwner,
  customMcpEnabled,
}: {
  workspaceId: string
  isOwner: boolean
  customMcpEnabled: boolean
}) {
  const utils = trpc.useUtils()
  const list = trpc.mcpServer.list.useQuery({ workspaceId })
  const invalidate = () => utils.mcpServer.list.invalidate({ workspaceId })
  const update = trpc.mcpServer.update.useMutation({ onSuccess: invalidate })
  const del = trpc.mcpServer.delete.useMutation({ onSuccess: invalidate })
  const create = trpc.mcpServer.create.useMutation({
    onSuccess: () => {
      invalidate()
    },
  })

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    url: '',
    transport: 'HTTP_JSONRPC' as McpTransport,
    headersJson: '{}',
  })

  const submit = () => {
    let headers: Record<string, string> = {}
    try {
      headers = JSON.parse(form.headersJson || '{}') as Record<string, string>
    } catch {
      headers = {}
    }
    create.mutate({
      workspaceId,
      name: form.name.trim(),
      url: form.url.trim(),
      transport: form.transport,
      headers,
    })
  }

  return (
    <SettingsCard
      title="MCP серверы"
      description="Дополнительные инструменты для AI-агента. Сервер anynote подключён всегда. Перед добавлением выполняется проверка соединения."
    >
      {!isOwner ? (
        <Alert severity="info">Только владелец пространства может изменять MCP серверы.</Alert>
      ) : null}

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
        }}
      >
        <Box>
          <Typography variant="subtitle2">
            anynote <Chip size="small" label="по умолчанию" sx={{ ml: 1 }} />
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Встроенные инструменты рабочего пространства
          </Typography>
        </Box>
        <Switch checked disabled />
      </Box>

      {list.data?.map((s) => (
        <Box
          key={s.id}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <Box>
            <Typography variant="subtitle2">{s.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {s.url} · {s.transport}
            </Typography>
          </Box>
          <Stack direction="row" sx={{ alignItems: 'center' }}>
            <Switch
              checked={s.enabled}
              disabled={!isOwner}
              onChange={(_, v) => update.mutate({ id: s.id, workspaceId, enabled: v })}
            />
            <IconButton
              disabled={!isOwner}
              onClick={() => del.mutate({ id: s.id, workspaceId })}
              aria-label="Удалить сервер"
            >
              <DeleteIcon />
            </IconButton>
          </Stack>
        </Box>
      ))}

      {isOwner ? (
        <Button
          variant="outlined"
          onClick={() => {
            create.reset()
            setForm({ name: '', url: '', transport: 'HTTP_JSONRPC', headersJson: '{}' })
            setOpen(true)
          }}
          disabled={!customMcpEnabled}
          sx={{ alignSelf: 'flex-start' }}
        >
          Добавить сервер
        </Button>
      ) : null}
      {isOwner && !customMcpEnabled ? (
        <Typography variant="caption" color="text.secondary">
          Свои MCP серверы доступны на тарифе МАКС.
        </Typography>
      ) : null}

      <Dialog
        open={open}
        onClose={() => {
          create.reset()
          setOpen(false)
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Добавить MCP сервер</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
            {create.isSuccess ? (
              <Alert severity="success">
                {create.data?.tools?.length
                  ? `Сервер добавлен. Доступные инструменты: ${create.data.tools.join(', ')}`
                  : 'Сервер добавлен. Инструменты не обнаружены.'}
              </Alert>
            ) : null}
            <TextField
              label="Имя"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <TextField
              label="URL"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
            <TextField
              label="Транспорт"
              select
              value={form.transport}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  transport: e.target.value as McpTransport,
                }))
              }
            >
              {MCP_TRANSPORTS.map((t) => (
                <MenuItem key={t} value={t}>
                  {MCP_TRANSPORT_LABELS[t]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Headers (JSON)"
              multiline
              minRows={3}
              value={form.headersJson}
              onChange={(e) => setForm((f) => ({ ...f, headersJson: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          {create.isSuccess ? (
            <Button
              variant="contained"
              onClick={() => {
                create.reset()
                setOpen(false)
              }}
            >
              Закрыть
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>Отмена</Button>
              <Button
                variant="contained"
                onClick={submit}
                loading={create.isPending}
                disabled={!form.name.trim() || !form.url.trim()}
              >
                {create.isPending ? 'Проверка соединения…' : 'Сохранить'}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </SettingsCard>
  )
}
