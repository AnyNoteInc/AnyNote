'use client'

import { Alert, Box, CircularProgress, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SeatUsageCard } from './seat-usage-card'
import { SeatPurchaseCard } from './seat-purchase-card'
import { SeatEventsTable } from './seat-events-table'
import { InvoiceRequestCard } from './invoice-request-card'

type Props = {
  workspaceId: string
  /**
   * Viewer === workspace.createdById — the subscription holder. Any OWNER may
   * VIEW everything here; only the holder moves money (purchase/reduction),
   * matching the router's NOT_SUBSCRIPTION_OWNER gate.
   */
  isSubscriptionHolder: boolean
}

/**
 * «Биллинг мест» (8D spec §6) — OWNER-only (the dialog gates the section) and
 * deliberately NOT plan-locked: on personal the usage card explains seat
 * economics with an upgrade pointer. Cards: usage, purchase+reduction (only
 * when the plan sells seats), the ledger, the юрлицо invoice request.
 */
export function WorkspaceBillingSection({ workspaceId, isSubscriptionHolder }: Props) {
  const usageQ = trpc.billing.seatUsage.useQuery({ workspaceId })

  if (usageQ.isPending) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (usageQ.isError) {
    return <Alert severity="error">{usageQ.error.message}</Alert>
  }
  const usage = usageQ.data

  return (
    <Stack spacing={3}>
      <SeatUsageCard
        workspaceId={workspaceId}
        usage={usage}
        isSubscriptionHolder={isSubscriptionHolder}
      />
      {usage.seatPrice ? (
        <SeatPurchaseCard
          workspaceId={workspaceId}
          usage={usage}
          isSubscriptionHolder={isSubscriptionHolder}
        />
      ) : null}
      <SeatEventsTable workspaceId={workspaceId} />
      <InvoiceRequestCard workspaceId={workspaceId} memberCount={usage.memberCount} />
    </Stack>
  )
}
