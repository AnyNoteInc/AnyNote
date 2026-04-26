import type { Metadata } from 'next'

import { prisma } from '@repo/db'
import { getActivePlanForUser } from '@repo/trpc'

import { PricingTiers, type PricingTierPlan } from '@/components/billing/pricing-tiers'
import { PublicPageShell } from '@/components/public/public-page-shell'
import { getSession } from '@/lib/get-session'

export const metadata: Metadata = {
  title: 'Цены',
}

function normalizeFeatures(features: unknown): string[] {
  return Array.isArray(features)
    ? features.filter((feature): feature is string => typeof feature === 'string')
    : []
}

export default async function PricingPage() {
  const [plans, session] = await Promise.all([
    prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        priceMonthlyKopecks: true,
        priceYearlyKopecks: true,
        currency: true,
        features: true,
        sortOrder: true,
      },
    }),
    getSession(),
  ])

  const currentPlan = session
    ? await getActivePlanForUser(prisma, session.user.id).then(
        ({ plan }) => plan,
        () => null,
      )
    : null

  const pricingPlans: PricingTierPlan[] = plans.map((plan) => ({
    ...plan,
    description: plan.description ?? '',
    features: normalizeFeatures(plan.features),
  }))

  return (
    <PublicPageShell
      eyebrow="Тарифы"
      title="Выберите тариф под текущий ритм команды"
      description="Personal подходит для личной базы знаний, Pro открывает командные сценарии, Max рассчитан на рабочие пространства с расширенными настройками."
    >
      <PricingTiers
        plans={pricingPlans}
        currentPlanSlug={currentPlan?.slug ?? null}
        isAuthenticated={Boolean(session)}
      />
    </PublicPageShell>
  )
}
