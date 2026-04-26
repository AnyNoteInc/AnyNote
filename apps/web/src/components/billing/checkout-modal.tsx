"use client"

import { useState } from "react"
import Link from "next/link"

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type BillingPeriod = "MONTHLY" | "YEARLY"
type CheckoutPlanSlug = "pro" | "max"

type Props = {
  planSlug: CheckoutPlanSlug
  defaultPeriod: BillingPeriod
  onClose: () => void
}

const PRICES_RUB: Record<CheckoutPlanSlug, Record<BillingPeriod, number>> = {
  pro: { MONTHLY: 150, YEARLY: 1000 },
  max: { MONTHLY: 1500, YEARLY: 12000 },
}

const PLAN_NAMES: Record<CheckoutPlanSlug, string> = {
  pro: "Pro",
  max: "Max",
}

export function CheckoutModal({ planSlug, defaultPeriod, onClose }: Props) {
  const [period, setPeriod] = useState<BillingPeriod>(defaultPeriod)
  const [agreed, setAgreed] = useState(false)
  const startCheckout = trpc.subscription.startCheckout.useMutation({
    onSuccess: ({ confirmationUrl }) => {
      window.location.href = confirmationUrl
    },
  })

  const amount = PRICES_RUB[planSlug][period]
  const periodLabel = period === "MONTHLY" ? "месяц" : "год"

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Подписка {PLAN_NAMES[planSlug]}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {(["MONTHLY", "YEARLY"] as const).map((value) => (
              <Button
                key={value}
                fullWidth
                variant={period === value ? "contained" : "outlined"}
                color={period === value ? "primary" : "inherit"}
                onClick={() => setPeriod(value)}
              >
                {value === "MONTHLY" ? "Месяц" : "Год"} · {PRICES_RUB[planSlug][value].toLocaleString("ru-RU")} ₽
              </Button>
            ))}
          </Stack>

          <Stack spacing={0.75}>
            <Typography variant="h5" fontWeight={700}>
              К оплате: {amount.toLocaleString("ru-RU")} ₽
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Подписка автоматически продлится через {periodLabel}. Ее можно отменить в настройках
              биллинга до даты продления.
            </Typography>
          </Stack>

          <Box
            component="label"
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "flex-start",
              cursor: "pointer",
              color: "text.secondary",
            }}
          >
            <Checkbox
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              sx={{ mt: -1 }}
            />
            <Typography variant="body2">
              Принимаю условия{" "}
              <Box component={Link} href="/oferta" sx={{ color: "primary.main" }}>
                договора-оферты
              </Box>
            </Typography>
          </Box>

          {startCheckout.error ? <Alert severity="error">{startCheckout.error.message}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={startCheckout.isPending}>
          Отмена
        </Button>
        <Button
          variant="contained"
          disabled={!agreed || startCheckout.isPending}
          onClick={() => startCheckout.mutate({ planSlug, period })}
        >
          {startCheckout.isPending ? "Создаем платеж..." : `Оплатить ${amount.toLocaleString("ru-RU")} ₽`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
