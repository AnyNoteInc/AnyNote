import { siteConfig } from '../site-config'

export function websiteSchema(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: siteConfig.url,
    name: siteConfig.brandRu,
    description: siteConfig.description,
    inLanguage: 'ru-RU',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteConfig.url}/app/search?q={query}`,
      'query-input': 'required name=query',
    },
  }
}
