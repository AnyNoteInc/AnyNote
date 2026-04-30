import { expect, test } from '@playwright/test'

test.describe('Home page (redesign)', () => {
  test('renders the new hero, pricing, and footer', async ({ page, context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
    await page.goto('/')

    // Hero — new heading
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Рабочая память команды')

    // Section anchors
    for (const anchor of ['why', 'modes', 'search', 'features', 'pricing', 'contact']) {
      await expect(page.locator(`#${anchor}`)).toBeVisible()
    }

    // Pricing — "Чаты с ИИ" present, no "AI"
    await expect(page.locator('#pricing')).toContainText('Чаты с ИИ')

    // Footer brand
    await expect(page.locator('footer')).toContainText('Любые заметки')

    // No "AnyNote" anywhere
    await expect(page.locator('body')).not.toContainText('AnyNote')
  })

  test('contact form submits and shows success', async ({ page, context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
    await page.goto('/')
    const contact = page.locator('#contact')
    await contact.scrollIntoViewIfNeeded()

    await contact.getByLabel(/^Имя/).fill('Виктор')
    await contact.getByLabel(/^Email/).fill('victor@example.ru')
    await contact.getByLabel(/^Телефон/).fill('+74951234567')
    await contact.getByLabel(/^Что нужно/).fill('On-prem на 200 пользователей')
    await contact.getByRole('button', { name: 'Отправить запрос' }).click()

    await expect(contact.getByText('Заявка отправлена')).toBeVisible()
  })
})
