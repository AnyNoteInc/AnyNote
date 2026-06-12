'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  DeleteIcon,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
  /** Owner's plan is free — the identity routers are paid-gated UX-wise. */
  locked: boolean
}

/**
 * «Разрешённые домены» — the domain auto-join surface (spec §6). Anyone whose
 * e-mail domain is listed here can join the workspace in one click — as a
 * BILLABLE member (EDITOR), never a guest. Public e-mail domains are rejected
 * server-side (PUBLIC_EMAIL_DOMAIN) and the message is surfaced as-is.
 */
export function AllowedDomainsCard({ workspaceId, locked }: Props) {
  const utils = trpc.useUtils()
  const [domain, setDomain] = useState('')
  const [error, setError] = useState<string | null>(null)

  const listQ = trpc.identity.allowedDomains.list.useQuery({ workspaceId })
  const invalidate = () => utils.identity.allowedDomains.list.invalidate({ workspaceId })

  const add = trpc.identity.allowedDomains.add.useMutation({
    onSuccess: () => {
      setDomain('')
      setError(null)
      void invalidate()
    },
    onError: (e: { message: string }) => setError(e.message),
  })
  const remove = trpc.identity.allowedDomains.remove.useMutation({
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (e: { message: string }) => setError(e.message),
  })

  return (
    <SettingsCard
      title="Разрешённые домены"
      description="Коллеги с почтой на этих доменах смогут присоединиться к пространству в один клик."
    >
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <Alert severity="warning">
        Присоединившиеся по домену станут платными участниками пространства с ролью «Редактор» и
        займут места тарифа.
      </Alert>

      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          label="Домен почты"
          placeholder="company.ru"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          disabled={locked || add.isPending}
          size="small"
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { 'data-testid': 'identity-allowed-domain-input' } }}
        />
        <Button
          data-testid="identity-allowed-add"
          onClick={() => add.mutate({ workspaceId, domain: domain.trim() })}
          loading={add.isPending}
          disabled={locked || domain.trim().length < 3}
        >
          Добавить
        </Button>
      </Stack>

      {listQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : listQ.isError ? (
        <Alert severity="error">{listQ.error.message}</Alert>
      ) : listQ.data.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Разрешённых доменов пока нет.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {listQ.data.map((row) => (
            <Box
              key={row.id}
              data-testid="identity-allowed-row"
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1, pl: 1.5 }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {row.domain}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Удалить домен ${row.domain}`}
                  onClick={() => remove.mutate({ workspaceId, domainId: row.id })}
                  disabled={locked || remove.isPending}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </SettingsCard>
  )
}
