import { Container, Stack, Typography } from '@repo/ui/components'
import { prisma } from '@repo/db'

import { OrderHistoryTable } from '@/components/billing/order-history-table'
import { PaymentMethodCard } from '@/components/billing/payment-method-card'
import { CurrentPlanCard } from '@/components/settings/current-plan-card'
import { requireSession } from '@/lib/get-session'

export const metadata = { title: 'Оплата · Настройки' }

export default async function BillingSettingsPage() {
  const session = await requireSession()
  const [subscription, orders] = await Promise.all([
    prisma.subscription.findFirst({
      where: { userId: session.user.id, status: 'ACTIVE' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.order.findMany({
      where: { userId: session.user.id },
      include: { plan: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ])

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack spacing={4}>
        <Stack spacing={0.5}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Подписка и оплата
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Текущий тариф, способ оплаты и история платежей.
          </Typography>
        </Stack>
        <CurrentPlanCard subscription={subscription} />
        {subscription?.paymentMethodId ? <PaymentMethodCard subscription={subscription} /> : null}
        <OrderHistoryTable orders={orders} />
      </Stack>
    </Container>
  )
}
