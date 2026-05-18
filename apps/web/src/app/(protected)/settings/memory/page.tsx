'use client'

import {
  Box,
  Chip,
  DeleteIcon,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

export default function AgentMemoryPage() {
  const utils = trpc.useUtils()
  const { data: workspace } = trpc.workspace.getDefault.useQuery()
  const workspaceId = workspace?.id ?? ''

  const { data = [] } = trpc.agentMemory.list.useQuery(
    { workspaceId },
    { enabled: Boolean(workspaceId) },
  )

  const del = trpc.agentMemory.delete.useMutation({
    onSuccess: () => utils.agentMemory.list.invalidate({ workspaceId }),
  })

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6">Память агента</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Факты, которые агент сохранил из ваших чатов. Удаление — мгновенное.
      </Typography>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Ключ</TableCell>
            <TableCell>Область</TableCell>
            <TableCell>Содержание</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <code>{m.key}</code>
              </TableCell>
              <TableCell>
                <Chip size="small" label={m.scope === 'WORKSPACE' ? 'workspace' : 'user'} />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{m.content}</TableCell>
              <TableCell>
                <IconButton onClick={() => del.mutate({ id: m.id })}>
                  <DeleteIcon />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}
