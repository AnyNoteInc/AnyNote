import { prisma } from '@repo/db'
import { getActivePlanForUser } from '@repo/trpc'

import { PricingTiers, type PricingTierPlan } from '@/components/billing/pricing-tiers'
import { PublicPageShell } from '@/components/public/public-page-shell'
import { getSession } from '@/lib/get-session'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { productOffersSchema } from '@/lib/seo/schemas/product-offers'

export const metadata = buildMetadata({
  title: 'Тарифы',
  path: '/pricing',
  description:
    'Тарифные планы Любые заметки: бесплатный Персональный, командный ПРО, расширенный МАКС. Цены в рублях, оплата по подписке.',
  keywords: ['тарифы заметок', 'цены AnyNote', 'подписка заметки команда'],
})

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
        pricePerExtraSeatMonthlyKopecks: true,
        pricePerExtraSeatYearlyKopecks: true,
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

  const schemaPlans = plans.map((plan) => ({
    name: plan.name,
    price: Math.round(plan.priceMonthlyKopecks / 100),
  }))

  return (
    <>
      <JsonLd data={productOffersSchema(schemaPlans)} />
      <PublicPageShell
        eyebrow="Тарифы"
        title="Выберите тариф под текущий ритм команды"
        description="Персональный подходит для личной базы знаний, ПРО открывает командные сценарии, МАКС рассчитан на рабочие пространства с расширенными настройками."
      >
        <PricingTiers
          plans={pricingPlans}
          currentPlanSlug={currentPlan?.slug ?? null}
          isAuthenticated={Boolean(session)}
        />
      </PublicPageShell>
    </>
  )
}
