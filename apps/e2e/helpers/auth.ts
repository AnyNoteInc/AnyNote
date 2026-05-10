import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

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

export type SignUpAndAuthArgs = {
  email: string
  password: string
  firstName?: string
  lastName?: string
}

/**
 * Backfill 5 consent rows for a user. Used by tests that create users via
 * Prisma directly (bypassing the sign-up form) or as a safety net after
 * sign-up to guarantee the (protected) layout consent gate is satisfied.
 */
export async function seedDefaultNotificationPreferences(_userId: string): Promise<void> {
  // No-op: production code resolves preferences lazily from EVENT_CATALOG when no
  // override row exists. Hook kept so future per-test preference overrides have a
  // single place to plug in.
}

export async function writeConsentsForUserId(userId: string): Promise<void> {
  loadEnvFromRoot()
  const { prisma } = await import('../../../packages/db/src/index')
  const types = [
    'USER_AGREEMENT',
    'PRIVACY_POLICY',
    'PII_PROCESSING',
    'PUBLIC_OFFER',
    'MARKETING',
  ] as const
  await prisma.userConsent.createMany({
    data: types.map((type) => ({
      userId,
      documentType: type,
      granted: type !== 'MARKETING',
      documentVersion: 'e2e',
      source: 'SIGN_UP' as const,
      ipAddress: '127.0.0.1',
      userAgent: 'playwright',
    })),
  })
}

/**
 * Test helper: register via the /sign-up form, mark the user as emailVerified=true
 * directly in the database (bypassing the email verification flow), then sign in
 * and wait for the post-login redirect.
 *
 * Use this in tests that don't care about the email verification flow itself
 * (workspace, billing, editor, chat, etc.). For tests that verify the
 * verification flow, use the full UI flow in `auth-extended.spec.ts`.
 */
export async function signUpAndAuthAs(page: Page, args: SignUpAndAuthArgs): Promise<void> {
  const { email, password, firstName = 'Тест', lastName = 'Юзер' } = args

  await page.goto('/sign-up')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Фамилия' }).fill(lastName)
  await page.getByRole('textbox', { name: 'Имя' }).fill(firstName)
  await page.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await page.getByTestId('register-terms-checkbox').check()
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()

  loadEnvFromRoot()
  const { prisma } = await import('../../../packages/db/src/index')
  let user: { id: string } | null = null
  for (let i = 0; i < 40; i += 1) {
    user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (user) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!user) throw new Error(`signUpAndAuthAs: user row never appeared for ${email}`)
  await prisma.user.update({ where: { email }, data: { emailVerified: true } })

  // Sign-up writes 5 consent rows via the tRPC procedure. Backfill if absent so
  // the user always passes the (protected) layout consent gate.
  const consentCount = await prisma.userConsent.count({ where: { userId: user.id } })
  if (consentCount < 5) {
    await writeConsentsForUserId(user.id)
  }

  // Clear any cookies set by signUp's optional autoSignIn so the next sign-in
  // is deterministic (we don't depend on whether better-auth auto-signed-in).
  await page.context().clearCookies()
  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await page.getByRole('button', { name: /^войти$/i }).click()
  await page.waitForURL(/\/(app|workspaces)/, { timeout: 30_000 })
}
