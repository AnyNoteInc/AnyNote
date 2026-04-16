import { expect, test } from "@playwright/test"

const password = "SuperSecure123!"

test("text page mounts the AnyNoteEditor", async ({ page }) => {
  const email = `editor+${Date.now()}@example.com`

  // Sign up
  await page.goto("/sign-up")
  await page.getByRole("textbox", { name: "Email" }).fill(email)
  await page.getByRole("textbox", { name: "Фамилия" }).fill("Редактор")
  await page.getByRole("textbox", { name: "Имя" }).fill("Тест")
  await page.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await page.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await page.getByRole("button", { name: "Зарегистрироваться" }).click()

  // First-workspace create
  await page.waitForURL(/\/workspaces\/new/)
  await page.getByRole("textbox", { name: "Название" }).fill("Editor Smoke")
  await page.getByRole("button", { name: "Создать пространство" }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  // Open the "+" menu on the "Страницы" header and pick "Текстовая страница".
  // The "+" button is a sibling of the "Страницы" overline inside the section header row.
  const pagesHeaderRow = page
    .getByText("Страницы", { exact: true })
    .locator("xpath=ancestor::*[.//button][1]")
  await pagesHeaderRow.getByRole("button").click()
  await page.getByRole("menuitem", { name: "Текстовая страница" }).click()

  // Page route should navigate, and the editor DOM should appear.
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  const editor = page.locator(".anynote-editor .ProseMirror")
  await expect(editor).toBeVisible({ timeout: 15_000 })
})
