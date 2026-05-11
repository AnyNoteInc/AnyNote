import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signUpAndCreateWorkspace(page: import('@playwright/test').Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Ремайндер', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Reminder Spec WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)
}

async function createTextPage(page: import('@playwright/test').Page) {
  const previousUrl = page.url()
  const pagesSection = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//*[@data-testid="AddIcon"]][1]')
  await pagesSection.locator('button:has([data-testid="AddIcon"])').first().click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(
    (url) =>
      /\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/.test(url.toString()) &&
      url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

test.describe('Page reminders', () => {
  test('creates a reminder via slash command and shows the chip', async ({ page }) => {
    await signUpAndCreateWorkspace(page, 'reminder-create')
    const editor = await createTextPage(page)

    // Type the slash command and pick the reminder item
    await editor.click()
    await editor.press('/')
    await page.keyboard.type('reminder')
    await page.getByText('Напоминание', { exact: true }).click()

    // ReminderPopover opens — the MUI Popover paper contains the "Напоминание" subtitle
    // and a "Дедлайн" DateTimePicker. Wait for the popover paper to be visible.
    const popoverPaper = page.locator('.MuiPopover-paper').filter({ hasText: 'Дедлайн' })
    await expect(popoverPaper).toBeVisible({ timeout: 5_000 })

    // Fill in the deadline — MUI v9 DateTimePicker renders a sectioned field.
    // Each part (day, month, year, hours, minutes) is a role=spinbutton segment.
    // Click the first segment and type through all of them in order.
    const popover = page.locator('.MuiPopover-paper').filter({ hasText: 'Дедлайн' })
    // The date field contains spinbutton segments; grab the first one (day).
    const spinbuttons = popover.getByRole('spinbutton')
    await spinbuttons.first().click()
    // Type day=15, month=06, year=2026, hours=14, minutes=00
    // MUI v9 auto-advances to next segment after entering 2 digits
    await page.keyboard.type('15')
    await page.keyboard.type('06')
    await page.keyboard.type('2026')
    await page.keyboard.type('14')
    await page.keyboard.type('00')

    // Ensure "В момент истечения" (offset 0) is checked by default on the advance tab.
    await popover.getByRole('tab', { name: 'Заранее' }).click()
    const atMomentCheckbox = page.getByLabel('В момент истечения')
    await expect(atMomentCheckbox).toBeChecked()

    // Submit
    await page.getByRole('button', { name: 'Создать' }).click()

    // The chip should be visible: NodeViewWrapper renders as <span data-id="reminder-{uuid}">
    const chip = page.locator('[data-id^="reminder-"]').first()
    await expect(chip).toBeVisible({ timeout: 5_000 })
    // Chip contains the reminder text and a date
    await expect(chip).toContainText(/Напомнить|через/)
  })
})
