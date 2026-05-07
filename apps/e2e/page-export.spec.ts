import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
    update: (args: unknown) => Promise<unknown>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
}
let RoleType: { OWNER: string }

test.setTimeout(120_000)

test.beforeAll(async () => {
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  const readVar = (key: string): string | undefined =>
    envFile
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${key}=`))
      ?.slice(`${key}=`.length)
      .replaceAll(/^"|"$/g, '')

  if (!process.env.DATABASE_URL) {
    const databaseUrl = readVar('DATABASE_URL')
    if (!databaseUrl) throw new Error('DATABASE_URL not configured in .env')
    process.env.DATABASE_URL = databaseUrl
  }

  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = 'SuperSecure123!'

test('downloads PDF, HTML, and Markdown for a TEXT page', async ({ page }) => {
  const email = `export+${Date.now()}@example.com`
  const firstName = 'Export'
  const lastName = 'Tester'

  // Auth via better-auth API directly — UI sign-up form has slow hydration
  // on first compile in the worktree dev server, which causes flaky button
  // clicks to no-op. The API path is deterministic.
  const signUpRes = await page.request.post('/api/auth/sign-up/email', {
    data: {
      email,
      password,
      name: `${lastName} ${firstName}`,
      firstName,
      lastName,
    },
  })
  expect(signUpRes.status()).toBe(200)

  // Mark email verified so the session cookie is treated as fully authenticated.
  await prisma.user.update({ where: { email }, data: { emailVerified: true } })

  // Sign in to get a fresh session cookie that survives the emailVerified update.
  await page.context().clearCookies()
  const signInRes = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  })
  expect(signInRes.status()).toBe(200)

  // Bootstrap workspace + page directly via Prisma.
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })
  const workspace = await prisma.workspace.create({
    data: { name: `Export ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const content = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
  }
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Заметка',
      type: 'TEXT',
      content,
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  try {
    // Hit the export endpoints directly via page.request — the route handler
    // owns auth and content; the dialog is just a thin fetch wrapper that
    // doesn't add coverage we don't already have via api/export-route.test.ts.
    for (const fmt of ['pdf', 'html', 'md'] as const) {
      const url = `/api/workspaces/${workspace.id}/pages/${pageRow.id}/export/${fmt}`
      const res = await page.request.get(url)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-disposition']).toContain("filename*=UTF-8''")

      const body = await res.body()

      if (fmt === 'pdf') {
        expect(body.subarray(0, 4).toString()).toBe('%PDF')
        expect(body.byteLength).toBeGreaterThan(1024)
      } else if (fmt === 'html') {
        const html = body.toString('utf-8')
        expect(html.toLowerCase()).toContain('<!doctype html>')
        expect(html).toContain('Заметка')
        expect(html).toContain('Hello world')
        expect(html).not.toContain('<script')
      } else {
        const md = body.toString('utf-8')
        expect(md.startsWith('# Заметка')).toBe(true)
        expect(md).toContain('Hello world')
      }
    }
  } finally {
    await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  }
})
