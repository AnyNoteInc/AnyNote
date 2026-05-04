import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { clearMailhog, extractFirstUrl, findLastMessageTo } from './helpers/mailhog'
import { flushMailQueue } from './helpers/dispatch-emails'

let prisma: typeof import('../../packages/db/src/index').prisma

const TAG = '+e2e-auth-ext@anynote.dev'
const password = 'StrongPass123!'

test.beforeAll(async () => {
  loadEnvFromRoot()
  const db = await import('../../packages/db/src/index')
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

async function cleanupUser(email: string): Promise<void> {
  await prisma.outboxEvent.deleteMany({
    where: { aggregateType: 'email', payload: { path: ['to'], string_contains: email } },
  })
  await prisma.verification.deleteMany({ where: { identifier: { contains: email } } })
  await prisma.session.deleteMany({ where: { user: { email } } })
  await prisma.subscription.deleteMany({ where: { user: { email } } })
  await prisma.userPreference.deleteMany({ where: { user: { email } } })
  await prisma.account.deleteMany({ where: { user: { email } } })
  await prisma.user.deleteMany({ where: { email } })
}

async function signUpAndVerify(page: import('@playwright/test').Page, email: string) {
  await cleanupUser(email)
  await page.goto('/sign-up')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Фамилия' }).fill('Ivanov')
  await page.getByRole('textbox', { name: 'Имя' }).fill('Ivan')
  await page.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await page.getByRole('button', { name: /зарегистрироваться/i }).click()
  await expect(page.getByText(/письмо с подтверждением/i)).toBeVisible()

  await flushMailQueue()
  await expect
    .poll(async () => findLastMessageTo(email, /подтвердите/i), {
      timeout: 10_000,
      message: 'verify-email message',
    })
    .not.toBeNull()

  const verifyMessage = await findLastMessageTo(email, /подтвердите/i)
  const verifyLink = extractFirstUrl(verifyMessage?.text ?? '', 'http')
  expect(verifyLink).toMatch(/\/api\/auth\/verify-email/)
  await page.goto(verifyLink!)
  await expect(page).toHaveURL(/\/(app|workspaces\/new)/, { timeout: 10_000 })
}

test.describe('extended auth', () => {
  test('email verification happy path sends welcome email', async ({ page }) => {
    await clearMailhog()
    const email = `vehp${Date.now()}${TAG}`

    await signUpAndVerify(page, email)

    await flushMailQueue()
    await expect
      .poll(async () => findLastMessageTo(email, /добро пожаловать/i), {
        timeout: 10_000,
        message: 'welcome message',
      })
      .not.toBeNull()

    await cleanupUser(email)
  })

  test('password reset happy path uses one-time link', async ({ page }) => {
    await clearMailhog()
    const email = `prhp${Date.now()}${TAG}`
    const newPassword = 'NewPass456!'

    await signUpAndVerify(page, email)
    await page.context().clearCookies()

    await page.goto('/reset-credentials')
    await page.getByRole('textbox', { name: 'Email' }).fill(email)
    await page.getByRole('button', { name: /подтвердить/i }).click()
    await expect(page.getByText(/инструкцию для восстановления/i)).toBeVisible()

    await flushMailQueue()
    await expect
      .poll(async () => findLastMessageTo(email, /восстановление пароля/i), {
        timeout: 10_000,
        message: 'reset-password message',
      })
      .not.toBeNull()

    const resetMessage = await findLastMessageTo(email, /восстановление пароля/i)
    const resetLink = extractFirstUrl(resetMessage?.text ?? '', 'http')
    expect(resetLink).toMatch(/\/reset-credentials\//)

    await page.goto(resetLink!)
    await page.getByRole('textbox', { name: /^пароль$/i }).fill(newPassword)
    await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(newPassword)
    await page.getByRole('button', { name: /сохранить/i }).click()
    await expect(page).toHaveURL(/\/sign-in$/)

    await page.goto(resetLink!)
    await page.getByRole('textbox', { name: /^пароль$/i }).fill(newPassword)
    await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(newPassword)
    await page.getByRole('button', { name: /сохранить/i }).click()
    await expect(page.getByText(/недействительн|истек/i)).toBeVisible()

    await cleanupUser(email)
  })

  test('sign-in with bad captcha is rejected when captcha is enabled', async ({ page }) => {
    test.skip(!process.env.RECAPTCHA_SECRET_KEY, 'captcha plugin is disabled without secret key')

    await page.goto('/sign-in')
    await page.getByRole('textbox', { name: 'Email' }).fill(`badcaptcha${Date.now()}${TAG}`)
    await page.getByRole('textbox', { name: /^пароль$/i }).fill('whatever1234')
    await page.getByRole('button', { name: /^войти$/i }).click()
    await expect(page.getByRole('alert')).toContainText(/captcha|recaptcha|защит/i)
  })
})

function loadEnvFromRoot(): void {
  if (process.env.DATABASE_URL) return
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replaceAll(/^"|"$/g, '')
    process.env[key] = process.env[key] ?? value
  }
}
