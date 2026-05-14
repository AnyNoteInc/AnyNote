import { describe, expect, it } from 'vitest'

import { organizationSchema } from '../../src/lib/seo/schemas/organization'
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
