import { Box, Button, Chip, Stack, Typography } from "@repo/ui/components"

type Plan = {
  name: string
  slug: string
  priceMonthly: number
  currency: string
  maxWorkspaces: number | null
  features: unknown
}

type Subscription = {
  status: string
  startedAt: Date
  currentPeriodEnd: Date | null
}

function formatPrice(minor: number, currency: string): string {
  if (minor === 0) return "Бесплатно"
  const major = minor / 100
  return `${major.toLocaleString("ru-RU")} ${currency}/мес`
}

export function CurrentPlanCard({ plan, subscription }: { plan: Plan; subscription: Subscription }) {
  const features = Array.isArray(plan.features) ? (plan.features as string[]) : []
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 3, backgroundColor: "background.paper" }}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h5" fontWeight={700}>{plan.name}</Typography>
            <Chip
              size="small"
              label={subscription.status}
              color={subscription.status === "ACTIVE" ? "success" : "default"}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {formatPrice(plan.priceMonthly, plan.currency)}
            {plan.maxWorkspaces !== null &&
              ` · до ${plan.maxWorkspaces} ${plan.maxWorkspaces === 1 ? "пространства" : "пространств"}`}
          </Typography>
          {features.length > 0 && (
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5, color: "text.secondary" }}>
              {features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </Stack>
          )}
        </Stack>
        <Button variant="contained" disabled>Обновить тариф</Button>
      </Stack>
    </Box>
  )
}
