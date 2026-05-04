'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@repo/ui/components'

import { CheckoutModal } from './checkout-modal'
import { getPlanDisplayName } from './plan-labels'

type BillingPeriod = 'MONTHLY' | 'YEARLY'
type CheckoutPlanSlug = 'pro' | 'max'

export type PricingTierPlan = {
  id: string
  slug: string
  name: string
  description: string
  priceMonthlyKopecks: number
  priceYearlyKopecks: number
  currency: string
  features: string[]
  sortOrder: number
}

type Props = {
  plans: PricingTierPlan[]
  currentPlanSlug: string | null
  isAuthenticated: boolean
}

type CheckoutState = {
  planSlug: CheckoutPlanSlug
  defaultPeriod: BillingPeriod
}

const CUSTOM_TIER = {
  slug: 'custom',
  name: 'Собственная инфраструктура',
  description:
    'Для компаний, которым нужен выделенный контур, SLA и интеграции под внутренние процессы.',
  features: [
    'Self-hosted или частное облако',
    'SLA и приоритетная поддержка',
    'Индивидуальные интеграции',
  ],
}

function isBillingPeriod(value: string | null): value is BillingPeriod {
  return value === 'MONTHLY' || value === 'YEARLY'
}

function isCheckoutPlanSlug(value: string): value is CheckoutPlanSlug {
  return value === 'pro' || value === 'max'
}

function formatCurrency(amountKopecks: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountKopecks / 100)
}

function getPriceLabel(plan: PricingTierPlan, period: BillingPeriod): string {
  if (plan.priceMonthlyKopecks === 0 && plan.priceYearlyKopecks === 0) {
    return 'Бесплатно'
  }

  if (period === 'YEARLY') {
    const yearly = formatCurrency(plan.priceYearlyKopecks, plan.currency)
    return `${yearly} / год`
  }

  return `${formatCurrency(plan.priceMonthlyKopecks, plan.currency)} / месяц`
}

function getYearlyHint(plan: PricingTierPlan): string | null {
  if (plan.priceMonthlyKopecks === 0 || plan.priceYearlyKopecks === 0) return null

  const yearlyByMonth = plan.priceMonthlyKopecks * 12
  const discount = yearlyByMonth - plan.priceYearlyKopecks
  if (discount <= 0) return null

  return `Экономия ${formatCurrency(discount, plan.currency)} в год`
}

function buildPurchaseUrl(planSlug: string, period: BillingPeriod, mode: 'sign-in' | 'sign-up') {
  const params = new URLSearchParams({
    intent: 'purchase',
    plan: planSlug,
    period,
    redirect: '/pricing',
  })
  return `/${mode}?${params.toString()}`
}

export function PricingTiers({ plans, currentPlanSlug, isAuthenticated }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const periodParam = searchParams.get('period')
  const initialPeriod: BillingPeriod = isBillingPeriod(periodParam) ? periodParam : 'MONTHLY'
  const [period, setPeriod] = useState<BillingPeriod>(initialPeriod)
  const [checkout, setCheckout] = useState<CheckoutState | null>(null)

  useEffect(() => {
    if (!isAuthenticated || searchParams.get('intent') !== 'purchase') return

    const planSlug = searchParams.get('plan')
    const requestedPeriod = searchParams.get('period')
    const nextPeriod = isBillingPeriod(requestedPeriod) ? requestedPeriod : 'MONTHLY'

    if (planSlug && isCheckoutPlanSlug(planSlug)) {
      setPeriod(nextPeriod)
      setCheckout({ planSlug, defaultPeriod: nextPeriod })
    }
  }, [isAuthenticated, searchParams])

  function handlePlanAction(plan: PricingTierPlan) {
    if (plan.slug === currentPlanSlug) return

    if (!isAuthenticated) {
      const mode = plan.slug === 'personal' ? 'sign-up' : 'sign-in'
      router.push(buildPurchaseUrl(plan.slug, period, mode))
      return
    }

    if (plan.slug === 'personal') {
      router.push('/settings/billing')
      return
    }

    if (isCheckoutPlanSlug(plan.slug)) {
      setCheckout({ planSlug: plan.slug, defaultPeriod: period })
    }
  }

  return (
    <Stack spacing={3.5}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
      >
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560 }}>
          Переключите период, чтобы сравнить ежемесячную оплату с годовой подпиской.
        </Typography>
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            p: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            backgroundColor: 'background.paper',
          }}
        >
          {(['MONTHLY', 'YEARLY'] as const).map((value) => (
            <Button
              key={value}
              size="small"
              variant={period === value ? 'contained' : 'text'}
              color={period === value ? 'primary' : 'inherit'}
              onClick={() => setPeriod(value)}
              aria-pressed={period === value}
              sx={{ minWidth: 104 }}
            >
              {value === 'MONTHLY' ? 'Месяц' : 'Год'}
            </Button>
          ))}
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(4, minmax(0, 1fr))',
          },
          gap: 2,
        }}
      >
        {plans.map((plan) => {
          const planName = getPlanDisplayName(plan)
          const isCurrent = plan.slug === currentPlanSlug
          const isPaid = plan.priceMonthlyKopecks > 0 || plan.priceYearlyKopecks > 0
          const yearlyHint = period === 'YEARLY' ? getYearlyHint(plan) : null
          const ctaLabel = isCurrent
            ? 'Текущий тариф'
            : !isAuthenticated
              ? plan.slug === 'personal'
                ? 'Начать бесплатно'
                : 'Войти и купить'
              : plan.slug === 'personal'
                ? 'Открыть биллинг'
                : currentPlanSlug === 'personal'
                  ? 'Купить'
                  : `Перейти на ${planName}`

          return (
            <Paper
              key={plan.id}
              elevation={0}
              sx={{
                p: 2.5,
                minHeight: 420,
                border: '1px solid',
                borderColor: plan.slug === 'pro' ? 'primary.main' : 'divider',
                borderRadius: 2,
                backgroundColor: 'background.paper',
                boxShadow: plan.slug === 'pro' ? '0 18px 42px rgba(15, 118, 110, 0.10)' : 'none',
              }}
            >
              <Stack spacing={2.25} sx={{ height: '100%' }}>
                <Stack spacing={1}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    justifyContent="space-between"
                  >
                    <Typography variant="h5" fontWeight={700}>
                      {planName}
                    </Typography>
                    {isCurrent ? <Chip size="small" color="success" label="Активен" /> : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                    {plan.description}
                  </Typography>
                </Stack>

                <Stack spacing={0.75}>
                  <Typography variant="h4" fontWeight={800}>
                    {getPriceLabel(plan, period)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ minHeight: 20 }}>
                    {yearlyHint ?? (isPaid ? 'Оплата через YooKassa' : 'Без платежной карты')}
                  </Typography>
                </Stack>

                <Divider />

                <Stack
                  component="ul"
                  spacing={1}
                  sx={{ m: 0, pl: 2.25, color: 'text.secondary', flex: 1 }}
                >
                  {plan.features.map((feature) => (
                    <Typography key={feature} component="li" variant="body2">
                      {feature}
                    </Typography>
                  ))}
                </Stack>

                <Button
                  fullWidth
                  variant={plan.slug === 'pro' ? 'contained' : 'outlined'}
                  color={plan.slug === 'pro' ? 'primary' : 'inherit'}
                  disabled={isCurrent}
                  onClick={() => handlePlanAction(plan)}
                >
                  {ctaLabel}
                </Button>
              </Stack>
            </Paper>
          )
        })}

        <Paper
          elevation={0}
          sx={{
            p: 2.5,
            minHeight: 420,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            backgroundColor: 'background.paper',
          }}
        >
          <Stack spacing={2.25} sx={{ height: '100%' }}>
            <Stack spacing={1}>
              <Typography variant="h5" fontWeight={700}>
                {CUSTOM_TIER.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40 }}>
                {CUSTOM_TIER.description}
              </Typography>
            </Stack>

            <Stack spacing={0.75}>
              <Typography variant="h4" fontWeight={800}>
                По запросу
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ minHeight: 20 }}>
                Коммерческие условия согласуются отдельно
              </Typography>
            </Stack>

            <Divider />

            <Stack
              component="ul"
              spacing={1}
              sx={{ m: 0, pl: 2.25, color: 'text.secondary', flex: 1 }}
            >
              {CUSTOM_TIER.features.map((feature) => (
                <Typography key={feature} component="li" variant="body2">
                  {feature}
                </Typography>
              ))}
            </Stack>

            <Button fullWidth variant="outlined" color="inherit" href="mailto:anynote@yandex.ru">
              Связаться
            </Button>
          </Stack>
        </Paper>
      </Box>

      {checkout ? (
        <CheckoutModal
          planSlug={checkout.planSlug}
          defaultPeriod={checkout.defaultPeriod}
          onClose={() => setCheckout(null)}
        />
      ) : null}
    </Stack>
  )
}
