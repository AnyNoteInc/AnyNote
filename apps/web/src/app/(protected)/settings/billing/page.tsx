import { Stack, Typography } from "@repo/ui/components"

import { CurrentPlanCard } from "@/components/settings/current-plan-card"
import { SubscriptionHistoryTable } from "@/components/settings/subscription-history-table"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Оплата · Настройки" }

export default async function BillingSettingsPage() {
  const trpc = await getServerTRPC()
  const [current, history] = await Promise.all([
    trpc.subscription.getCurrent(),
    trpc.subscription.listHistory(),
  ])

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h5" fontWeight={700}>Оплата</Typography>
        <Typography variant="body2" color="text.secondary">
          Текущий тариф и история покупок
        </Typography>
      </Stack>
      <CurrentPlanCard plan={current.plan} subscription={current.subscription} />
      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={700}>История</Typography>
        <SubscriptionHistoryTable rows={history} />
      </Stack>
    </Stack>
  )
}
