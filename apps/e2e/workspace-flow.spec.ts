import { test, expect } from "@playwright/test"

// This spec requires:
//   - docker compose up -d postgres   (fresh DB is ideal)
//   - pnpm --filter @repo/db prisma migrate dev  (migrations applied)
//   - pnpm --filter web dev                       (dev server running)

const email = `victor+${Date.now()}@example.com`
const password = "Password123!"

test("sign up → new workspace → default landing → settings nav → free-plan limit", async ({ page }) => {
  // 1. Sign up
  await page.goto("/sign-up")
  await page.getByLabel(/имя/i).fill("Victor")
  await page.getByLabel(/фамилия/i).fill("Luferov")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/пароль/i).fill(password)
  await page.getByRole("button", { name: /зарегистрироваться|sign ?up|создать/i }).click()

  // 2. Without a default workspace, /app must redirect to /workspaces/new
  await page.goto("/app")
  await expect(page).toHaveURL(/\/workspaces\/new/)

  // 3. Create first workspace
  await page.getByLabel(/название/i).fill("My First Workspace")
  await page.getByRole("button", { name: /создать пространство/i }).click()
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+/)
  await expect(page.getByRole("heading", { level: 3, name: "Welcome to AnyNote" })).toBeVisible()

  // 4. Sidebar nav to settings
  await page.getByRole("link", { name: "Настройки" }).click()
  await expect(page).toHaveURL("/settings/general")
  await expect(page.getByRole("heading", { name: "Общее" })).toBeVisible()

  // 5. Settings nav to account
  await page.getByRole("link", { name: "Аккаунт" }).click()
  await expect(page).toHaveURL("/settings/account")
  await expect(page.getByRole("heading", { name: "Аккаунт" })).toBeVisible()

  // 6. /app should redirect to the one workspace now that default is set
  await page.goto("/app")
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+/)

  // 7. Free-plan limit: creating a second workspace fails
  await page.goto("/workspaces/new")
  await page.getByLabel(/название/i).fill("Second Workspace")
  await page.getByRole("button", { name: /создать пространство/i }).click()
  await expect(page.getByText(/Free.*пространств/i)).toBeVisible()
})
