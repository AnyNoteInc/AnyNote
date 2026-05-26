import { describe, expect, it } from 'vitest'

import sitemap from '../src/app/sitemap'

describe('sitemap', () => {
  it('lists the public changelog page', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.some((url) => url.endsWith('/changelog'))).toBe(true)
  })

  it('still lists pricing', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.some((url) => url.endsWith('/pricing'))).toBe(true)
  })
})
