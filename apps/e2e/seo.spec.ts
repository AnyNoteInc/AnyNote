import { expect, test } from '@playwright/test'

test.describe('SEO surface (public pages)', () => {
  test('homepage exposes canonical, OG, and JSON-LD', async ({ page }) => {
    await page.goto('/')

    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/)

    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1)
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'ru_RU')

    const ldScripts = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(ldScripts.length).toBeGreaterThanOrEqual(1)
    const parsed = ldScripts.flatMap((raw) => {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : [data]
    })
    expect(parsed.some((x) => x['@type'] === 'Organization')).toBe(true)
    expect(parsed.some((x) => x['@type'] === 'WebSite')).toBe(true)
    expect(parsed.some((x) => x['@type'] === 'SoftwareApplication')).toBe(true)
  })

  test('pricing page exposes Product/Offer JSON-LD', async ({ page }) => {
    await page.goto('/pricing')
    const ldScripts = await page.locator('script[type="application/ld+json"]').allTextContents()
    const parsed = ldScripts.flatMap((raw) => {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : [data]
    })
    expect(parsed.some((x) => x['@type'] === 'Product')).toBe(true)
    const product = parsed.find((x) => x['@type'] === 'Product')
    expect(Array.isArray(product?.offers)).toBe(true)
  })

  test('legal doc page exposes BreadcrumbList JSON-LD', async ({ page }) => {
    await page.goto('/terms/user-agreement')
    const ldScripts = await page.locator('script[type="application/ld+json"]').allTextContents()
    const parsed = ldScripts.flatMap((raw) => {
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data : [data]
    })
    expect(parsed.some((x) => x['@type'] === 'BreadcrumbList')).toBe(true)
  })

  test('sitemap.xml is reachable and lists key pages', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const xml = await res.text()
    expect(xml).toMatch(/<loc>https?:\/\/[^<]+\/<\/loc>/)
    expect(xml).toContain('/pricing</loc>')
    expect(xml).toContain('/terms/')
  })

  test('robots.txt disallows protected paths and links to sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toContain('Disallow: /app/')
    expect(body).toContain('Disallow: /api/')
    expect(body).toContain('Sitemap:')
  })

  test('auth routes emit meta robots noindex (defence-in-depth)', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/i,
    )
  })
})
