import { describe, expect, it } from 'vitest'

import { publicFooterSections, publicNavItems } from '../src/components/public/content'

describe('public navigation', () => {
  it('exposes the changelog page in the AppBar nav', () => {
    expect(publicNavItems).toContainEqual({ label: 'Обновления', href: '/changelog' })
  })

  it('keeps pricing in the AppBar nav', () => {
    expect(publicNavItems).toContainEqual({ label: 'Цены', href: '/pricing' })
  })

  it('links to the changelog from the footer «Продукт» section', () => {
    const product = publicFooterSections.find((section) => section.title === 'Продукт')
    expect(product?.links).toContainEqual({ label: 'Обновления', href: '/changelog' })
  })
})
