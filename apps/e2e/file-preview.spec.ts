import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// 1x1 transparent PNG (see editor-slash-media.spec.ts)
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
const MIN_PDF = '%PDF-1.1\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

const password = 'SuperSecure123!'

test.setTimeout(180_000)

// Сплит-режим доступен только на ширине ≥ md (900px) — effectiveMode иначе
// форсит 'full'. Пиним вьюпорт, чтобы не зависеть от глобального конфига.
test.use({ viewport: { width: 1280, height: 800 } })

async function signUpAndCreateWorkspace(page: Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Просмотр', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('File Preview Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//)
}

async function createTextPage(page: Page) {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 15_000 },
  )
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function openSlashMenu(editor: Locator) {
  await editor.click()
  await editor.press('/')
}

async function insertImage(page: Page, editor: Locator) {
  await openSlashMenu(editor)
  await page.getByText('Картинка', { exact: true }).click()
  const emptyBlock = editor.locator('[data-type="image"][data-empty="true"]')
  await expect(emptyBlock).toBeVisible({ timeout: 5_000 })
  const fileChooserPromise = page.waitForEvent('filechooser')
  await emptyBlock.click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'preview-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(MIN_PNG_BASE64, 'base64'),
  })
  const img = editor.locator('[data-type="image"] img[src^="/api/files/"]')
  await expect(img).toBeVisible({ timeout: 15_000 })
  return img
}

test('dblclick по картинке открывает сплит-панель; OpenInFull/CloseFullscreen переключают режимы', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'file-preview-image')
  const editor = await createTextPage(page)
  const img = await insertImage(page, editor)

  // Страница редактируемая → просмотр открывает двойной клик (спека §2).
  // Диспатчим native dblclick (React ловит его делегированным слушателем на
  // корне): реальный .dblclick() на 1×1 PNG попал бы в edge-ресайз-хендлы
  // (width:8 у каждого края перекрывают ~1px картинку). Паттерн «клик под
  // виджет-оверлеем»; хит-тест здесь намеренно не проверяем.
  await img.evaluate((el) => el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  const sidebar = page.getByTestId('file-preview-sidebar')
  await expect(sidebar).toBeVisible()
  // Сплит: документ остаётся видимым слева.
  await expect(editor).toBeVisible()
  await expect(sidebar.locator('img')).toBeVisible()
  await expect(sidebar.getByTestId('file-preview-download')).toBeVisible()

  // Сплит → фуллскрин. Хедер рендерится и в панели, и в диалоге (общий
  // effectiveMode), поэтому кнопки режима адресуем через контейнер — иначе
  // strict-mode ловит два совпадения, пока панель доигрывает Collapse-выход.
  await sidebar.getByTestId('file-preview-expand').click()
  const dialog = page.getByTestId('file-preview-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('file-preview-collapse')).toBeVisible()

  // Фуллскрин → сплит.
  await dialog.getByTestId('file-preview-collapse').click()
  await expect(dialog).not.toBeVisible()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByTestId('file-preview-expand')).toBeVisible()

  // Закрытие.
  await sidebar.getByTestId('file-preview-close').click()
  await expect(page.getByTestId('file-preview-sidebar')).not.toBeVisible()
})

test('клик по карточке PDF-вложения открывает встроенный просмотр PDF', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'file-preview-pdf')
  const editor = await createTextPage(page)

  await openSlashMenu(editor)
  await page.getByText('Файл', { exact: true }).click()
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Выбрать файлы' }).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'preview-test.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(MIN_PDF, 'binary'),
  })

  const attachment = editor.locator('.anynote-file-attachment', { hasText: 'preview-test.pdf' })
  await expect(attachment).toBeVisible({ timeout: 15_000 })

  // Клик по имени файла = клик по карточке (иконка скачивания гасит всплытие).
  await attachment.getByText('preview-test.pdf').click()

  const sidebar = page.getByTestId('file-preview-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(page.getByTestId('file-preview-pdf-frame')).toBeVisible()
  // Сплит-инвариант: PDF открылся в панели, документ слева остался виден.
  await expect(editor).toBeVisible()
})
