'use client'

import { useState } from 'react'

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export function AddServerDialog(props: {
  open: boolean
  onClose: () => void
  workspaceId: string
}) {
  const utils = trpc.useUtils()
  const create = trpc.mcpServer.create.useMutation({
    onSuccess: () => {
      utils.mcpServer.list.invalidate({ workspaceId: props.workspaceId })
      props.onClose()
    },
  })
  const [form, setForm] = useState({
    name: '',
    url: '',
    transport: 'HTTP_JSONRPC' as 'HTTP_JSONRPC' | 'SSE',
    headersJson: '{}',
  })

  return (
    <Dialog open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>Добавить MCP-сервер</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
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
              setForm((f) => ({ ...f, transport: e.target.value as 'HTTP_JSONRPC' | 'SSE' }))
            }
          >
            <MenuItem value="HTTP_JSONRPC">HTTP JSON-RPC</MenuItem>
            <MenuItem value="SSE">SSE</MenuItem>
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
        <Button onClick={props.onClose}>Отмена</Button>
        <Button
          variant="contained"
          onClick={() =>
            create.mutate({
              workspaceId: props.workspaceId,
              name: form.name,
              url: form.url,
              transport: form.transport,
              headers: JSON.parse(form.headersJson || '{}') as Record<string, string>,
            })
          }
        >
          Сохранить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
