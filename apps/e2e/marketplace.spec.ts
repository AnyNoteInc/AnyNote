import { test, expect } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Ensure the 8 curated marketplace tags exist in the DB so the TagRow renders.
 * The seed upserts them, but in case tests run on a partially-seeded DB we
 * make this spec self-contained. Names are Russian (the marketplace UI is RU).
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

test('marketplace: sidebar nav, tag filter, sections render', async ({ page }) => {
  const email = `marketplace+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Маркет' })

  // After sign-up the user lands on the workspace-creation form.
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  // Creation sets the new workspace active and redirects through /app to a
  // neutral URL (first page or /chats/new). URLs no longer contain /workspaces/{id}.
  await page.waitForURL(/\/(pages|chats)\//)

  // "Маркетплейс" is in the "pages" sidebar section. On a personal plan without
  // chats, "Домашняя" (pages section) is active by default, so the link is already
  // visible. Clicking "Домашняя" is a safe no-op if already active.
  await page.getByRole('button', { name: 'Домашняя' }).click()

  // The NavItem renders as a Box component={Link} → an <a> linking to /marketplace.
  await page.getByRole('link', { name: 'Маркетплейс' }).click()

  // Neutral marketplace route (no /workspaces/{id} prefix).
  await expect(page).toHaveURL(/\/marketplace$/)

  // The "Все" chip is always rendered (TagRow always includes it).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()

  // At least one seeded tag should be visible (Маркетинг is at position 4).
  await expect(page.getByText('Маркетинг', { exact: true })).toBeVisible()

  // "Все шаблоны" section heading — rendered only when allTemplates is non-empty
  // (requires global templates seeded via `prisma db seed`).
  await expect(page.getByText('Все шаблоны', { exact: true })).toBeVisible()

  // Click the "Маркетинг" tag chip and assert the page doesn't crash.
  await page.getByText('Маркетинг', { exact: true }).click()

  // After filtering, the page should still show the tag list.
  // Use the "Все" chip as a stable no-crash indicator (always present in TagRow).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()
})
