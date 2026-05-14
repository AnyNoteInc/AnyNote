import { siteConfig } from '../site-config'

export function softwareAppSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: siteConfig.brandRu,
    operatingSystem: 'Web',
    applicationCategory: 'BusinessApplication',
    description: siteConfig.description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'RUB',
    },
  }
}
