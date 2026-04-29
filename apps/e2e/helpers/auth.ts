import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

let _prisma: typeof import('../../../packages/db/src/index').prisma | null = null

async function getPrisma(): Promise<typeof import('../../../packages/db/src/index').prisma> {
  if (_prisma) return _prisma
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), '.env')
    const envFile = readFileSync(envPath, 'utf8')
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^"|"$/g, '')
      process.env[key] = process.env[key] ?? value
    }
  }
  const db = await import('../../../packages/db/src/index')
  _prisma = db.prisma
  return _prisma
}

export type SignUpAndAuthArgs = {
  email: string
  password: string
  firstName?: string
  lastName?: string
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
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()

  const prisma = await getPrisma()
  // Wait for the user row to appear (signUp may still be in flight).
  for (let i = 0; i < 40; i += 1) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (user) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await prisma.user.update({ where: { email }, data: { emailVerified: true } })

  // Clear any cookies set by signUp's optional autoSignIn so the next sign-in
  // is deterministic (we don't depend on whether better-auth auto-signed-in).
  await page.context().clearCookies()
  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await page.getByRole('button', { name: /^войти$/i }).click()
  await page.waitForURL(/\/(app|workspaces)/, { timeout: 30_000 })
}
