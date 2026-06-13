import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

/**
 * Phase 9B E2E (plan Task 6 / spec §6): the media + embeds + collapsible-heading
 * journeys, all asserted IN-SESSION. The Playwright webServer is just `next dev`
 * with NO yjs server, so editor node state does NOT survive a reload — every
 * assertion here happens while the page stays loaded.
 *
 * Insertion paths under test:
 *  - /video, /audio  → the media FileUploadPopover ("Выбрать файлы") → a tiny
 *    real container fixture (ftyp-isom mp4 / ID3 mp3 that pass sniffMediaMime) →
 *    a `video`/`audio` NodeView with `src^="/api/files/"`.
 *  - /embed → EmbedUrlPopover: a YouTube URL resolves to a sandboxed
 *    youtube-nocookie iframe; a non-allowlisted URL is honestly rejected (Alert,
 *    no iframe). We drive the slash → URL-popover path rather than simulating a
 *    clipboard paste event (deterministic; the popover is the same code the
 *    paste chooser's «Встроить» reaches).
 *  - /bookmark → EmbedUrlPopover: any https URL inserts a bookmark card; the
 *    preview route is real but best-effort, so we assert the card + the rendered
 *    URL/host, not the exact title.
 *  - collapsible heading: an h2 + a paragraph below → the ▸/▾ toggle widget
 *    (`.anynote-collapse-toggle`) folds/unfolds the section via a `display:none`
 *    node decoration (the doc/Yjs is never touched).
 *
 * The shared dev Postgres means UI-created File rows are registered in an array
 * and dropped in afterAll (with --retries each attempt appends fresh rows).
 */

const password = 'SuperSecure123!'
const TINY_MP4 = path.join(__dirname, 'fixtures', 'tiny.mp4')
const TINY_MP3 = path.join(__dirname, 'fixtures', 'tiny.mp3')

test.setTimeout(180_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// File ids captured from inserted media `src` attributes — cleaned in afterAll.
const createdFileIds = new Set<string>()

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    if (createdFileIds.size > 0) {
      // The video/audio upload rows. The S3 object is content-addressed and
      // harmless to leave, matching the other upload specs. Catch-swallowed:
      // cleanup must never fail the suite.
      await prisma.file
        .deleteMany({ where: { id: { in: [...createdFileIds] } } })
        .catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
})

/** Pull the `/api/files/<id>` id out of a src and register it for cleanup. */
async function registerFileSrc(locator: Locator): Promise<void> {
  const src = await locator.getAttribute('src')
  const id = src?.match(/\/api\/files\/([^/?#]+)/)?.[1]
  if (id) createdFileIds.add(id)
}

async function signUpAndCreateWorkspace(page: Page, tag: string): Promise<void> {
  const email = `${tag}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Медиа', lastName: 'Тестов' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Media Embeds Test')
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
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

async function openSlashMenu(editor: Locator): Promise<void> {
  await editor.click()
  await editor.press('/')
}

test('slash /video: uploads an mp4 and renders an inline video player', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'media-video')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Видео', { exact: true }).click()

  // The /video slash opens the media upload popover (not an empty-state node).
  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Выбрать файлы' }).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles(TINY_MP4)

  const video = editor.locator('[data-type="video"] video[src^="/api/files/"]')
  await expect(video).toBeVisible({ timeout: 20_000 })
  await registerFileSrc(video)
})

test('slash /audio: uploads an mp3 and renders an inline audio player', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'media-audio')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Аудио', { exact: true }).click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Выбрать файлы' }).click()
  const chooser = await fileChooserPromise
  await chooser.setFiles(TINY_MP3)

  const audio = editor.locator('[data-type="audio"] audio[src^="/api/files/"]')
  await expect(audio).toBeVisible({ timeout: 20_000 })
  await registerFileSrc(audio)
})

test('slash /embed: a YouTube URL becomes a sandboxed iframe; a foreign URL is rejected', async ({
  page,
}) => {
  await signUpAndCreateWorkspace(page, 'media-embed')
  const editor = await createTextPage(page)

  // ── A non-allowlisted URL is honestly rejected (no iframe). ───────────────
  await openSlashMenu(editor)
  await page.getByText('Встроить', { exact: true }).click()

  const urlField = page.getByPlaceholder('https://...')
  await expect(urlField).toBeVisible({ timeout: 5_000 })
  await urlField.fill('https://evil.example.com/watch?v=nope')
  await page.getByRole('button', { name: 'Встроить' }).click()

  // The popover stays open with an honest rejection note; no embed node inserts.
  await expect(page.getByRole('alert')).toContainText('нельзя встроить')
  await expect(editor.locator('[data-type="embed"]')).toHaveCount(0)

  // ── A YouTube URL resolves to a youtube-nocookie iframe. ──────────────────
  await urlField.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Встроить' }).click()

  const iframe = editor.locator('[data-type="embed"] iframe[src*="youtube"]')
  await expect(iframe).toBeVisible({ timeout: 10_000 })
  // The src is ALWAYS the provider-owned embed host, never the pasted URL.
  await expect(iframe).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//)
  await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/)
})

test('slash /bookmark: an https URL renders a bookmark card with its host', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'media-bookmark')
  const editor = await createTextPage(page)
  await openSlashMenu(editor)

  await page.getByText('Закладка', { exact: true }).click()

  const urlField = page.getByPlaceholder('https://...')
  await expect(urlField).toBeVisible({ timeout: 5_000 })
  await urlField.fill('https://example.com/article')
  await page.getByRole('button', { name: 'Добавить закладку' }).click()

  // The card renders immediately from just the url (title best-effort via the
  // real preview route); assert the card + the rendered host, not the title.
  const card = editor.locator('[data-type="bookmark"]')
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card).toContainText('example.com')
})

test('collapsible heading: the toggle folds and unfolds the following section', async ({ page }) => {
  await signUpAndCreateWorkspace(page, 'media-collapse')
  const editor = await createTextPage(page)

  // Build an h2 + a paragraph beneath it via the markdown input rule.
  await editor.click()
  await page.keyboard.type('## Заголовок')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Скрытый текст')

  const heading = editor.locator('h2', { hasText: 'Заголовок' })
  await expect(heading).toBeVisible()
  const hidden = editor.getByText('Скрытый текст', { exact: true })
  await expect(hidden).toBeVisible()

  // The ▸/▾ toggle widget sits inside the heading (decoration, not in the doc).
  const toggle = editor.locator('.anynote-collapse-toggle').first()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // The toggle lives in the left gutter, where the editor's drag-handle overlay
  // also sits and intercepts pointer events; a Playwright .click() can't land on
  // it. Dispatch a native click — the ProseMirror plugin handles the DOM `click`
  // event directly, so el.click() reaches its handler. (The same widget-overlay
  // workaround used by the other editor specs.)
  await toggle.evaluate((el) => (el as HTMLElement).click())
  await expect(editor.locator('.anynote-collapse-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(editor.getByText('Скрытый текст', { exact: true })).toBeHidden()

  // Unfold: the paragraph shows again. Re-query the toggle (decorations rebuild).
  await editor
    .locator('.anynote-collapse-toggle')
    .first()
    .evaluate((el) => (el as HTMLElement).click())
  await expect(editor.locator('.anynote-collapse-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(editor.getByText('Скрытый текст', { exact: true })).toBeVisible()
})
