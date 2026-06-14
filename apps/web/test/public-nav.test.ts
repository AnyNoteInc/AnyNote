import { describe, expect, it } from 'vitest'

import { publicFooterSections, publicNavItems } from '../src/components/public/content'

describe('public navigation', () => {
  it('keeps pricing in the AppBar nav', () => {
    expect(publicNavItems).toContainEqual({ label: 'Цены', href: '/pricing' })
  })

  // The public /changelog page («Обновления») was removed; guard against it
  // being re-added to the header nav or footer «Продукт» section by accident.
  // (Widen to string[] so the comparison isn't a dead literal-union check.)
  it('does not expose the removed /changelog page in the AppBar nav', () => {
    const hrefs: string[] = publicNavItems.map((item) => item.href)
    expect(hrefs).not.toContain('/changelog')
  })

  it('does not link to the removed /changelog from the footer «Продукт» section', () => {
    const product = publicFooterSections.find((section) => section.title === 'Продукт')
    const hrefs: string[] = product?.links.map((link) => link.href) ?? []
    expect(hrefs).not.toContain('/changelog')
  })
})
