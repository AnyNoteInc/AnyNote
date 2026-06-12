'use client'

import { useState } from 'react'

import { Alert, Box, Button, Chip, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

type Props = {
  workspaceId: string
  locked: boolean
}

type EnterpriseFeature = 'SAML' | 'SCIM' | 'MANAGED_USERS'

// The SAML button carries the spec's exact testid (the E2E flow requests
// SAML); the other two get suffixed variants to keep selectors unambiguous.
const FEATURES: {
  key: EnterpriseFeature
  title: string
  description: string
  testid: string
}[] = [
  {
    key: 'SAML',
    title: 'SAML SSO',
    description: 'Вход через корпоративный SAML-провайдер (Active Directory FS, Okta и другие).',
    testid: 'identity-enterprise-request',
  },
  {
    key: 'SCIM',
    title: 'SCIM-провижининг',
    description: 'Автоматическое создание и деактивация учётных записей из корпоративного каталога.',
    testid: 'identity-enterprise-request-scim',
  },
  {
    key: 'MANAGED_USERS',
    title: 'Управляемые пользователи',
    description: 'Централизованное управление учётными записями сотрудников владельцем домена.',
    testid: 'identity-enterprise-request-managed-users',
  },
]

/**
 * «Корпоративные функции» — honest pre-sales (spec §7 invariant 6): the
 * features have NO live endpoints, the UI never pretends otherwise, and
 * «Запросить ранний доступ» only writes the audit record server-side.
 */
export function EnterpriseCard({ workspaceId, locked }: Props) {
  const [notice, setNotice] = useState<{ severity: 'error' | 'success'; text: string } | null>(null)
  const [pendingFeature, setPendingFeature] = useState<EnterpriseFeature | null>(null)
  const [requested, setRequested] = useState<Set<EnterpriseFeature>>(new Set())

  const request = trpc.identity.providers.requestEnterprise.useMutation({
    onSuccess: (result) => {
      setPendingFeature(null)
      setRequested((prev) => new Set(prev).add(result.feature))
      setNotice({ severity: 'success', text: 'Заявка записана. Мы свяжемся с вами.' })
    },
    onError: (e: { message: string }) => {
      setPendingFeature(null)
      setNotice({ severity: 'error', text: e.message })
    },
  })

  return (
    <SettingsCard
      title="Корпоративные функции"
      description="SAML, SCIM и управляемые пользователи находятся в разработке. Оставьте заявку, чтобы получить ранний доступ."
    >
      {notice ? (
        <Alert severity={notice.severity} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      ) : null}

      <Stack spacing={1}>
        {FEATURES.map((feature) => (
          <Box
            key={feature.key}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle2">{feature.title}</Typography>
                  <Chip size="small" variant="outlined" label="Недоступно в текущей версии" />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {feature.description}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                data-testid={feature.testid}
                loading={request.isPending && pendingFeature === feature.key}
                disabled={locked || request.isPending || requested.has(feature.key)}
                onClick={() => {
                  setPendingFeature(feature.key)
                  request.mutate({ workspaceId, feature: feature.key })
                }}
                sx={{ flexShrink: 0 }}
              >
                {requested.has(feature.key) ? 'Заявка отправлена' : 'Запросить ранний доступ'}
              </Button>
            </Stack>
          </Box>
        ))}
      </Stack>
    </SettingsCard>
  )
}
