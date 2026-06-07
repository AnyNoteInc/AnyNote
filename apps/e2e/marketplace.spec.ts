import { test, expect, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Ensure the 8 curated marketplace tags exist in the DB so the TagRow renders.
 * The seed upserts them, but in case tests run on a partially-seeded DB we
 * make this spec self-contained. Names are Russian (the marketplace UI is RU).
 *
 * Tags still live in the `template_tags` table; the templates-as-pages refactor
 * only moved the templates themselves into `Page` rows (Page.isTemplate), so the
 * tag seeding is unchanged.
 */
test.beforeAll(async () => {
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const tags = [
    { slug: 'job-search', name: 'Поиск работы', icon: 'WorkOutlineIcon', position: 0 },
    { slug: 'website-building', name: 'Создание сайта', icon: 'LaptopIcon', position: 1 },
    { slug: 'freelance', name: 'Фриланс', icon: 'DashboardIcon', position: 2 },
    { slug: 'student-planner', name: 'Студенческий планер', icon: 'MenuBookIcon', position: 3 },
    { slug: 'marketing', name: 'Маркетинг', icon: 'CampaignIcon', position: 4 },
    { slug: 'career-building', name: 'Карьера', icon: 'WorkOutlineIcon', position: 5 },
    { slug: 'personal-website', name: 'Личный сайт', icon: 'LaptopIcon', position: 6 },
    { slug: 'study-planner', name: 'План обучения', icon: 'BookmarkIcon', position: 7 },
  ]
  for (const t of tags) {
    await prisma.templateTag.upsert({
      where: { slug: t.slug },
      create: t,
      update: { name: t.name, icon: t.icon, position: t.position },
    })
  }
})

/**
 * Sign up a fresh user and create a workspace. After creation the user lands on
 * a neutral URL (first page or /chats/new) — URLs no longer contain a
 * /workspaces/{id} prefix.
 */
async function signUpAndCreateWorkspace(page: Page): Promise<void> {
  const email = `marketplace+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Маркет' })

  // After sign-up the user lands on the workspace-creation form.
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  // Creation sets the new workspace active and redirects through /app to a
  // neutral URL (first page or /chats/new). URLs no longer contain /workspaces/{id}.
  await page.waitForURL(/\/(pages|chats)\//)
}

/** Navigate to /marketplace via the sidebar "Маркетплейс" link. */
async function gotoMarketplace(page: Page): Promise<void> {
  // "Маркетплейс" is in the "pages" sidebar section. On a personal plan without
  // chats, "Домашняя" (pages section) is active by default, so the link is already
  // visible. Clicking "Домашняя" is a safe no-op if already active.
  await page.getByRole('button', { name: 'Домашняя' }).click()

  // The NavItem renders as a Box component={Link} → an <a> linking to /marketplace.
  await page.getByRole('link', { name: 'Маркетплейс' }).click()

  // Neutral marketplace route (no /workspaces/{id} prefix).
  await expect(page).toHaveURL(/\/marketplace$/)
}

test('marketplace: sidebar nav, tag filter, sections render', async ({ page }) => {
  await signUpAndCreateWorkspace(page)
  await gotoMarketplace(page)

  // The "Все" chip is always rendered (TagRow always includes it).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()

  // At least one seeded tag should be visible (Маркетинг is at position 4).
  await expect(page.getByText('Маркетинг', { exact: true })).toBeVisible()

  // "Все шаблоны" section heading — rendered only when allTemplates is non-empty
  // (requires global templates seeded via `prisma db seed`). The templates are
  // now Page rows (Page.isTemplate='GLOBAL') but the section UI is identical.
  await expect(page.getByText('Все шаблоны', { exact: true })).toBeVisible()

  // Click the "Маркетинг" tag chip and assert the page doesn't crash.
  await page.getByText('Маркетинг', { exact: true }).click()

  // After filtering, the page should still show the tag list.
  // Use the "Все" chip as a stable no-crash indicator (always present in TagRow).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()
})

test('marketplace: use a template creates an independent page', async ({ page }) => {
  await signUpAndCreateWorkspace(page)
  await gotoMarketplace(page)

  // Templates are PAGES now. The marketplace lists global template pages as
  // cards (button.MuiCardActionArea-root). The test DB is seeded with 10 global
  // templates, so at least one card should exist. If none render (empty market),
  // there is nothing to exercise — skip gracefully.
  const cards = page.locator('button.MuiCardActionArea-root')
  await expect(cards.first()).toBeVisible()
  const cardCount = await cards.count()
  test.skip(cardCount === 0, 'no template cards rendered — marketplace is empty')

  // Capture the clicked card's title so we can find the created page in the
  // sidebar afterwards (a page created from a template inherits its title).
  const firstCard = cards.first()
  const templateTitle = (await firstCard.locator('.MuiTypography-subtitle2').first().innerText()).trim()
  expect(templateTitle.length).toBeGreaterThan(0)

  await firstCard.click()

  // Clicking a card navigates to /marketplace/templates/{pageId} (templateId is a
  // page id). The breadcrumb becomes "Маркетплейс / Шаблоны / {title}".
  await page.waitForURL(/\/marketplace\/templates\/[0-9a-f-]{36}/)
  const templatePageId = page.url().match(/\/marketplace\/templates\/([0-9a-f-]{36})/)?.[1]
  expect(templatePageId).toBeTruthy()

  // Breadcrumb crumbs render as plain text (links/Typography) in the
  // WorkspaceToolbar (class "workspace-toolbar"). Scope to the toolbar because
  // "Маркетплейс" also appears as a sidebar NavItem (strict-mode would otherwise
  // match both).
  const toolbar = page.locator('.workspace-toolbar')
  await expect(toolbar.getByText('Маркетплейс', { exact: true })).toBeVisible()
  await expect(toolbar.getByText('Шаблоны', { exact: true })).toBeVisible()

  // "Использовать" lives in the WorkspaceToolbar rightSlot for the template view.
  await page.getByRole('button', { name: 'Использовать' }).click()

  // Creating from a template makes an INDEPENDENT page and navigates to it.
  await page.waitForURL(/\/pages\/[0-9a-f-]{36}/)
  const newPageId = page.url().match(/\/pages\/([0-9a-f-]{36})/)?.[1]
  expect(newPageId).toBeTruthy()

  // The new page is a fresh copy — its id must differ from the template page id.
  expect(newPageId).not.toBe(templatePageId)

  // The new page appears in the sidebar "Страницы" section. After
  // createPageFromTemplate succeeds, page.listByWorkspace is invalidated so the
  // page tree refreshes. The page inherits the template's title. Each tree node
  // renders as a Link (<a href="/pages/{id}">) wrapping the title text, so the
  // new page is reachable as a link to its own /pages/{newPageId} route.
  await expect(
    page.locator(`a[href="/pages/${newPageId}"]`).filter({ hasText: templateTitle }),
  ).toBeVisible({ timeout: 15_000 })
})
