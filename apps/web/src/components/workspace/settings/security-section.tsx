'use client'

import { Stack } from '@repo/ui/components'

import { SecurityPolicyCard } from './security-policy-card'
import { GuestRequestsCard } from './guest-requests-card'
import { ContentSearchPanel } from './content-search-panel'

type Props = {
  workspaceId: string
}

/**
 * «Безопасность» (8C spec §6) — OWNER-only (the dialog gates the section) and
 * deliberately NOT plan-gated: security must not be paywalled, free workspaces
 * see it too. Three blocks: the policy switches, the guest-request queue, and
 * the audited admin content search.
 */
export function WorkspaceSecuritySection({ workspaceId }: Props) {
  return (
    <Stack spacing={3}>
      <SecurityPolicyCard workspaceId={workspaceId} />
      <GuestRequestsCard workspaceId={workspaceId} />
      <ContentSearchPanel workspaceId={workspaceId} />
    </Stack>
  )
}
