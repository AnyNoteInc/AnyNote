'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Plan, Subscription } from '@prisma/client'
import { Button, Chip, Paper, Stack, Typography } from '@repo/ui/components'

import { CancelSubscriptionDialog } from '@/components/billing/cancel-subscription-dialog'
import { getPlanDisplayName } from '@/components/billing/plan-labels'
import { formatKopecks } from '@/components/workspace/settings/billing-labels'
import { trpc } from '@/trpc/client'

type Props = {
  subscription: (Subscription & { plan: Plan }) | null
}

function formatDate(date: Date | null): string | null {
  return date ? new Date(date).toLocaleDateString('ru-RU') : null
}

function formatPrice(plan: Plan | null): string {
  if (!plan || plan.priceMonthlyKopecks === 0) return 'Бесплатно'
  return `${(plan.priceMonthlyKopecks / 100).toLocaleString('ru-RU')} ${plan.currency}/мес`
}

export function CurrentPlanCard({ subscription }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [showCancel, setShowCancel] = useState(false)
  const resume = trpc.subscription.resume.useMutation({
    onSuccess: async () => {
      await utils.subscription.getCurrent.invalidate()
      router.refresh()
    },
  })

  const plan = subscription?.plan ?? null
  const planName = getPlanDisplayName({ slug: plan?.slug, name: plan?.name })
  const isPaid = plan?.slug !== undefined && plan.slug !== 'personal'
  const periodEnd = formatDate(subscription?.currentPeriodEnd ?? null)

  // The next-renewal seat breakdown (8D spec §6). Zero purchased seats ⇒ the
  // line stays hidden and the card reads exactly as before.
  const chargeQ = trpc.subscription.nextChargePreview.useQuery(undefined, { enabled: isPaid })
  const charge = chargeQ.data ?? null
  const showSeatBreakdown = isPaid && charge !== null && charge.totalSeatKopecks > 0

  const statusLabel = isPaid
    ? subscription?.cancelAtPeriodEnd
      ? `Отменена, доступ до ${periodEnd ?? 'конца периода'}`
      : periodEnd
        ? `Активна, продление ${periodEnd}`
        : 'Активна'
    : 'Бесплатный тариф'

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          spacing={2}
        >
          <Chip
            label={planName}
            color={isPaid ? 'success' : 'default'}
            variant={isPaid ? 'filled' : 'outlined'}
          />
          <Stack spacing={0.25}>
            <Typography fontWeight={700}>{statusLabel}</Typography>
            <Typography variant="body2" color="text.secondary">
              {formatPrice(plan)}
            </Typography>
            {showSeatBreakdown ? (
              <Typography variant="body2" color="text.secondary" data-testid="next-charge-preview">
                Следующее списание: тариф {formatKopecks(charge.tierKopecks)} + места{' '}
                {formatKopecks(charge.totalSeatKopecks)} = {formatKopecks(charge.totalKopecks)}
              </Typography>
            ) : null}
          </Stack>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {!isPaid ? (
            <Button component={Link} href="/pricing" variant="contained">
              Перейти на ПРО
            </Button>
          ) : null}
          {isPaid && !subscription?.cancelAtPeriodEnd ? (
            <Button color="error" variant="outlined" onClick={() => setShowCancel(true)}>
              Отменить подписку
            </Button>
          ) : null}
          {isPaid && subscription?.cancelAtPeriodEnd ? (
            <Button variant="contained" onClick={() => resume.mutate()} disabled={resume.isPending}>
              {resume.isPending ? 'Возобновляем...' : 'Возобновить'}
            </Button>
          ) : null}
          {isPaid ? (
            <Button component={Link} href="/pricing" variant="text">
              Сменить тариф
            </Button>
          ) : null}
        </Stack>
      </Stack>
      <CancelSubscriptionDialog
        open={showCancel}
        periodEnd={subscription?.currentPeriodEnd ?? null}
        onClose={() => setShowCancel(false)}
      />
    </Paper>
  )
}
