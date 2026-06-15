import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

/**
 * Regression for the sidebar scroll-boundary change: the scroll must run ONLY
 * through the page-list zone (Избранное/Команда/Личное/коллекции/shared). The
 * top (workspace switcher + section tabs Домашняя/Чаты/Поиск) stays fixed, and
 * the bottom links (Маркетплейс/Архив/Корзина) stay pinned above the profile
 * footer — they must NOT scroll away when the page list overflows.
 *
 * Like the rest of the post-release E2E, this runs against `next dev` with no
 * Hocuspocus server; it only exercises tRPC/layout behavior, never editor Yjs.
 */

async function createWorkspace(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Название' }).fill('Скролл')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
}

/**
 * Create one root TEXT page from the PageTreeSection's "Новая страница" header
 * button: click → choose "Текст" in the create dialog → wait for the new
 * /pages/<id> route and the row to appear. The sidebar (and its create button)
 * stays mounted on the page-detail route, so this can be looped.
 */
async function createTextPage(page: Page): Promise<void> {
  const previousUrl = page.url()
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(
    (url) => /\/pages\/[a-f0-9-]+/.test(url.toString()) && url.toString() !== previousUrl,
    { timeout: 30_000 },
  )
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 30_000 })
}

async function createPages(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await createTextPage(page)
  }
}

test('sidebar scroll runs through the page list, tabs + bottom links stay fixed', async ({
  page,
}) => {
  const email = `sidebar-scroll-${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password: 'Test12345!' })
  await createWorkspace(page)

  await page.getByRole('button', { name: 'Домашняя', exact: true }).click()

  // Force the page list to overflow so a scrollbar can exist.
  await createPages(page, 12)

  // The bottom links live inside the sidebar <aside>; the «Маркетплейс» link is
  // the top of the fixed bottom block.
  const marketplace = page.getByRole('link', { name: 'Маркетплейс' })
  await expect(marketplace).toBeVisible()
  const tabHome = page.getByRole('button', { name: 'Домашняя', exact: true })
  await expect(tabHome).toBeVisible()

  // Resolve the page-list scroll container: the nearest ancestor of a page row
  // whose content overflows (scrollHeight > clientHeight). Then assert the
  // <aside> itself is NOT the scroller and the bottom links + tabs don't move
  // when we scroll that container.
  const before = await page.evaluate(() => {
    const row = document.querySelector('[data-page-row]')
    const aside = document.querySelector('aside')
    if (!row || !aside) return null
    // Walk up from a page row to the first scrollable element inside the aside.
    let el: HTMLElement | null = row as HTMLElement
    let scroller: HTMLElement | null = null
    while (el && el !== aside) {
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY !== 'visible') {
        scroller = el
        break
      }
      el = el.parentElement
    }
    const market = Array.from(aside.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Маркетплейс'),
    )
    const homeTab = Array.from(aside.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Домашняя'),
    )
    return {
      hasScroller: !!scroller,
      asideScrolls: aside.scrollHeight > aside.clientHeight + 1,
      asideOverflowY: getComputedStyle(aside).overflowY,
      marketTop: market?.getBoundingClientRect().top ?? null,
      homeTabTop: homeTab?.getBoundingClientRect().top ?? null,
      // Tag the scroller so the next evaluate can find + scroll it.
      tagged: scroller ? ((scroller.dataset.testScroller = '1'), true) : false,
    }
  })

  if (!before) throw new Error('page row + aside must exist')
  // The page list is the scroll container...
  expect(before.hasScroller, 'page-list zone overflows and scrolls').toBe(true)
  // ...and the <aside> itself does NOT scroll (overflow hidden).
  expect(before.asideScrolls, 'the aside itself must not scroll').toBe(false)
  expect(before.marketTop, 'Маркетплейс must be measurable').not.toBeNull()
  expect(before.homeTabTop, 'Домашняя tab must be measurable').not.toBeNull()

  // Scroll the page-list container to the bottom and confirm the bottom links
  // and the section tabs stay at the SAME viewport position (they are fixed,
  // outside the scroll region).
  const after = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-test-scroller]')
    if (!scroller) return null
    scroller.scrollTop = scroller.scrollHeight
    const aside = document.querySelector('aside')
    if (!aside) return null
    const market = Array.from(aside.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Маркетплейс'),
    )
    const homeTab = Array.from(aside.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Домашняя'),
    )
    return {
      scrolled: scroller.scrollTop > 0,
      marketTop: market?.getBoundingClientRect().top ?? null,
      homeTabTop: homeTab?.getBoundingClientRect().top ?? null,
    }
  })

  if (!after) throw new Error('scroller + aside must still exist after scroll')
  expect(after.scrolled, 'the page-list container actually scrolled').toBe(true)
  // Bottom links pinned: «Маркетплейс» top is unchanged after scrolling.
  expect(after.marketTop ?? -1).toBeCloseTo(before.marketTop ?? -2, 0)
  // Section tabs pinned: «Домашняя» tab top is unchanged after scrolling.
  expect(after.homeTabTop ?? -1).toBeCloseTo(before.homeTabTop ?? -2, 0)

  // Both bottom links and tabs remain visible after scrolling to the bottom.
  await expect(marketplace).toBeVisible()
  await expect(page.getByRole('link', { name: 'Архив' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Корзина' })).toBeVisible()
  await expect(tabHome).toBeVisible()
})
