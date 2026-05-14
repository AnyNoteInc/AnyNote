import { describe, expect, it } from 'vitest'

import { organizationSchema } from '../../src/lib/seo/schemas/organization'
import { softwareAppSchema } from '../../src/lib/seo/schemas/software-app'
import { websiteSchema } from '../../src/lib/seo/schemas/website'
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
