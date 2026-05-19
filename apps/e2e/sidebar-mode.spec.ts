import { test, expect } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function signInToWorkspace(page: import('@playwright/test').Page, slug: string) {
  const email = `${slug}+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Юзер' })
  await ensureActiveSubscription(email)
  await page.getByRole('textbox', { name: 'Название' }).fill('Пространство')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats\/new$/)
  return email
}

async function ensureActiveSubscription(email: string) {
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  for (let index = 0; index < 20; index += 1) {
    const existing = await prisma.subscription.findFirst({
      where: { userId: user.id, status: 'ACTIVE' },
      select: { id: true },
    })
    if (existing) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const personalPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
  await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: personalPlan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
  })
}

function workspaceIdFromUrl(page: import('@playwright/test').Page) {
  const match = page.url().match(/\/workspaces\/([a-f0-9-]{36})/)
  if (!match) throw new Error(`workspace id not found in url: ${page.url()}`)
  return match[1]!
}

async function expectSidebarButtonHighlighted(
  page: import('@playwright/test').Page,
  name: string,
) {
  const backgroundColor = await page.getByRole('button', { name }).evaluate((element) => {
    return window.getComputedStyle(element).backgroundColor
  })
  expect(backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(backgroundColor).not.toBe('transparent')
}

async function seedNotificationsForEmail(email: string, count: number) {
  const { prisma } = await import('../../packages/db/src/index')
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  for (let index = 0; index < count; index += 1) {
    const event = await prisma.notificationEvent.create({
      data: {
        type: 'NEW_LOGIN',
        category: 'SECURITY',
        userId: user.id,
        payload: { ipAddress: `127.0.0.${index + 1}`, userAgent: 'playwright' },
        createdAt: new Date(Date.now() - index * 1000),
      },
    })
    await prisma.notificationInApp.create({
      data: {
        eventId: event.id,
        userId: user.id,
        createdAt: event.createdAt,
      },
    })
  }
}

test('sidebar defaults to full and persists across reload', async ({ page }) => {
  await signInToWorkspace(page, 'full-default')

  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Открыть сайдбар' })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('full sidebar collapses to hidden, burger in toolbar reopens it', async ({ page }) => {
  await signInToWorkspace(page, 'hide-burger')

  await page.getByRole('button', { name: 'Скрыть' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toHaveCount(0)

  const burger = page.getByRole('button', { name: 'Открыть сайдбар' })
  await expect(burger).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть сайдбар' })).toBeVisible()

  await page.getByRole('button', { name: 'Открыть сайдбар' }).click()
  await expect(page.getByRole('button', { name: 'Скрыть' })).toBeVisible()
})

test('trash shortcut in pages header navigates to trash', async ({ page }) => {
  await signInToWorkspace(page, 'trash-shortcut')

  await page.getByRole('button', { name: 'Страницы' }).click()
  await expect(page.getByRole('button', { name: 'Страницы' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('link', { name: 'Корзина' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/trash$/)
})

test('notifications bell opens popover from full sidebar', async ({ page }) => {
  await signInToWorkspace(page, 'notif-bell')

  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Здесь будут ваши уведомления')).toBeVisible()
})

test('notifications bell keeps first popover render within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const email = await signInToWorkspace(page, 'notif-bell-position')
  await seedNotificationsForEmail(email, 20)

  await page.getByRole('button', { name: 'Уведомления' }).click()
  await expect(page.getByText('Новый вход в аккаунт').first()).toBeVisible()

  const paper = page.locator('.MuiPopover-paper')
  const box = await paper.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) - 1)
})

test('user menu no longer contains a notifications item', async ({ page }) => {
  await signInToWorkspace(page, 'no-notif-in-menu')

  await page.getByText('Тест Юзер', { exact: true }).click()

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Профиль' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Настройки' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Уведомления' })).toHaveCount(0)
})

test('workspace sidebar switches between agent-oriented sections', async ({ page }) => {
  await signInToWorkspace(page, 'agent-sections')
  const workspaceId = workspaceIdFromUrl(page)

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/chats/new$`))
  await expect(page.getByRole('button', { name: 'Чаты' })).toHaveAttribute('aria-pressed', 'true')
  await expectSidebarButtonHighlighted(page, 'Чаты')
  await expect(page.getByRole('button', { name: 'Страницы' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible()

  await page.getByRole('button', { name: 'Поиск' }).hover()
  await expect(page.getByRole('tooltip', { name: /Поиск/ })).toBeVisible()
  await page.getByRole('button', { name: 'Поиск' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Страницы' }).click()
  await expectSidebarButtonHighlighted(page, 'Страницы')
  await expect(page.getByRole('button', { name: 'Новая страница' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Корзина' })).toBeVisible()
  await page.getByRole('button', { name: 'Новая страница' }).click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(new RegExp(`/workspaces/${workspaceId}/pages/[a-f0-9-]{36}$`))

  await page.getByRole('button', { name: 'Настройки' }).click()
  await page.waitForURL(new RegExp(`/workspaces/${workspaceId}/settings/general$`))
  await expectSidebarButtonHighlighted(page, 'Настройки')
  await expect(page.getByRole('link', { name: 'Общее' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Участники' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'AI агент' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Файлы' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Опасная зона' })).toBeVisible()
  await expect(page.locator('main').getByRole('link', { name: 'Общее' })).toHaveCount(0)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+D' : 'Alt+D')
  await expect(page.getByRole('button', { name: 'Страницы' })).toHaveAttribute('aria-pressed', 'true')
  await expectSidebarButtonHighlighted(page, 'Страницы')

  await page.getByRole('button', { name: 'Чаты' }).click()
  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/settings/general$`))
  await expect(page.getByRole('button', { name: 'Чаты' })).toHaveAttribute('aria-pressed', 'true')
  await expectSidebarButtonHighlighted(page, 'Чаты')
  await expect(page.getByRole('button', { name: 'Новый чат' })).toBeVisible()
})

test('new chat draft is created only after the first message', async ({ page }) => {
  await signInToWorkspace(page, 'lazy-chat')
  const workspaceId = workspaceIdFromUrl(page)

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')

  await expect(page).toHaveURL(new RegExp(`/workspaces/${workspaceId}/chats/new$`))
  await expect
    .poll(() => prisma.chat.count({ where: { workspaceId } }))
    .toBe(0)

  await page.getByTestId('chat-composer-textarea').fill('Привет, агент')
  await page.getByRole('button', { name: 'Send' }).click()

  await page.waitForURL(new RegExp(`/workspaces/${workspaceId}/chats/[a-f0-9-]{36}$`))
  await expect
    .poll(() => prisma.chat.count({ where: { workspaceId } }))
    .toBe(1)
})
