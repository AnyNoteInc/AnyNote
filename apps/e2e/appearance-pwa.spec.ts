import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'
const WORKSPACE_NAME = 'Оформление WS'
const TINY_PNG = path.join(__dirname, 'fixtures', 'tiny.png')

/**
 * Phase 9A E2E (spec §5): the manifest identity, the page-appearance journey
 * (emoji icon → uploaded image icon → gradient cover → uploaded cover → remove
 * both; the sidebar tree shows the image icon), the public-share cover
 * (PUBLIC via the share dialog [plan-free setAccess], opened anonymously), and
 * the PWA install surfaces under a synthetic `beforeinstallprompt`.
 *
 * The install context (pwa-install-context.tsx) listens on window, calls
 * `event.preventDefault()` and stashes `{prompt, userChoice}` — so the test's
 * init script registers a dispatcher that fires a CANCELABLE Event with those
 * two stubs and reports `event.defaultPrevented`, which doubles as the "React
 * listener is attached and consumed it" signal (hydration-safe via toPass).
 *
 * The shared dev Postgres means created rows are registered in ARRAYS and
 * dropped in afterAll (with --retries each attempt appends fresh rows).
 */

test.setTimeout(420_000)

let prisma: typeof import('../../packages/db/src/index').prisma

// ── fixture registries (cleaned in afterAll, even on failure) ────────────────
const createdPageIds: string[] = []
const createdFileIds: string[] = []

function uniqueRun(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (!prisma) return
  try {
    if (createdPageIds.length > 0) {
      // UI-created throwaway pages — shares cascade with them. Catch-swallowed:
      // cleanup must never fail the suite (rows may not exist after an early death).
      await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } }).catch(() => {})
    }
    if (createdFileIds.length > 0) {
      // The icon/cover upload rows (public-by-id). The S3 object is content-
      // addressed and harmless to leave, matching the other upload specs.
      await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } }).catch(() => {})
    }
  } finally {
    await prisma.$disconnect()
  }
})

async function signUpAndCreateWorkspace(
  page: Page,
  email: string,
  names: { firstName: string; lastName: string },
): Promise<void> {
  await signUpAndAuthAs(page, { email, password, ...names })

  // After sign-up the user lands on the workspace-creation form. On a cold dev
  // server hydration can lag behind the first fill() — re-fill until React
  // registers the value (security.spec.ts pattern).
  const nameInput = page.getByRole('textbox', { name: 'Название' })
  const createButton = page.getByRole('button', { name: 'Создать пространство' })
  await expect(async () => {
    await nameInput.fill(WORKSPACE_NAME)
    await expect(createButton).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await createButton.click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

/**
 * Create a fresh TEXT page via the sidebar's first «Новая страница» button and
 * return its id (security.spec/page-sharing.spec pattern).
 */
async function createTextPage(page: Page): Promise<string> {
  const startUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 30_000,
  })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 45_000 })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

/**
 * Pick the first emoji in the open icon-picker popover and return its
 * character (emoji-picker-react renders native-emoji buttons as `.epr-emoji`).
 * The popover REMEMBERS its last tab across open/close (it never unmounts), so
 * always select «Эмодзи» first — after an upload it re-opens on «Загрузить».
 *
 * The click is dispatched programmatically: once a previous pick populated the
 * «Frequently Used» section, its sticky category label (`<h2
 * class="epr-emoji-category-label">`, position: sticky) overlays the first
 * emoji row, so a real-mouse click hit-tests the label forever ("subtree
 * intercepts pointer events" with no actionTimeout = infinite retry).
 */
async function pickFirstEmoji(page: Page): Promise<string> {
  const emojiTab = page.getByRole('tab', { name: 'Эмодзи' })
  await expect(emojiTab).toBeVisible({ timeout: 15_000 })
  await emojiTab.click()
  const emojiButton = page.locator('button.epr-emoji').first()
  await expect(emojiButton).toBeVisible({ timeout: 30_000 })
  let chosen = ''
  await expect(async () => {
    chosen = (await emojiButton.textContent())?.trim() ?? ''
    expect(chosen).not.toBe('')
  }).toPass({ timeout: 15_000 })
  await emojiButton.evaluate((el) => (el as HTMLElement).click())
  return chosen
}

/**
 * Fire a synthetic `beforeinstallprompt` via the context's init-script hook.
 * Returns once the install context consumed it (defaultPrevented) — retried
 * because the React listener attaches in a useEffect after hydration.
 */
async function fireBeforeInstallPrompt(page: Page): Promise<void> {
  await expect(async () => {
    const consumed = await page.evaluate(() =>
      (
        window as unknown as { __fireBeforeInstallPrompt: () => boolean }
      ).__fireBeforeInstallPrompt(),
    )
    expect(consumed).toBe(true)
  }).toPass({ timeout: 30_000 })
}

test('manifest: /manifest.webmanifest responds with the AnyNote identity', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.status()).toBe(200)
  const manifest = (await res.json()) as { name?: string; display?: string }
  expect(manifest.name).toBe('AnyNote')
  expect(manifest.display).toBe('standalone')
})

test('page appearance journey, public-share cover, pwa install surfaces', async ({ browser }) => {
  const run = uniqueRun()

  // ════ Owner: sign up + workspace + TEXT page ═══════════════════════════════
  // The whole context carries the beforeinstallprompt dispatcher so the PWA
  // flow at the end works after any number of real navigations.
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => {
    ;(window as unknown as { __fireBeforeInstallPrompt: () => boolean }).__fireBeforeInstallPrompt =
      () => {
        const event = new Event('beforeinstallprompt', { cancelable: true })
        Object.assign(event, {
          prompt: async () => {},
          userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
        })
        window.dispatchEvent(event)
        return event.defaultPrevented
      }
  })
  const a = await ctx.newPage()
  const firstName = 'Анна'
  const lastName = 'Оформитель'
  await signUpAndCreateWorkspace(a, `appearance-${run}@example.com`, { firstName, lastName })

  const pageId = await createTextPage(a)
  createdPageIds.push(pageId)
  const headerIcon = a.getByRole('button', { name: 'Изменить иконку' })
  const cover = a.getByTestId('page-cover')

  // ════ Flow 1: emoji icon → uploaded image icon (header + sidebar) ══════════
  await a.getByTestId('page-icon-add').click()
  const emoji = await pickFirstEmoji(a)
  await expect(headerIcon).toContainText(emoji, { timeout: 30_000 })

  // Switch to an uploaded image icon: the header renders an <img> whose src is
  // the public-by-id file URL.
  await headerIcon.click()
  await a.getByRole('tab', { name: 'Загрузить' }).click()
  await a.getByTestId('page-icon-file-input').setInputFiles(TINY_PNG)
  const headerIconImg = headerIcon.locator('img')
  await expect(headerIconImg).toBeVisible({ timeout: 30_000 })
  const iconSrc = await headerIconImg.getAttribute('src')
  expect(iconSrc).toMatch(/^\/api\/files\/[a-f0-9-]+$/)
  createdFileIds.push(iconSrc!.split('/').pop()!)

  // The sidebar tree row shows the SAME image icon (list cache is patched by
  // the update mutation — no reload needed).
  await expect(a.locator(`aside a[href="/pages/${pageId}"] img`)).toBeVisible({ timeout: 30_000 })

  // ════ Flow 2: gradient cover → uploaded cover → remove both ════════════════
  await a.getByTestId('page-cover-add').click()
  await a.getByTestId('cover-preset-sunset').click()
  await expect(cover).toBeVisible({ timeout: 30_000 })
  await expect(cover.locator('img')).toHaveCount(0) // a preset is pure CSS

  await a.getByTestId('page-cover-change').click()
  await a.getByRole('tab', { name: 'Загрузить' }).click()
  await a.getByTestId('page-cover-file-input').setInputFiles(TINY_PNG)
  const coverImg = cover.locator('img')
  await expect(coverImg).toBeVisible({ timeout: 30_000 })
  const coverSrc = await coverImg.getAttribute('src')
  expect(coverSrc).toMatch(/^\/api\/files\/[a-f0-9-]+$/)
  createdFileIds.push(coverSrc!.split('/').pop()!)

  await a.getByTestId('page-cover-remove').click()
  await expect(cover).toHaveCount(0)

  await headerIcon.click()
  await a.getByRole('button', { name: 'Удалить иконку' }).click()
  await expect(headerIcon).toHaveCount(0)
  await expect(a.getByTestId('page-icon-add')).toBeVisible({ timeout: 30_000 })

  // ════ Flow 3: public share renders the cover band + icon anonymously ═══════
  await a.getByTestId('page-icon-add').click()
  const publicEmoji = await pickFirstEmoji(a)
  await expect(headerIcon).toContainText(publicEmoji, { timeout: 30_000 })
  await a.getByTestId('page-cover-add').click()
  // The cover picker REMEMBERS its last tab (Flow 2 left it on «Загрузить»);
  // select the preset tab explicitly or the unbounded click below hangs forever.
  await a.getByRole('tab', { name: 'Градиенты' }).click()
  await a.getByTestId('cover-preset-ocean').click()
  await expect(cover).toBeVisible({ timeout: 30_000 })

  // PUBLIC via the share dialog (security.spec flow 1: the access Select is
  // targeted by its rendered value, not by combobox order).
  await a.getByRole('button', { name: 'Поделиться' }).click()
  await expect(a.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await a
    .getByRole('dialog')
    .getByRole('combobox')
    .filter({ hasText: 'Доступ ограничен' })
    .click({ timeout: 15_000 })
  await a.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click({ timeout: 15_000 })

  // Resolve the shareId from the DB (headless clipboard access is unreliable).
  let shareId: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const row = await prisma.pageShare.findUnique({
      where: { pageId },
      select: { shareId: true, access: true },
    })
    if (row?.access === 'PUBLIC') {
      shareId = row.shareId
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)
  await a.getByRole('button', { name: 'Готово' }).click()

  // Anonymous visitor (fresh context, no auth cookies): the share view renders
  // the cover band and the page icon next to the title.
  const anonCtx = await browser.newContext()
  const anon = await anonCtx.newPage()
  await anon.goto(`/s/${shareId}`)
  await expect(anon.getByText('Общий доступ')).toBeVisible({ timeout: 30_000 })
  await expect(anon.getByTestId('page-cover')).toBeVisible({ timeout: 30_000 })
  await expect(anon.getByText(publicEmoji).first()).toBeVisible({ timeout: 30_000 })
  await anonCtx.close()

  // ════ Flow 4: PWA install surfaces ═════════════════════════════════════════
  // The synthetic beforeinstallprompt flips canInstall — the banner appears
  // (fresh context: the localStorage dismiss key is unset).
  await fireBeforeInstallPrompt(a)
  await expect(a.getByTestId('pwa-install-banner')).toBeVisible({ timeout: 15_000 })

  // …and the user menu gains «Установить приложение».
  await a.getByText(`${firstName} ${lastName}`).first().click()
  await expect(a.getByTestId('pwa-install-menu-item')).toBeVisible({ timeout: 15_000 })
  await a.keyboard.press('Escape')

  // The honest help card on /settings/general: the install hint NEVER promises
  // offline editing. A real navigation drops the stashed prompt, so re-fire it
  // (the init script registered the dispatcher for every page of the context)
  // and the card's install button appears too.
  await a.goto('/settings/general')
  const helpCard = a.getByTestId('pwa-help-card')
  await expect(helpCard).toBeVisible({ timeout: 30_000 })
  await expect(helpCard).toContainText('офлайн-редактирование не поддерживается')
  await fireBeforeInstallPrompt(a)
  await expect(helpCard.getByRole('button', { name: 'Установить приложение' })).toBeVisible({
    timeout: 15_000,
  })

  await ctx.close()
})
