import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Phase 9C E2E (plan/spec §9) — the tabs container block, asserted IN-SESSION.
 *
 * The Playwright webServer is just `next dev` with NO yjs server, so editor node
 * state does NOT survive a reload and a nested collaborative editor would never
 * sync across two browser contexts. Every assertion here therefore happens while
 * the page stays loaded: the tab strip renders, switching tabs flips the visible
 * panel + `aria-selected`, adding a tab works, and keyboard arrow nav moves the
 * active tab. We deliberately do NOT assert reload survival or cross-context
 * propagation (that is unit-/serialize-covered, not E2E-reachable here).
 *
 * Insertion path: `/` → the «Вкладки» slash item (`data-slash-item-id="tabs"`),
 * which inserts a `tabs` block seeded with two starter tabs «Вкладка 1/2»
 * (`createTabsContent`). The strip is `role=tablist`; each button is `role=tab`
 * with `aria-selected`; panels are `[data-type="tab"]` (`role=tabpanel`), the
 * inactive ones hidden via `display:none` in THIS render.
 */

const password = 'SuperSecure123!'

test.setTimeout(180_000)

async function signUpAndCreateWorkspace(page: Page, tag: string): Promise<void> {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Вкладки', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Tabs Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//)
}

async function createTextPage(page: Page): Promise<Locator> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function insertTabsBlock(page: Page, editor: Locator): Promise<Locator> {
  await editor.click()
  await editor.press('/')
  // Narrow the menu to the «Вкладки» item, then click it by its stable testid.
  await page.keyboard.type('вкладки')
  const item = page.locator('[data-slash-item-id="tabs"]')
  await expect(item).toBeVisible({ timeout: 5_000 })
  await item.click()
  const tabs = editor.locator('[data-type="tabs"]').first()
  await expect(tabs).toBeVisible({ timeout: 10_000 })
  return tabs
}

test('inserting a tabs block renders a tablist with two starter tabs', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'tabs-insert')
  const editor = await createTextPage(page)
  const tabs = await insertTabsBlock(page, editor)

  // The strip is a single ARIA tablist with two `role=tab` buttons.
  const tablist = tabs.getByRole('tablist')
  await expect(tablist).toHaveCount(1)
  const tabButtons = tabs.getByRole('tab')
  await expect(tabButtons).toHaveCount(2)
  await expect(tabButtons.nth(0)).toHaveText('Вкладка 1')
  await expect(tabButtons.nth(1)).toHaveText('Вкладка 2')

  // Tab 1 is active on a fresh insert; tab 2 is not.
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'false')

  // Two panels exist; only the active one is shown (the inactive is display:none).
  const panels = tabs.locator('.anynote-tabs-panels [data-type="tab"]')
  await expect(panels).toHaveCount(2)
  await expect(panels.nth(0)).toBeVisible()
  await expect(panels.nth(1)).toBeHidden()
})

test('clicking the second tab switches the visible panel and aria-selected', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'tabs-switch')
  const editor = await createTextPage(page)
  const tabs = await insertTabsBlock(page, editor)

  const tabButtons = tabs.getByRole('tab')
  const panels = tabs.locator('.anynote-tabs-panels [data-type="tab"]')

  // Clicking the INACTIVE second tab activates it (the active label is editable
  // in place; an inactive tab button activates on click — see TabsView).
  await tabButtons.nth(1).click()

  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(panels.nth(0)).toBeHidden()
  await expect(panels.nth(1)).toBeVisible()
})

test('the add-tab button appends a third tab and activates it', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'tabs-add')
  const editor = await createTextPage(page)
  const tabs = await insertTabsBlock(page, editor)

  await tabs.getByRole('button', { name: 'Добавить вкладку' }).click()

  const tabButtons = tabs.getByRole('tab')
  await expect(tabButtons).toHaveCount(3)
  // The new tab is activated and labeled with the default «Вкладка 3».
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(tabButtons.nth(2)).toHaveText('Вкладка 3')

  const panels = tabs.locator('.anynote-tabs-panels [data-type="tab"]')
  await expect(panels).toHaveCount(3)
  await expect(panels.nth(2)).toBeVisible()
})

test('keyboard ArrowRight moves the active tab to the next one', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'tabs-keyboard')
  const editor = await createTextPage(page)
  const tabs = await insertTabsBlock(page, editor)

  const tabButtons = tabs.getByRole('tab')
  // Focus the active (first) tab button, then ArrowRight → selection moves to
  // the second tab (the WAI-ARIA roving tablist pattern in TabsView.onKeyDown).
  await tabButtons.nth(0).focus()
  await page.keyboard.press('ArrowRight')

  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true')

  const panels = tabs.locator('.anynote-tabs-panels [data-type="tab"]')
  await expect(panels.nth(0)).toBeHidden()
  await expect(panels.nth(1)).toBeVisible()
})
