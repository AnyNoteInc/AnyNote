import { describe, expect, it } from 'vitest'

import { organizationSchema } from '../../src/lib/seo/schemas/organization'
import { productOffersSchema } from '../../src/lib/seo/schemas/product-offers'
import { softwareAppSchema } from '../../src/lib/seo/schemas/software-app'
import { websiteSchema } from '../../src/lib/seo/schemas/website'
import { breadcrumbsSchema } from '../../src/lib/seo/schemas/breadcrumbs'
import { faqSchema } from '../../src/lib/seo/schemas/faq'
import { siteConfig } from '../../src/lib/seo/site-config'

describe('organizationSchema', () => {
  it('returns Schema.org Organization shape', () => {
    const schema = organizationSchema()
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Organization')
    expect(schema.name).toBe(siteConfig.name)
    expect(schema.url).toBe(siteConfig.url)
    expect(schema.logo).toBe(`${siteConfig.url}/logo.png`)
  })
})

describe('websiteSchema', () => {
  it('returns WebSite with SearchAction', () => {
    const schema = websiteSchema()
    expect(schema['@type']).toBe('WebSite')
    expect(schema.url).toBe(siteConfig.url)
    expect(schema.name).toBe(siteConfig.brandRu)
    const action = schema.potentialAction as Record<string, unknown>
    expect(action['@type']).toBe('SearchAction')
    expect(action.target).toContain('{query}')
    expect(action['query-input']).toBe('required name=query')
  })
})

describe('softwareAppSchema', () => {
  it('returns SoftwareApplication with free Offer', () => {
    const schema = softwareAppSchema()
    expect(schema['@type']).toBe('SoftwareApplication')
    expect(schema.applicationCategory).toBe('BusinessApplication')
    expect(schema.operatingSystem).toBe('Web')
    const offers = schema.offers as Record<string, unknown>
    expect(offers['@type']).toBe('Offer')
    expect(offers.priceCurrency).toBe('RUB')
  })
})

describe('productOffersSchema', () => {
  it('returns null for empty plan list', () => {
    expect(productOffersSchema([])).toBeNull()
  })

  it('maps plans to Schema.org Offers', () => {
    const schema = productOffersSchema([
      { name: 'Personal', price: 0 },
      { name: 'Pro', price: 599 },
    ])
    expect(schema).not.toBeNull()
    const offers = (schema as Record<string, unknown>).offers as unknown[]
    expect(offers).toHaveLength(2)
    expect(offers[0]).toMatchObject({
      '@type': 'Offer',
      name: 'Personal',
      price: 0,
      priceCurrency: 'RUB',
      availability: 'https://schema.org/InStock',
    })
  })
})

describe('breadcrumbsSchema', () => {
  it('emits position-indexed ListItems', () => {
    const schema = breadcrumbsSchema([
      { name: 'Главная', url: 'https://x.test/' },
      { name: 'Условия', url: 'https://x.test/terms' },
    ])
    expect(schema['@type']).toBe('BreadcrumbList')
    const items = schema.itemListElement as Array<Record<string, unknown>>
    expect(items[0]).toMatchObject({ '@type': 'ListItem', position: 1, name: 'Главная' })
    expect(items[1]).toMatchObject({ position: 2, name: 'Условия' })
  })
})

describe('faqSchema', () => {
  it('returns null for empty list', () => {
    expect(faqSchema([])).toBeNull()
  })

  it('maps items to FAQPage', () => {
    const schema = faqSchema([{ q: 'Q1', a: 'A1' }])
    expect(schema).not.toBeNull()
    expect((schema as Record<string, unknown>)['@type']).toBe('FAQPage')
    const entities = (schema as Record<string, unknown>).mainEntity as Array<Record<string, unknown>>
    expect(entities[0]).toMatchObject({
      '@type': 'Question',
      name: 'Q1',
      acceptedAnswer: { '@type': 'Answer', text: 'A1' },
    })
  })
})
