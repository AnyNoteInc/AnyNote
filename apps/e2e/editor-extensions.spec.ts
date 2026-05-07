import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signUp(page: import('@playwright/test').Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Экст', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Ext Test')
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

test('slash menu inserts toggle and hidden blocks', async ({ page }) => {
  await signUp(page, 'ext-slash')
  const editor = await createTextPage(page)
  await editor.click()

  await editor.press('/')
  await page.getByText('Переключатель', { exact: true }).click()
  await expect(page.locator('.anynote-toggle')).toBeVisible()

  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await editor.press('/')
  await page.getByText('Скрытый текст', { exact: true }).click()
  await expect(page.locator('.anynote-hidden-text')).toBeVisible()
})

test('breadcrumb actions: star + more menu items render', async ({ page }) => {
  await signUp(page, 'ext-actions')
  await createTextPage(page)

  // Star toggle (initial state: not favorite)
  const addStar = page.getByRole('button', { name: 'Добавить в избранное' })
  await expect(addStar).toBeVisible()
  await addStar.click()
  await expect(page.getByRole('button', { name: 'Убрать из избранного' })).toBeVisible()

  // MoreHoriz menu
  await page.getByRole('button', { name: 'Действия страницы' }).click()
  await expect(page.getByRole('menuitem', { name: 'Копировать ссылку' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Копия' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Переместить' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Полноэкранный' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Экспортировать' })).toBeVisible()
})

test('drag handle click opens block menu with convert + color items', async ({ page }) => {
  await signUp(page, 'ext-dh')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('Привет мир')

  // Hover the paragraph to reveal the drag handle
  await editor.hover()
  const dragIcon = page
    .locator('.tiptap-drag-handle-wrapper button:has([data-testid="DragIndicatorIcon"])')
    .first()
  await expect(dragIcon).toBeVisible()
  await dragIcon.click()

  await expect(page.getByRole('menuitem', { name: 'Превратить в' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Цвет' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Дубликат' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Переместить' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeVisible()
})

test('paragraph background color hugs text width', async ({ page }) => {
  await signUp(page, 'ext-bg')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('Короткая строка')

  await editor.hover()
  const dragIcon = page
    .locator('.tiptap-drag-handle-wrapper button:has([data-testid="DragIndicatorIcon"])')
    .first()
  await expect(dragIcon).toBeVisible()
  await dragIcon.click()

  await page.getByRole('menuitem', { name: 'Цвет' }).click()
  await page.getByRole('menuitem', { name: 'Жёлтый' }).nth(1).click()

  const highlighted = editor.locator('p.anynote-bg-yellow').first()
  await expect(highlighted).toBeVisible()

  const widths = await highlighted.evaluate((node) => {
    const editorColumn = node.closest('.ProseMirror')
    if (!editorColumn) throw new Error('Editor column not found')
    return {
      highlight: node.getBoundingClientRect().width,
      editor: editorColumn.getBoundingClientRect().width,
    }
  })

  expect(widths.highlight).toBeGreaterThan(60)
  expect(widths.highlight).toBeLessThan(widths.editor * 0.7)
})
