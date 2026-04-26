import type { Subscription } from '@prisma/client'
import { Paper, Stack, Typography } from '@repo/ui/components'

export function PaymentMethodCard({ subscription }: { subscription: Subscription }) {
  if (!subscription.paymentMethodId) return null

  const brand = subscription.paymentMethodBrand ?? 'card'
  const last4 = subscription.paymentMethodLast4 ?? '----'

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={0.75}>
        <Typography variant="overline" color="text.secondary">
          Способ оплаты
        </Typography>
        <Typography fontWeight={700}>
          {brand.toUpperCase()} **** {last4}
        </Typography>
      </Stack>
    </Paper>
  )
}
