import { test, expect } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Ensure the 8 curated marketplace tags exist in the DB so the TagRow renders.
 * The seed upserts them, but in case tests run on a partially-seeded DB we
 * make this spec self-contained.
 */
test.beforeAll(async () => {
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const tags = [
    { slug: 'job-search', name: 'Job Search', icon: 'WorkOutlineIcon', position: 0 },
    { slug: 'website-building', name: 'Website Building', icon: 'LaptopIcon', position: 1 },
    { slug: 'freelance', name: 'Freelance', icon: 'DashboardIcon', position: 2 },
    { slug: 'student-planner', name: 'Student Planner', icon: 'MenuBookIcon', position: 3 },
    { slug: 'marketing', name: 'Marketing', icon: 'CampaignIcon', position: 4 },
    { slug: 'career-building', name: 'Career Building', icon: 'WorkOutlineIcon', position: 5 },
    { slug: 'personal-website', name: 'Personal Website', icon: 'LaptopIcon', position: 6 },
    { slug: 'study-planner', name: 'Study Planner', icon: 'BookmarkIcon', position: 7 },
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

  // Creation redirects to the workspace root (may land on /pages/{id} welcome page,
  // /chats/new, or /workspaces/{id} — the exact suffix depends on plan/features).
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  // "Маркетплейс" is in the "pages" sidebar section. On a personal plan without
  // chats, "Домашняя" (pages section) is active by default, so the link is already
  // visible. Clicking "Домашняя" is a safe no-op if already active.
  await page.getByRole('button', { name: 'Домашняя' }).click()

  // The NavItem renders as a Box component={Link} which becomes an <a> in the DOM.
  await page.getByRole('link', { name: 'Маркетплейс' }).click()

  // Assert URL matches the marketplace route.
  await expect(page).toHaveURL(/\/workspaces\/[a-f0-9-]+\/marketplace/)

  // The "Все" chip is always rendered (TagRow always includes it).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()

  // At least one seeded tag should be visible (Marketing is at position 4).
  await expect(page.getByText('Marketing', { exact: true })).toBeVisible()

  // "Все шаблоны" section heading — rendered only when allTemplates is non-empty
  // (requires global templates seeded via `prisma db seed`).
  await expect(page.getByText('Все шаблоны', { exact: true })).toBeVisible()

  // Click the "Marketing" tag chip and assert the page doesn't crash.
  await page.getByText('Marketing', { exact: true }).click()

  // After filtering, the page should still show a section heading or the tag list.
  // Use the "Все" chip as a stable no-crash indicator (always present in TagRow).
  await expect(page.getByText('Все', { exact: true })).toBeVisible()
})
