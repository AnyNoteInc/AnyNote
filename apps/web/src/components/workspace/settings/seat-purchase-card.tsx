'use client'

import { useEffect, useState } from 'react'

import { Alert, Box, Button, Divider, Stack, TextField, Typography } from '@repo/ui/components'

// Deep-import the client-safe dto leaf (NOT the @repo/domain root barrel) —
// the verified-domains-card precedent.
import { MAX_SEAT_PURCHASE, MIN_SEAT_PURCHASE } from '@repo/domain/seats/dto/seats.dto.ts'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'
import { formatKopecks, type SeatUsageWire } from './billing-labels'

type Props = {
  workspaceId: string
  usage: SeatUsageWire
  /** Money procs are holder-only (NOT_SUBSCRIPTION_OWNER) — disable, don't 403. */
  isSubscriptionHolder: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Client-side DISPLAY estimate of the prorated charge: the server's
 * `prorateSeatPurchase` needs `periodStart`, which `seatUsage` doesn't carry —
 * approximate the period length from the billing period (30/365 days). The
 * SERVER amount is authoritative; the copy says so.
 */
function estimateProratedKopecks(
  seats: number,
  seatPrice: NonNullable<SeatUsageWire['seatPrice']>,
  periodEnd: SeatUsageWire['periodEnd'],
): number | null {
  if (!periodEnd) return null
  const end = new Date(periodEnd).getTime()
  if (!Number.isFinite(end) || end <= Date.now()) return null
  const periodMs = (seatPrice.billingPeriod === 'MONTHLY' ? 30 : 365) * DAY_MS
  const remainingMs = Math.min(end - Date.now(), periodMs)
  return Math.max(1, Math.ceil((seats * seatPrice.currentKopecks * remainingMs) / periodMs))
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return min
  return Math.min(Math.max(n, min), max)
}

function SeatStepper({
  value,
  onChange,
  min,
  max,
  disabled,
  testId,
}: {
  value: number
  onChange: (next: number) => void
  min: number
  max: number
  disabled?: boolean
  testId: string
}) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        sx={{ minWidth: 36 }}
        aria-label="Меньше"
        disabled={disabled || value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </Button>
      <TextField
        size="small"
        type="number"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(clampInt(event.target.value, min, max))}
        sx={{ width: 88 }}
        slotProps={{ htmlInput: { min, max, 'data-testid': testId } }}
      />
      <Button
        variant="outlined"
        color="inherit"
        size="small"
        sx={{ minWidth: 36 }}
        aria-label="Больше"
        disabled={disabled || value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </Button>
    </Stack>
  )
}

/**
 * Purchase + reduction (8D spec §6). Purchase charges the prorated remainder
 * NOW via YooKassa (the checkout-modal redirect pattern); reduction applies
 * from the NEXT renewal — never a mid-cycle refund. Rendered only when the
 * plan sells seats (`usage.seatPrice != null`).
 */
export function SeatPurchaseCard({ workspaceId, usage, isSubscriptionHolder }: Props) {
  const utils = trpc.useUtils()
  const [seats, setSeats] = useState(MIN_SEAT_PURCHASE)
  const [error, setError] = useState<string | null>(null)
  const [reduceNotice, setReduceNotice] = useState<string | null>(null)

  const seatPrice = usage.seatPrice
  const moneyDisabled = !isSubscriptionHolder || !usage.canPurchase

  const purchase = trpc.billing.purchaseSeats.useMutation({
    onSuccess: ({ confirmationUrl }) => {
      window.location.href = confirmationUrl
    },
    onError: (e) => setError(e.message),
  })

  // ── reduction state ─────────────────────────────────────────────────────────
  // Capacity after the reduction must still fit the CURRENT member count
  // (REDUCTION_BELOW_USAGE) and the target must be strictly below paidSeats.
  const minTarget = Math.max(0, usage.memberCount - usage.includedSeats)
  const maxTarget = usage.paidSeats - 1
  const reductionPossible = usage.paidSeats > 0 && minTarget <= maxTarget
  const [target, setTarget] = useState(() => Math.max(minTarget, 0))
  useEffect(() => {
    // Re-clamp when a purchase/renewal moves the bounds under the form.
    setTarget((t) => Math.min(Math.max(t, minTarget), Math.max(maxTarget, 0)))
  }, [minTarget, maxTarget])

  const scheduleReduction = trpc.billing.scheduleReduction.useMutation({
    onSuccess: (state) => {
      setError(null)
      setReduceNotice(
        `Уменьшение запланировано: ${state.scheduledSeats ?? 0} докупленных мест со следующего списания.`,
      )
      void utils.billing.seatUsage.invalidate({ workspaceId })
    },
    onError: (e) => {
      setReduceNotice(null)
      setError(e.message)
    },
  })

  const estimate = seatPrice ? estimateProratedKopecks(seats, seatPrice, usage.periodEnd) : null

  return (
    <SettingsCard
      title="Платные места"
      description="Докупка действует сразу — с пропорциональной доплатой до конца оплаченного периода. Уменьшение вступает в силу со следующего списания."
    >
      {!usage.canPurchase ? (
        <Alert severity="warning">
          Покупка мест доступна только при активной подписке — сначала продлите её.
        </Alert>
      ) : null}

      {/* ── buy ───────────────────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Докупить места
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <SeatStepper
            value={seats}
            onChange={setSeats}
            min={MIN_SEAT_PURCHASE}
            max={MAX_SEAT_PURCHASE}
            disabled={moneyDisabled || purchase.isPending}
            testId="billing-buy-seats-count"
          />
          <Button
            variant="contained"
            data-testid="billing-buy-seats"
            disabled={moneyDisabled}
            loading={purchase.isPending}
            onClick={() => purchase.mutate({ workspaceId, seats })}
          >
            Купить
          </Button>
        </Stack>
        {estimate !== null ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Доплата до конца периода ≈ {formatKopecks(estimate)} — точная сумма на странице оплаты.
          </Typography>
        ) : null}
      </Box>

      <Divider />

      {/* ── reduce ────────────────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Уменьшить количество докупленных мест
        </Typography>
        {usage.paidSeats === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Докупленных мест нет — уменьшать нечего.
          </Typography>
        ) : !reductionPossible ? (
          <Typography variant="body2" color="text.secondary">
            Все докупленные места заняты участниками — сначала удалите участников.
          </Typography>
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ sm: 'center' }}
            >
              <SeatStepper
                value={target}
                onChange={setTarget}
                min={minTarget}
                max={maxTarget}
                disabled={!isSubscriptionHolder || scheduleReduction.isPending}
                testId="billing-reduce-seats-target"
              />
              <Button
                variant="outlined"
                color="inherit"
                data-testid="billing-reduce-seats"
                disabled={!isSubscriptionHolder}
                loading={scheduleReduction.isPending}
                onClick={() => scheduleReduction.mutate({ workspaceId, targetSeats: target })}
              >
                Запланировать уменьшение
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              Останется докупленных мест: {target} из {usage.paidSeats}
              {minTarget > 0
                ? `; минимум ${minTarget} — ниже не позволяет текущее число участников`
                : ''}
              . Оплата за текущий период не пересчитывается.
            </Typography>
          </>
        )}
      </Box>

      {reduceNotice ? (
        <Alert severity="success" onClose={() => setReduceNotice(null)}>
          {reduceNotice}
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
    </SettingsCard>
  )
}
