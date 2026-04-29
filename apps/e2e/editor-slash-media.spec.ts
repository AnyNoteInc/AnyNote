import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

// 1x1 transparent PNG
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

// Minimal valid PDF bytes (%PDF-1.1 header + EOF)
const MIN_PDF = '%PDF-1.1\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'

const password = 'SuperSecure123!'

async function signUpAndCreateWorkspace(page: import('@playwright/test').Page, tag: string) {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Слэш', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Slash Media Test')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)
}

async function createTextPage(page: import('@playwright/test').Page) {
  // The "Страницы" header row has an AddIcon IconButton right after the label.
  // Target it precisely via the MUI icon testid so we don't collide with other
  // sidebar buttons that appear once pages exist.
  const previousUrl = page.url()
  const pagesSection = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//*[@data-testid="AddIcon"]][1]')
  await pagesSection.locator('button:has([data-testid="AddIcon"])').first().click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  // Wait for navigation to a DIFFERENT page URL — waitForURL matches instantly
  // when the current URL already fits the pattern, so we compare against the
  // previous URL explicitly.
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

async function openSlashMenu(editor: import('@playwright/test').Locator) {
  await editor.click()
  await editor.press('/')
}

test('slash menu renders grouped items including media commands', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'slash-groups')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  // Group headings
  await expect(page.getByText('Базовые блоки', { exact: true })).toBeVisible()
  await expect(page.getByText('Медиа', { exact: true })).toBeVisible()

  // Base items
  await expect(page.getByText('Текст', { exact: true })).toBeVisible()
  await expect(page.getByText('Ссылка на страницу', { exact: true })).toBeVisible()

  // Media items
  await expect(page.getByText('Картинка', { exact: true })).toBeVisible()
  await expect(page.getByText('Файл', { exact: true })).toBeVisible()
})

test('slash image: inserts empty dashed block, click replaces with uploaded image', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'slash-image-upload')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Картинка', { exact: true }).click()

  // An empty image block appears immediately (no popover).
  const emptyBlock = editor.locator('[data-type="image"][data-empty="true"]')
  await expect(emptyBlock).toBeVisible({ timeout: 5_000 })
  await expect(emptyBlock).toContainText('Нажми, чтобы выбрать файл или перетащи')

  // Clicking the dashed frame opens the OS file chooser.
  const fileChooserPromise = page.waitForEvent('filechooser')
  await emptyBlock.click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'slash-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(MIN_PNG_BASE64, 'base64'),
  })

  // Upload completes and the block becomes a real image.
  const img = editor.locator('[data-type="image"] img[src^="/api/files/"]')
  await expect(img).toBeVisible({ timeout: 15_000 })
  await expect(editor.locator('[data-type="image"][data-empty="true"]')).toHaveCount(0)
})

test('slash file: upload inserts multiple file attachments', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'slash-file')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Файл', { exact: true }).click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Выбрать файлы' }).click()
  const chooser = await fileChooserPromise
  const pdfBuffer = Buffer.from(MIN_PDF, 'binary')
  // Upload multiple files at once; upload kicks off automatically.
  await chooser.setFiles([
    {
      name: 'slash-test.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    },
    {
      name: 'slash-second.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    },
  ])

  const attachments = editor.locator('.anynote-file-attachment')
  await expect(attachments).toHaveCount(2, { timeout: 15_000 })
  await expect(attachments.first()).toContainText('slash-test.pdf')
  await expect(attachments.nth(1)).toContainText('slash-second.pdf')
})

test('slash page link: picks a page and navigates inside the app', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'slash-page-link')

  // Create a target page first — something to link TO.
  await createTextPage(page)
  const targetUrl = page.url()

  // Create a second page where we'll insert the link.
  const editor = await createTextPage(page)
  const sourceUrl = page.url()
  expect(sourceUrl).not.toBe(targetUrl)

  await openSlashMenu(editor)
  await page.getByText('Ссылка на страницу', { exact: true }).click()

  // Wait for the page-link popover to open and have a search input.
  const searchInput = page.getByPlaceholder('Найти страницу...')
  await expect(searchInput).toBeVisible({ timeout: 5_000 })
  await searchInput.waitFor({ state: 'visible' })

  // Popover shows results under the search input. Wait for ListItemButton(s).
  const popoverPaper = page.locator('.MuiPopover-paper', { has: searchInput })
  const firstResult = popoverPaper.locator('[role="button"]').first()
  await expect(firstResult).toBeVisible({ timeout: 10_000 })
  await firstResult.click()

  const link = editor.locator('[data-type="page-link"]').first()
  await expect(link).toBeVisible({ timeout: 5_000 })

  // Clicking the link should navigate to the target page via Next.js router.
  await link.click()
  await expect(page).not.toHaveURL(sourceUrl, { timeout: 5_000 })
  await expect(page).toHaveURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/)
})

test('slash markdown: parses .md file on the client and inserts content', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'slash-markdown')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  // Markdown command lives in Медиа group.
  await page.getByText('Markdown', { exact: true }).click()

  // No server upload should happen: spy on the upload endpoint.
  const uploadUrl = '/api/files/upload'
  let uploadCalls = 0
  page.on('request', (req) => {
    if (req.url().includes(uploadUrl)) uploadCalls++
  })

  const md = '# Markdown Title\n\n- one\n- two\n\nA **bold** paragraph.\n'

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Выбрать .md файл/ }).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles({
    name: 'notes.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(md, 'utf-8'),
  })

  // Heading + list items should appear in the editor.
  await expect(editor.getByRole('heading', { name: 'Markdown Title' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(editor.getByText('one', { exact: true })).toBeVisible()
  await expect(editor.getByText('two', { exact: true })).toBeVisible()
  expect(uploadCalls).toBe(0)
})

test('slash callout: inserts a callout with default emoji + editable content', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'slash-callout')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Выноска', { exact: true }).click()

  const callout = editor.locator('[data-type="callout"]')
  await expect(callout).toBeVisible({ timeout: 5_000 })

  // Content area accepts typed text (editor focus is already inside the callout).
  await page.keyboard.type('Hello callout')
  await expect(callout).toContainText('Hello callout')

  // Default emoji (💡) renders in the left emoji button.
  await expect(callout.getByRole('button', { name: 'Выбрать эмодзи' })).toBeVisible()
})
