'use client'

import { useState } from 'react'

import { Alert, Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { formatDateRu, formatKopecks, type SeatUsageWire } from './billing-labels'

type Props = {
  workspaceId: string
  usage: SeatUsageWire
  /** workspace.createdById === viewer — only the paying owner moves money. */
  isSubscriptionHolder: boolean
}

/**
 * «Занято M из K мест» (8D spec §6). Any OWNER sees the numbers; the
 * cancel-reduction action is holder-only (the router's NOT_SUBSCRIPTION_OWNER
 * gate) — a non-holder OWNER gets the honest note instead.
 */
export function SeatUsageCard({ workspaceId, usage, isSubscriptionHolder }: Props) {
  const utils = trpc.useUtils()
  const [error, setError] = useState<string | null>(null)

  const cancelReduction = trpc.billing.cancelReduction.useMutation({
    onSuccess: () => {
      setError(null)
      void utils.billing.seatUsage.invalidate({ workspaceId })
    },
    onError: (e) => setError(e.message),
  })

  return (
    <SettingsCard
      title="Места"
      description="Каждый участник пространства занимает одно место. Гости и приглашённые на отдельные страницы бесплатны."
    >
      <Box data-testid="billing-seat-usage">
        <Typography variant="body1">
          Занято {usage.memberCount} из {usage.capacity} мест: {usage.includedSeats} по тарифу
          {usage.paidSeats > 0 ? ` + ${usage.paidSeats} докупленных` : ''}.
        </Typography>
        {usage.seatPrice ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Дополнительное место — {formatKopecks(usage.seatPrice.currentKopecks)} за{' '}
            {usage.seatPrice.billingPeriod === 'MONTHLY' ? 'месяц' : 'год'}
            {usage.periodEnd ? `; оплаченный период до ${formatDateRu(usage.periodEnd)}` : ''}.
          </Typography>
        ) : usage.periodEnd ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Оплаченный период до {formatDateRu(usage.periodEnd)}.
          </Typography>
        ) : null}
      </Box>

      {usage.scheduledSeats !== null ? (
        <Alert
          severity="info"
          action={
            isSubscriptionHolder ? (
              <Button
                color="inherit"
                size="small"
                data-testid="billing-cancel-reduction"
                loading={cancelReduction.isPending}
                onClick={() => cancelReduction.mutate({ workspaceId })}
              >
                Отменить
              </Button>
            ) : undefined
          }
        >
          Со следующего списания: {usage.includedSeats + usage.scheduledSeats} мест (
          {usage.scheduledSeats} докупленных). Деньги за текущий период не возвращаются.
        </Alert>
      ) : null}

      {!usage.seatPrice ? (
        <Alert severity="info">
          На текущем тарифе докупка мест недоступна — расширять команду можно после перехода на
          платный тариф. <a href="/pricing">Посмотреть тарифы</a>
        </Alert>
      ) : null}

      {usage.seatPrice && !isSubscriptionHolder ? (
        <Stack>
          <Typography variant="body2" color="text.secondary">
            Покупкой и сокращением мест управляет владелец подписки.
          </Typography>
        </Stack>
      ) : null}

      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </SettingsCard>
  )
}
