'use client'

import { useRouter } from 'next/navigation'

import {
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { parseUserAgent } from '@/lib/parse-user-agent'
import { trpc } from '@/trpc/client'

type Props = {
  currentSessionId: string
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  return `${days} дн назад`
}

export function SessionsTable({ currentSessionId }: Props) {
  const router = useRouter()
  const sessionsQuery = trpc.user.listSessions.useQuery()
  const revoke = trpc.user.revokeSession.useMutation({
    onSuccess: () => {
      sessionsQuery.refetch()
      router.refresh()
    },
  })

  if (sessionsQuery.isLoading) return <Typography color="text.secondary">Загрузка...</Typography>
  if (!sessionsQuery.data?.length)
    return <Typography color="text.secondary">Нет активных сессий</Typography>

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Устройство</TableCell>
            <TableCell>IP</TableCell>
            <TableCell>Последняя активность</TableCell>
            <TableCell align="right">Действие</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sessionsQuery.data.map((session) => {
            const { browser, os } = parseUserAgent(session.userAgent)
            const isCurrent = session.id === currentSessionId
            return (
              <TableRow key={session.id}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>
                      {browser} на {os}
                    </span>
                    {isCurrent && <Chip size="small" label="Эта сессия" color="primary" />}
                  </Stack>
                </TableCell>
                <TableCell>{session.ipAddress ?? '—'}</TableCell>
                <TableCell>{formatRelative(new Date(session.updatedAt))}</TableCell>
                <TableCell align="right">
                  {isCurrent ? null : (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ sessionId: session.id })}
                    >
                      Завершить
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}
