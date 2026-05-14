import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

async function expectOgImageReachable(page: Page, request: APIRequestContext) {
  const image = page.locator('meta[property="og:image"]')
  await expect(image).toHaveCount(1)
  const url = await image.getAttribute('content')
  if (!url) throw new Error('og:image meta tag has no content attribute')
  const res = await request.get(url)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('image/png')
}

async function collectJsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents()
  return raw.flatMap((text) => {
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : [data]
  })
}

test.describe('SEO surface (public pages)', () => {
  test('homepage exposes canonical, OG, and JSON-LD', async ({ page, request }) => {
    await page.goto('/')

    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute('href', /^https?:\/\/[^/]+\/?$/)

    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1)
    await expectOgImageReachable(page, request)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'ru_RU')

    const parsed = await collectJsonLd(page)
    expect(parsed.length).toBeGreaterThanOrEqual(1)
    expect(parsed.some((x) => x['@type'] === 'Organization')).toBe(true)
    expect(parsed.some((x) => x['@type'] === 'WebSite')).toBe(true)
    expect(parsed.some((x) => x['@type'] === 'SoftwareApplication')).toBe(true)
  })

  test('pricing page exposes Product/Offer JSON-LD', async ({ page, request }) => {
    await page.goto('/pricing')
    await expectOgImageReachable(page, request)
    const parsed = await collectJsonLd(page)
    const product = parsed.find((x) => x['@type'] === 'Product')
    expect(product).toBeDefined()
    expect(Array.isArray(product?.offers)).toBe(true)
  })

  test('legal doc page exposes BreadcrumbList JSON-LD', async ({ page, request }) => {
    await page.goto('/terms/user-agreement')
    await expectOgImageReachable(page, request)
    const parsed = await collectJsonLd(page)
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
