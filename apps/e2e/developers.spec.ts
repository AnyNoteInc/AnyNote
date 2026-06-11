import { expect, test, type Page } from '@playwright/test'

const docPages = [
  {
    path: '/developers',
    h1: 'Платформа для разработчиков',
    marker: 'три поверхности интеграции',
  },
  { path: '/developers/api', h1: 'REST API', marker: 'ank_' },
  { path: '/developers/webhooks', h1: 'Вебхуки', marker: 'X-AnyNote-Signature' },
  { path: '/developers/telegram', h1: 'Интеграция с Телеграм', marker: 'BotFather' },
  { path: '/developers/changelog', h1: 'Изменения API', marker: '90 дней' },
] as const

async function collectJsonLd(page: Page): Promise<Array<Record<string, unknown>>> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents()
  return raw.flatMap((text) => {
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : [data]
  })
}

test.describe('Developer portal', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
  })

  for (const doc of docPages) {
    test(`renders ${doc.path} for anonymous visitors`, async ({ page }) => {
      await page.goto(doc.path)

      await expect(page.getByRole('heading', { level: 1 })).toContainText(doc.h1)
      await expect(page.locator('main')).toContainText(doc.marker)
    })
  }

  test('is reachable via the header link and the section sidebar', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Разработчикам' }).first().click()
    await expect(page).toHaveURL(/\/developers$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Платформа для разработчиков',
    )

    const sidebar = page.getByRole('navigation', {
      name: 'Разделы документации для разработчиков',
    })
    await sidebar.getByRole('link', { name: 'Вебхуки' }).click()
    await expect(page).toHaveURL(/\/developers\/webhooks$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Вебхуки')
    await expect(sidebar.getByRole('link', { name: 'Вебхуки' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('every internal link on the five pages resolves', async ({ page, request }) => {
    // Cold next-dev compiles each linked route on first hit.
    test.setTimeout(240_000)

    const paths = new Set<string>()
    for (const doc of docPages) {
      await page.goto(doc.path)
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''))
      for (const href of hrefs) {
        const path = href.split('#')[0]
        if (path) paths.add(path)
      }
    }

    expect(paths.size).toBeGreaterThan(0)

    const broken: string[] = []
    for (const path of paths) {
      const res = await request.get(path)
      if (res.status() >= 400) broken.push(`${path} → ${res.status()}`)
    }
    expect(broken, `Broken internal links: ${broken.join(', ')}`).toEqual([])
  })

  test('/developers exposes canonical and og:title', async ({ page }) => {
    await page.goto('/developers')

    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical).toHaveCount(1)
    await expect(canonical).toHaveAttribute('href', /\/developers\/?$/)
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1)
  })

  test('subpage exposes BreadcrumbList JSON-LD', async ({ page }) => {
    await page.goto('/developers/webhooks')

    const parsed = await collectJsonLd(page)
    const breadcrumbs = parsed.find((x) => x['@type'] === 'BreadcrumbList')
    expect(breadcrumbs).toBeDefined()
    expect(Array.isArray(breadcrumbs?.itemListElement)).toBe(true)
  })
})
