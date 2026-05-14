import { describe, expect, it } from 'vitest'

import sitemap from '../../src/app/sitemap'
import { legalDocuments } from '../../src/lib/legal-documents'
import { siteConfig } from '../../src/lib/seo/site-config'

describe('sitemap', () => {
  const entries = sitemap()

  it('includes the homepage', () => {
    const home = entries.find((e) => e.url === `${siteConfig.url}/`)
    expect(home).toBeDefined()
    expect(home?.priority).toBe(1.0)
  })

  it('includes /pricing and /terms', () => {
    const urls = entries.map((e) => e.url)
    expect(urls).toContain(`${siteConfig.url}/pricing`)
    expect(urls).toContain(`${siteConfig.url}/terms`)
  })

  it('emits a sitemap entry for every legal document with lastModified parsed from version', () => {
    for (const doc of legalDocuments) {
      const entry = entries.find((e) => e.url === `${siteConfig.url}/terms/${doc.slug}`)
      expect(entry).toBeDefined()
      expect((entry?.lastModified as Date).toISOString().startsWith(doc.version)).toBe(true)
    }
  })
})
