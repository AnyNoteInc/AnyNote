import { describe, expect, it } from 'vitest'

import { buildMetadata } from '../../src/lib/seo/build-metadata'
import { siteConfig } from '../../src/lib/seo/site-config'

describe('buildMetadata', () => {
  it('builds canonical URL from path', () => {
    const meta = buildMetadata({ title: 'Главная', path: '/' })
    expect(meta.alternates?.canonical).toBe(`${siteConfig.url}/`)
  })

  it('builds canonical URL for nested path', () => {
    const meta = buildMetadata({ title: 'Тарифы', path: '/pricing' })
    expect(meta.alternates?.canonical).toBe(`${siteConfig.url}/pricing`)
  })

  it('falls back to siteConfig.description when omitted', () => {
    const meta = buildMetadata({ title: 'X', path: '/' })
    expect(meta.description).toBe(siteConfig.description)
  })

  it('uses provided description when given', () => {
    const meta = buildMetadata({ title: 'X', path: '/', description: 'Custom' })
    expect(meta.description).toBe('Custom')
  })

  it('emits noindex robots when noIndex is true', () => {
    const meta = buildMetadata({ title: 'X', path: '/x', noIndex: true })
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('emits index/follow robots by default', () => {
    const meta = buildMetadata({ title: 'X', path: '/x' })
    expect(meta.robots).toMatchObject({ index: true, follow: true })
  })

  it('populates openGraph with title, description, url, locale', () => {
    const meta = buildMetadata({ title: 'Главная', path: '/' })
    expect(meta.openGraph).toMatchObject({
      type: 'website',
      title: 'Главная',
      description: siteConfig.description,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      url: `${siteConfig.url}/`,
    })
  })

  it('attaches custom ogImage when provided', () => {
    const meta = buildMetadata({ title: 'X', path: '/x', ogImage: '/custom.png' })
    expect(meta.openGraph?.images).toEqual(['/custom.png'])
  })

  it('attaches keywords when provided', () => {
    const meta = buildMetadata({ title: 'X', path: '/x', keywords: ['a', 'b'] })
    expect(meta.keywords).toEqual(['a', 'b'])
  })
})
