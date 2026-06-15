import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * After sign-up the user lands on the workspace-creation form. The
 * workspace-scoped routes (/notifications, /settings/integrations, /pages)
 * only render the sidebar + WorkspaceToolbar chrome once an active workspace
 * exists, so create one and wait for the redirect to a neutral URL.
 */
async function createWorkspace(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill('Пострелиз')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

/**
 * E2E coverage for the tRPC/UI-backed subset of the 1.24 post-release fixes.
 *
 * Editor/Yjs-dependent items (synced block, datetime node, page cover, title
 * hover) are intentionally NOT covered here: the Playwright webServer is just
 * `next dev` with no Hocuspocus/yjs server, so editor content doesn't persist
 * across reloads and synced blocks can't round-trip. Those were verified
 * manually against a live app + DB. This file covers only what is reliable
 * under the E2E harness.
 */

// Item 3: /notifications now lives under (active) so it inherits the workspace
// chrome — the WorkspaceToolbar (with the "Уведомления" breadcrumb) and the
// sidebar nav — rather than rendering as a bare container.
test('item 3: /notifications renders inside the workspace chrome', async ({ page }) => {
  const email = `pr-notify-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  await page.goto('/notifications')

  // The page's own heading still renders.
  await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible({ timeout: 15_000 })

  // The WorkspaceToolbar breadcrumb shows "Уведомления" (added by the (active)
  // move). Scope to the toolbar (a Stack with the .workspace-toolbar class) so
  // this asserts the chrome's breadcrumb, not the page heading or sidebar nav.
  await expect(page.locator('.workspace-toolbar').getByText('Уведомления')).toBeVisible()

  // The workspace sidebar chrome is present — its "Новая страница" create
  // button only exists inside the (active) sidebar tree, not the bare layout.
  await expect(page.getByRole('button', { name: 'Новая страница' }).first()).toBeVisible()
})

// Item 4: /settings/integrations shows ONLY Telegram. The generic provider list
// (GitHub / Yandex / AmoCRM / MangoOffice) is filtered out server-side, so only
// the dedicated TelegramLinkCard remains.
test('item 4: integrations settings shows only Telegram', async ({ page }) => {
  const email = `pr-integrations-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  await page.goto('/settings/integrations')

  // The Telegram card is present (its title heading + personal-account chip).
  await expect(page.getByRole('heading', { name: 'Интеграции' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Телеграм' })).toBeVisible()
  await expect(page.getByText('Личный аккаунт')).toBeVisible()

  // None of the placeholder providers render.
  await expect(page.getByText('GitHub')).toHaveCount(0)
  await expect(page.getByText('Yandex')).toHaveCount(0)
  await expect(page.getByText(/Яндекс/)).toHaveCount(0)
  await expect(page.getByText('AmoCRM')).toHaveCount(0)
  await expect(page.getByText(/amoCRM/i)).toHaveCount(0)
  await expect(page.getByText(/Mango ?Office/i)).toHaveCount(0)
})

// Item 6: the API-key create dialog uses a MUI Select (role=combobox) for the
// expiry, not radios. Its options include "Бессрочный" and never "Никогда".
test('item 6: API-key create dialog expiry is a Select with "Бессрочный"', async ({ page }) => {
  const email = `pr-apikey-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })

  await page.goto('/settings/api')
  await expect(page.getByTestId('api-key-create-button')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('api-key-create-button').click()

  // The expiry control is a combobox labelled "Срок действия", not a radio group.
  const expiry = page.getByRole('combobox', { name: 'Срок действия' })
  await expect(expiry).toBeVisible()
  await expect(page.getByRole('radio')).toHaveCount(0)

  // Opening it reveals the option list — "Бессрочный" is present, the old
  // "Никогда" label is gone.
  await expiry.click()
  await expect(page.getByRole('option', { name: 'Бессрочный' })).toBeVisible()
  await expect(page.getByRole('option', { name: '30 дней' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Никогда' })).toHaveCount(0)
})

// Item 8: the sidebar "+" create-page button opens the "Создание страницы"
// dialog, whose page-type grid now includes a "Дашборд" tile. (The meeting
// tile is plan-gated — meetingsEnabled is unset on the dev/E2E plan — so it is
// correctly absent and not asserted here.)
test('item 8: create-page menu includes a Дашборд tile', async ({ page }) => {
  const email = `pr-create-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  // The Команда / Личное page-tree sections live in the "Домашняя" sidebar
  // section (a safe no-op click when already active).
  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()

  // There are two "Новая страница" buttons (Команда + Личное); use the first.
  await page.getByRole('button', { name: 'Новая страница' }).first().click()

  // The Notion-style create dialog opens.
  const dialog = page.getByRole('dialog', { name: 'Создание страницы' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  // The grid includes the Дашборд tile (label + accessible name).
  await expect(dialog.getByText('Дашборд')).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Создать страницу: Дашборд' }),
  ).toBeVisible()
})
