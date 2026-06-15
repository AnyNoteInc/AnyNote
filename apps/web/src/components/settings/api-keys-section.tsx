'use client'

import { useState } from 'react'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  AddIcon,
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  ExpandMoreIcon,
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
  if (!d) return 'Бессрочно'
  return formatDate(d)
}

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'https://api.anynote.ru'
const configSnippet = `{
  "mcpServers": {
    "anynote": {
      "url": "${apiBase}/mcp",
      "headers": {
        "Authorization": "Bearer ank_<ваш ключ>"
      }
    }
  }
}`

export function ApiKeysSection({ initialKeys }: Props) {
  const utils = trpc.useUtils()
  const list = trpc.apiKey.list.useQuery(undefined, { initialData: initialKeys })
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const revoke = trpc.apiKey.revoke.useMutation({
    onSuccess: () => utils.apiKey.list.invalidate(),
    onSettled: () => setRevokingId(null),
  })

  const [createOpen, setCreateOpen] = useState(false)
  const [revealKey, setRevealKey] = useState<CreatedKey | null>(null)

  const rows = list.data ?? []

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
                      disabled={revokingId !== null}
                      onClick={() => {
                        if (globalThis.confirm(`Отозвать ключ «${row.name}»?`)) {
                          setRevokingId(row.id)
                          revoke.mutate({ id: row.id })
                        }
                      }}
                    >
                      {revokingId === row.id ? (
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

        <Accordion variant="outlined" disableGutters sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Как подключить Claude Desktop / Cursor</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                {'Добавьте секцию '}
                <code>mcpServers</code>
                {' в '}
                <code>claude_desktop_config.json</code>
                {' (или эквивалент для другого клиента):'}
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 2,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  backgroundColor: 'action.hover',
                  borderRadius: 1,
                  overflowX: 'auto',
                  whiteSpace: 'pre',
                }}
              >
                {configSnippet}
              </Box>
            </Stack>
          </AccordionDetails>
        </Accordion>
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
