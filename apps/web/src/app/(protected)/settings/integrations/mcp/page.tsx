'use client'

import { useState } from 'react'

import {
  Box,
  Button,
  DeleteIcon,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { AddServerDialog } from './AddServerDialog'

export default function McpServersPage() {
  const utils = trpc.useUtils()
  const { data: workspace } = trpc.workspace.getDefault.useQuery()
  const workspaceId = workspace?.id ?? ''

  const { data = [] } = trpc.mcpServer.list.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId) },
  )

  const update = trpc.mcpServer.update.useMutation({
    onSuccess: () => utils.mcpServer.list.invalidate({ workspaceId }),
  })
  const del = trpc.mcpServer.delete.useMutation({
    onSuccess: () => utils.mcpServer.list.invalidate({ workspaceId }),
  })

  const [adding, setAdding] = useState(false)

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">MCP-серверы</Typography>
        <Button variant="contained" onClick={() => setAdding(true)}>
          Добавить сервер
        </Button>
      </Stack>
      <Table sx={{ mt: 2 }}>
        <TableHead>
          <TableRow>
            <TableCell>Имя</TableCell>
            <TableCell>URL</TableCell>
            <TableCell>Транспорт</TableCell>
            <TableCell>Включён</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.name}</TableCell>
              <TableCell>{s.url}</TableCell>
              <TableCell>{s.transport}</TableCell>
              <TableCell>
                <Switch
                  checked={s.enabled}
                  onChange={(_, v) => update.mutate({ id: s.id, workspaceId: s.workspaceId, enabled: v })}
                />
              </TableCell>
              <TableCell>
                <IconButton onClick={() => del.mutate({ id: s.id, workspaceId: s.workspaceId })}>
                  <DeleteIcon />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AddServerDialog open={adding} onClose={() => setAdding(false)} workspaceId={workspaceId} />
    </Box>
  )
}
