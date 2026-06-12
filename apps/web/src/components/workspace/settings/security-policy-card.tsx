'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
}

type PolicyFlag =
  | 'disableGuestInvites'
  | 'allowGuestInviteRequests'
  | 'disablePublicLinksSitesForms'
  | 'disableExport'
  | 'disableMoveDuplicateOutsideWorkspace'

function PolicySwitch({
  label,
  helper,
  checked,
  disabled,
  nested,
  testId,
  onToggle,
}: {
  label: string
  /** Honest helper text — names what the flag really does (spec §6). */
  helper: string
  checked: boolean
  disabled: boolean
  /** Visually nested under its parent switch (the requests-under-invites case). */
  nested?: boolean
  testId?: string
  onToggle: (next: boolean) => void
}) {
  return (
    <Box sx={nested ? { pl: 4 } : undefined}>
      <FormControlLabel
        control={
          <Switch
            // The invite-link-card precedent: the testid lives on the root.
            data-testid={testId}
            checked={checked}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
        }
        label={label}
      />
      <Typography variant="body2" color="text.secondary" sx={{ pl: 5.75, mt: -0.5 }}>
        {helper}
      </Typography>
    </Box>
  )
}

/**
 * «Политики безопасности» (8C spec §6) — the five owner-patchable flags.
 * Enforcement is SERVER-side at the chokepoints; these switches are the
 * configuration surface, with helper texts that say what actually happens.
 */
export function SecurityPolicyCard({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)

  const policyQ = trpc.security.getPolicy.useQuery({ workspaceId })
  const update = trpc.security.updatePolicy.useMutation({
    onSuccess: () => {
      setError(null)
      void utils.security.getPolicy.invalidate({ workspaceId })
    },
    onError: (e: { message: string }) => setError(e.message),
  })

  const policy = policyQ.data
  const toggle = (flag: PolicyFlag) => (next: boolean) =>
    update.mutate({ workspaceId, patch: { [flag]: next } })
  const busy = update.isPending

  return (
    <SettingsCard
      title="Политики безопасности"
      description="Ограничения применяются на сервере для всех участников пространства."
    >
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {policyQ.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={20} />
        </Box>
      ) : policyQ.isError ? (
        <Alert severity="error">{policyQ.error.message}</Alert>
      ) : policy ? (
        <Stack spacing={1.5}>
          <PolicySwitch
            label="Запретить гостевые приглашения"
            helper="Участники не смогут приглашать гостей к страницам — ни по email, ни точечным доступом для людей вне пространства."
            checked={policy.disableGuestInvites}
            disabled={busy}
            testId="security-policy-guests"
            onToggle={toggle('disableGuestInvites')}
          />
          {/* Nested: requests exist only in the gap the parent switch opens —
              the toggle is disabled until guest invites are DISABLED. */}
          <PolicySwitch
            label="Разрешить запросы на гостевой доступ"
            helper={
              policy.disableGuestInvites
                ? 'Участники смогут отправить запрос — вы одобряете или отклоняете его в очереди ниже.'
                : 'Действует только при запрещённых гостевых приглашениях.'
            }
            checked={policy.allowGuestInviteRequests}
            disabled={busy || !policy.disableGuestInvites}
            nested
            testId="security-policy-guest-requests"
            onToggle={toggle('allowGuestInviteRequests')}
          />
          <PolicySwitch
            label="Отключить публичные ссылки и сайты"
            helper="Существующие публичные ссылки перестанут открываться (включая опубликованные сайты). Ссылки не удаляются — после выключения политики они заработают снова."
            checked={policy.disablePublicLinksSitesForms}
            disabled={busy}
            testId="security-policy-links"
            onToggle={toggle('disablePublicLinksSitesForms')}
          />
          <PolicySwitch
            label="Отключить экспорт"
            helper="Экспорт страниц и пространства (Markdown, CSV, PDF) будет запрещён. Ранее созданные файлы экспорта остаются доступными."
            checked={policy.disableExport}
            disabled={busy}
            testId="security-policy-export"
            onToggle={toggle('disableExport')}
          />
          <PolicySwitch
            label="Запретить копирование в другие пространства"
            helper="Страницы этого пространства нельзя будет скопировать в другие пространства."
            checked={policy.disableMoveDuplicateOutsideWorkspace}
            disabled={busy}
            onToggle={toggle('disableMoveDuplicateOutsideWorkspace')}
          />
        </Stack>
      ) : null}
    </SettingsCard>
  )
}
