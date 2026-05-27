'use client'

import { useMemo, useState } from 'react'

import {
  AddIcon,
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { ApiKeyCreateDialog, type CreatedKey } from './api-key-create-dialog'
import { ApiKeyRevealDialog } from './api-key-reveal-dialog'

export type ApiKeyRow = {
  id: string
  name: string
  keyPrefix: string
  keyLastFour: string
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
}

type Props = { readonly initialKeys: ApiKeyRow[] }

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(d))
}

function formatExpires(d: string | null): string {
  if (!d) return 'никогда'
  return formatDate(d)
}

export function ApiKeysSection({ initialKeys }: Props) {
  const utils = trpc.useUtils()
  const list = trpc.apiKey.list.useQuery(undefined, { initialData: initialKeys })
  const revoke = trpc.apiKey.revoke.useMutation({
    onSuccess: () => utils.apiKey.list.invalidate(),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [revealKey, setRevealKey] = useState<CreatedKey | null>(null)

  const rows = useMemo(() => list.data ?? [], [list.data])

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">Ваши ключи</Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateOpen(true)}
            data-testid="api-key-create-button"
          >
            Создать ключ
          </Button>
        </Stack>

        {rows.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Список пуст — создайте первый ключ.
            </Typography>
          </Box>
        ) : (
          <Table size="small" data-testid="api-keys-table">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Token</TableCell>
                <TableCell>Создан</TableCell>
                <TableCell>Истекает</TableCell>
                <TableCell>Использован</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-testid={`api-key-row-${row.id}`}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>
                    ank_{row.keyPrefix}…{row.keyLastFour}
                  </TableCell>
                  <TableCell>{formatDate(row.createdAt)}</TableCell>
                  <TableCell>{formatExpires(row.expiresAt)}</TableCell>
                  <TableCell>{formatDate(row.lastUsedAt)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label="Отозвать"
                      data-testid={`api-key-revoke-${row.id}`}
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (globalThis.confirm(`Отозвать ключ «${row.name}»?`)) {
                          revoke.mutate({ id: row.id })
                        }
                      }}
                    >
                      {revoke.isPending && revoke.variables?.id === row.id ? (
                        <CircularProgress size={16} />
                      ) : (
                        <DeleteIcon fontSize="small" />
                      )}
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>

      <ApiKeyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(k) => {
          setCreateOpen(false)
          setRevealKey(k)
          utils.apiKey.list.invalidate()
        }}
      />
      <ApiKeyRevealDialog created={revealKey} onClose={() => setRevealKey(null)} />
    </Paper>
  )
}
