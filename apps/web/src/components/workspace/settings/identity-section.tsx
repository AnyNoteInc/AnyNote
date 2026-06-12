'use client'

import { Alert, Stack } from '@repo/ui/components'

import { AllowedDomainsCard } from './allowed-domains-card'
import { VerifiedDomainsCard } from './verified-domains-card'
import { AuthProvidersCard } from './auth-providers-card'
import { EnterpriseCard } from './enterprise-card'

type Props = {
  workspaceId: string
  /**
   * The workspace owner's plan gates the feature (members-section precedent) —
   * locked disables every mutation but the lists stay visible.
   */
  locked: boolean
}

/**
 * «Домены и вход» (spec §6) — visible to OWNER only (the dialog gates it):
 * domain auto-join, DNS domain verification, SSO providers and the honest
 * enterprise pre-sales card.
 */
export function WorkspaceIdentitySection({ workspaceId, locked }: Props) {
  return (
    <Stack spacing={3}>
      {locked ? (
        <Alert severity="info">
          Домены и корпоративный вход доступны на платных тарифах.{' '}
          <a href="/settings/billing">Апгрейд</a>
        </Alert>
      ) : null}
      <AllowedDomainsCard workspaceId={workspaceId} locked={locked} />
      <VerifiedDomainsCard workspaceId={workspaceId} locked={locked} />
      <AuthProvidersCard workspaceId={workspaceId} locked={locked} />
      <EnterpriseCard workspaceId={workspaceId} locked={locked} />
    </Stack>
  )
}
