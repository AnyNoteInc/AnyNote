import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { signUpAndAuthAs } from './helpers/auth'

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  chat: {
    create: (args: unknown) => Promise<{ id: string }>
  }
  chatMessage: {
    create: (args: unknown) => Promise<{ id: string }>
  }
}

test.use({
  locale: 'en-US',
  timezoneId: 'America/New_York',
})

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), '.env')
    const envFile = readFileSync(envPath, 'utf8')
    const databaseUrl = envFile
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('DATABASE_URL='))
      ?.slice('DATABASE_URL='.length)
      .replace(/^"|"$/g, '')

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not configured in .env')
    }

    process.env.DATABASE_URL = databaseUrl
  }

  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

const password = 'SuperSecure123!'

test.afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect()
  }
})

test('chat page opens for an existing workspace chat', async ({ page }) => {
  const email = `chat-page+${Date.now()}@example.com`
  const consoleErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })

  await signUpAndAuthAs(page, { email, password, firstName: 'Чат', lastName: 'Тестов' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: {
      name: `Chat workspace ${Date.now()}`,
      createdById: user.id,
    },
    select: { id: true },
  })

  await prisma.workspaceMember.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: RoleType.OWNER,
    },
  })

  const chat = await prisma.chat.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
    },
    select: { id: true },
  })

  await prisma.chatMessage.create({
    data: {
      chatId: chat.id,
      role: 'USER',
      status: 'DONE',
      parts: [{ type: 'text', text: 'Привет из seed-сообщения' }],
    },
    select: { id: true },
  })

  await prisma.chatMessage.create({
    data: {
      chatId: chat.id,
      role: 'ASSISTANT',
      status: 'DONE',
      parts: [
        { type: 'text', text: 'Нашел данные.' },
        {
          type: 'tool',
          id: 'tool-1',
          kind: 'tool',
          state: 'done',
          title: 'search_pages',
          result: 'Найдена страница Roadmap',
        },
      ],
    },
    select: { id: true },
  })

  await page.goto(`/chats/${chat.id}`)

  await expect(page).toHaveURL(new RegExp(`/chats/${chat.id}$`))
  const composer = page.getByTestId('chat-composer-textarea')
  await expect(composer).toBeVisible()
  await expect(page.getByText('Привет из seed-сообщения')).toBeVisible()
  await expect(page.getByText('search_pages')).toBeVisible()
  await expect(page.getByText('This page could not be found')).toHaveCount(0)
  await composer.fill('Проверка ввода без зависания')
  await expect(composer).toHaveValue('Проверка ввода без зависания')
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
  expect(consoleErrors.join('\n')).not.toContain(
    "Hydration failed because the server rendered text didn't match the client",
  )
})
