import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  workspaceAiSettings: {
    create: (args: unknown) => Promise<unknown>
  }
  aiProvider: {
    findFirst: (args: unknown) => Promise<{ id: string; slug: string } | null>
  }
  aiModel: {
    findFirst: (args: unknown) => Promise<{ id: string; slug: string } | null>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>
  }
  chat: {
    create: (args: unknown) => Promise<{ id: string }>
  }
}

test.use({
  locale: "en-US",
  timezoneId: "America/New_York",
})
test.setTimeout(120_000)

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), ".env")
    const envFile = readFileSync(envPath, "utf8")
    const databaseUrl = envFile
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("DATABASE_URL="))
      ?.slice("DATABASE_URL=".length)
      .replace(/^"|"$/g, "")

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not configured in .env")
    }

    process.env.DATABASE_URL = databaseUrl
  }

  const db = await import("../../packages/db/src/index")
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) {
    await prisma.$disconnect()
  }
})

const password = "SuperSecure123!"
const MARKER = "Бразильский Медведь"

test("rag grounds answer in indexed page", async ({ page: browser }) => {
  const email = `rag+${Date.now()}@example.com`

  await browser.goto("/sign-up")
  await browser.getByRole("textbox", { name: "Email" }).fill(email)
  await browser.getByRole("textbox", { name: "Фамилия" }).fill("Тестов")
  await browser.getByRole("textbox", { name: "Имя" }).fill("РАГ")
  await browser.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await browser.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await browser.getByRole("button", { name: "Зарегистрироваться" }).click()
  await browser.waitForURL(/\/workspaces\/new/)

  await expect
    .poll(
      async () =>
        prisma.user.findUnique({
          where: { email },
          select: { id: true },
        }),
      {
        timeout: 10_000,
        intervals: [200, 500, 1000],
      },
    )
    .toBeTruthy()

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: {
      name: `RAG ws ${Date.now()}`,
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

  const provider = await prisma.aiProvider.findFirst({
    where: { slug: "gigachat" },
  })
  const model = await prisma.aiModel.findFirst({
    where: { slug: "GigaChat-2" },
  })
  if (!provider || !model) {
    throw new Error("GigaChat provider/model not seeded; run `pnpm --filter @repo/db prisma:seed`")
  }

  await prisma.workspaceAiSettings.create({
    data: {
      workspaceId: workspace.id,
      defaultModelId: model.id,
      temperature: 0.3,
      topP: 0.9,
      systemPrompt: null,
    },
  })

  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: "Корпоративная кухня",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `Корпоративный кофе нашей компании называется "${MARKER}".`,
              },
            ],
          },
        ],
      },
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })
  await prisma.outboxEvent.create({
    data: {
      eventType: "page.upserted",
      aggregateType: "page",
      aggregateId: pageRow.id,
      workspaceId: workspace.id,
      payload: {},
    },
  })

  const enginesBase = process.env.ENGINES_SERVICE_URL ?? "http://localhost:8082"
  await expect
    .poll(
      async () => {
        const response = await fetch(`${enginesBase}/search/pages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspace.id,
            query: "корпоративный кофе",
          }),
        })

        if (!response.ok) {
          return 0
        }

        const body = (await response.json()) as { documents: Array<{ id: string }> }
        return body.documents.filter((document) => document.id === pageRow.id).length
      },
      {
        timeout: 60_000,
        intervals: [2000, 3000, 5000],
      },
    )
    .toBeGreaterThan(0)

  const chat = await prisma.chat.create({
    data: {
      workspaceId: workspace.id,
      createdById: user.id,
    },
    select: { id: true },
  })

  await browser.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
  const composer = browser.getByTestId("chat-composer-textarea")
  await expect(composer).toBeVisible()
  await composer.fill("Как называется наш корпоративный кофе?")
  await browser.getByRole("button", { name: "Send" }).click()

  await expect
    .poll(
      async () =>
        browser
          .locator('[role="article"]')
          .allInnerTexts()
          .then((chunks) => chunks.join("\n")),
      {
        timeout: 60_000,
        intervals: [1000, 2000],
      },
    )
    .toContain(MARKER)

  await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
})
