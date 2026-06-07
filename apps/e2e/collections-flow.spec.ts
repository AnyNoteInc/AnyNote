import { test, expect, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

/**
 * Phase-1 "Collections" smoke test for a single authenticated user.
 *
 * Verifies the new sidebar organization (Команда / Личное / Поделились
 * sections backed by per-workspace collections) and the archive/restore flow.
 * All assertions target tRPC-backed UI (sidebar tree, the /archive list) — the
 * Playwright webServer is just `next dev` with NO yjs server, so we never
 * assert collaborative editor content or rely on reload-persistence of typed
 * text.
 */

async function createWorkspaceAndOpenPages(page: Page) {
  // After sign-up the user lands on the workspace-creation form.
  await page.getByRole('textbox', { name: 'Название' }).fill('Коллекции')
  await page.getByRole('button', { name: 'Создать пространство' }).click()

  // Creation sets the new workspace active and redirects through /app to a
  // neutral URL (first seeded page or /chats/new). URLs no longer contain
  // /workspaces/{id}.
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })

  // The Команда / Личное / Поделились sections live in the "pages" sidebar
  // section (the "Домашняя" switcher button). Clicking it is a safe no-op when
  // it is already the active section.
  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
}

/**
 * Header "+" button of the "Личное" (private) collection section. Both the
 * Команда and Личное PageTreeSection instances expose an identically-labelled
 * "Новая страница" button. The Личное header div contains the "Личное" overline
 * and the button but never the "Команда" text; `.last()` picks the innermost
 * such div (the header) regardless of whether the section already has rows.
 */
function privateNewPageButton(page: Page) {
  return page
    .locator('aside')
    .locator('div')
    .filter({ has: page.getByText('Личное', { exact: true }) })
    .filter({ hasNotText: 'Команда' })
    .filter({ has: page.getByRole('button', { name: 'Новая страница' }) })
    .last()
    .getByRole('button', { name: 'Новая страница' })
}

/**
 * Root element of the "Личное" PageTreeSection (used to assert a page row is
 * scoped to this collection). The DOM layout is:
 *   <section>            ← contains the "Личное" overline + page rows
 *     <header>Личное …</header>
 *     <rows>[data-page-row]…</rows>
 *   </section>
 * We pick the div that contains the "Личное" text AND at least one page row
 * (which excludes the header-only div), and NOT "Команда" (which excludes the
 * combined pages area that wraps both collection sections). Only valid once the
 * section has at least one row.
 */
function privateSectionRoot(page: Page) {
  return page
    .locator('aside')
    .locator('div')
    .filter({ has: page.getByText('Личное', { exact: true }) })
    .filter({ hasNotText: 'Команда' })
    .filter({ has: page.locator('[data-page-row]') })
    .last()
}

test.describe('collections sidebar + archive flow', () => {
  test('sidebar renders Команда and Личное collection sections', async ({ page }) => {
    test.setTimeout(120_000)
    const email = `collections+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Коллекция' })
    await createWorkspaceAndOpenPages(page)

    const sidebar = page.locator('aside')
    await expect(sidebar.getByText('Команда', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(sidebar.getByText('Личное', { exact: true })).toBeVisible()
    // The "Архив" nav shortcut also lives in the pages section.
    await expect(sidebar.getByRole('link', { name: 'Архив' })).toBeVisible()
  })

  test('create a page in Личное, then archive and restore it', async ({ page }) => {
    test.setTimeout(120_000)
    const email = `collections+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
    await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Коллекция' })
    await createWorkspaceAndOpenPages(page)

    const sidebar = page.locator('aside')
    await expect(sidebar.getByText('Личное', { exact: true })).toBeVisible({ timeout: 20_000 })

    // The app redirected /app to the seeded welcome page, so the URL is already
    // /pages/{welcomeId}. Remember it so we can wait for the URL to CHANGE to the
    // newly-created page rather than matching the pre-existing one.
    const urlBeforeCreate = page.url()

    // Create a TEXT page in the Личное (private) section via its header "+".
    await privateNewPageButton(page).click()

    // The CreatePageDialog shows a grid of page-type cards; "Текст" creates a
    // blank TEXT page. The CardActionArea carries an explicit aria-label.
    const createDialog = page.getByRole('dialog', { name: 'Создание страницы' })
    await expect(createDialog).toBeVisible()
    await createDialog.getByRole('button', { name: 'Создать страницу: Текст' }).click()

    // The create flow navigates to the new page (/pages/{id}). Wait for the URL
    // to change off the welcome page.
    await page.waitForURL(
      (url) => /\/pages\/[a-f0-9-]{36}$/.test(url.pathname) && url.toString() !== urlBeforeCreate,
      { timeout: 30_000 },
    )
    const pageId = /\/pages\/([a-f0-9-]{36})/.exec(page.url())?.[1]
    expect(pageId, 'expected a new pageId in the URL after create').toBeTruthy()

    // The new page appears as a row under Личное in the sidebar tree.
    const row = sidebar.locator(`[data-page-row="${pageId}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(privateSectionRoot(page).locator(`[data-page-row="${pageId}"]`)).toHaveCount(1)

    // Archive via the row's "⋯" context menu → "В архив".
    await row.hover()
    // page-actions has two IconButtons: [0] = "+" (nested create), [1] = "⋯".
    await row.locator('.page-actions button').nth(1).click()
    const contextMenu = page.getByRole('menu')
    await contextMenu.getByRole('menuitem', { name: 'В архив' }).click()

    // The archived page disappears from the sidebar tree.
    await expect(sidebar.locator(`[data-page-row="${pageId}"]`)).toHaveCount(0, { timeout: 15_000 })

    // It shows up on the /archive page.
    await sidebar.getByRole('link', { name: 'Архив' }).click()
    await page.waitForURL(/\/archive$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Архив' })).toBeVisible({ timeout: 20_000 })

    // The archived page is listed. It was created without a title, so the
    // archive list shows its fallback "Без названия", and the only restore
    // control is the "Восстановить" icon button.
    const restoreButton = page.getByRole('button', { name: 'Восстановить' })
    await expect(restoreButton).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Без названия', { exact: true })).toBeVisible()

    // Restore it.
    await restoreButton.click()

    // After restore it is gone from the archive list (the list empties).
    await expect(page.getByText('Архив пуст')).toBeVisible({ timeout: 15_000 })

    // And it is back in the sidebar's Личное section.
    await page.getByRole('button', { name: 'Домашняя', exact: true }).click()
    await expect(sidebar.locator(`[data-page-row="${pageId}"]`)).toBeVisible({ timeout: 15_000 })
  })
})
