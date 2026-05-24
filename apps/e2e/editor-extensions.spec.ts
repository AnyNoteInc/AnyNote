import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

test.setTimeout(120_000)

async function signUp(page: import('@playwright/test').Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Экст', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Ext Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 30_000 })
}

async function createTextPage(page: import('@playwright/test').Page) {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Страницы' }).click()
  await page.getByRole('button', { name: 'Новая страница' }).click()
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

test('slash menu inserts details and hidden blocks', async ({ page }) => {
  await signUp(page, 'ext-slash')
  const editor = await createTextPage(page)
  await editor.click()

  await editor.press('/')
  await page.getByText('Переключатель', { exact: true }).click()
  await expect(page.locator('.anynote-editor .anynote-details[data-type="details"]')).toBeVisible()

  await editor.click()
  await editor.press('End')
  await editor.press('Enter')
  await editor.press('/')
  await page.getByText('Скрытый текст', { exact: true }).click()
  await expect(page.locator('.anynote-hidden-text')).toBeVisible()
})

test('mention menu tags a workspace member with @', async ({ page }) => {
  await signUp(page, 'ext-mention')
  const editor = await createTextPage(page)
  await editor.click()

  await editor.type('@')
  await expect(page.getByRole('listbox', { name: 'Участники пространства' })).toBeVisible()
  await page.getByRole('option', { name: /Экст Тестов/ }).click()

  await expect(editor.locator('.mention', { hasText: '@Экст Тестов' })).toBeVisible()
})

test('bubble menu applies inline formatting and link attributes', async ({ page }) => {
  await signUp(page, 'ext-bubble')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('Format me')
  await page.keyboard.press('ControlOrMeta+A')

  await page.getByRole('button', { name: 'Жирный' }).click()
  await page.getByRole('button', { name: 'Курсив' }).click()
  await page.getByRole('button', { name: 'Подчеркнуть' }).click()
  await page.getByRole('button', { name: 'Зачеркнуть' }).click()
  await page.getByRole('button', { name: 'Подсветить' }).click()
  await expect(page.getByRole('button', { name: 'Ссылка' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Удалить ссылку' })).toHaveCount(0)

  await expect(editor.locator('strong', { hasText: 'Format me' })).toBeVisible()
  await expect(editor.locator('em', { hasText: 'Format me' })).toBeVisible()
  await expect(editor.locator('u', { hasText: 'Format me' })).toBeVisible()
  await expect(editor.locator('s', { hasText: 'Format me' })).toBeVisible()
  await expect(editor.locator('mark', { hasText: 'Format me' })).toBeVisible()

  await page.getByRole('button', { name: 'Инлайн-код' }).click()
  await expect(editor.locator('code', { hasText: 'Format me' })).toBeVisible()
  await page.getByRole('button', { name: 'Инлайн-код' }).click()
})

test('bubble menu keeps font selects in sync with selected text', async ({ page }) => {
  await signUp(page, 'ext-fonts')
  const editor = await createTextPage(page)
  await editor.click()
  await editor.type('Styled plain')
  await page.keyboard.down('Shift')
  for (let i = 0; i < 'Styled plain'.length; i++) {
    await page.keyboard.press('ArrowLeft')
  }
  await page.keyboard.up('Shift')

  const fontSelect = page.locator('[aria-label="Шрифт"] [role="combobox"]')
  await expect(fontSelect).toHaveText(/Авто/)
  await fontSelect.click()
  await expect(page.getByRole('option', { name: 'Авто' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('option', { name: 'Georgia' }).click()
  await expect(fontSelect).toHaveText(/Georgia/)
  await fontSelect.click()
  await expect(page.getByRole('option', { name: 'Georgia' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('option', { name: 'Авто' }).click()

  await expect(fontSelect).toHaveText(/Авто/)
  await fontSelect.click()
  await expect(page.getByRole('option', { name: 'Авто' })).toHaveAttribute('aria-selected', 'true')
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
  await expect(page.getByRole('menuitem', { name: 'Дублировать' })).toBeVisible()
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

test('drag handle delete removes a task item together with its checkbox', async ({ page }) => {
  await signUp(page, 'ext-task-delete')
  const editor = await createTextPage(page)
  await editor.click()
  await page.keyboard.type('/')
  await page.locator('[data-slash-item-id="task"]').click()
  await page.keyboard.type('Удалить меня')

  const taskItem = page.locator('.anynote-task-item', { hasText: 'Удалить меня' }).first()
  await expect(taskItem).toBeVisible()
  await taskItem.hover()

  const dragIcon = page
    .locator('.tiptap-drag-handle-wrapper button:has([data-testid="DragIndicatorIcon"])')
    .first()
  await expect(dragIcon).toBeVisible()
  await dragIcon.click()
  await page.getByRole('menuitem', { name: 'Удалить' }).click()

  await expect(page.locator('.anynote-task-item')).toHaveCount(0)
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(editor).not.toContainText('Удалить меня')
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
