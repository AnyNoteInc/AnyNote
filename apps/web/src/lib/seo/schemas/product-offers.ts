import { siteConfig } from '../site-config'

export type PlanForSchema = {
  name: string
  price: number
}

export function productOffersSchema(plans: PlanForSchema[]): Record<string, unknown> | null {
  if (plans.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${siteConfig.brandRu} — тарифы`,
    description: 'Тарифные планы для команд и индивидуальных пользователей.',
    offers: plans.map((plan) => ({
      '@type': 'Offer',
      name: plan.name,
      price: plan.price,
      priceCurrency: 'RUB',
      availability: 'https://schema.org/InStock',
    })),
  }
}
