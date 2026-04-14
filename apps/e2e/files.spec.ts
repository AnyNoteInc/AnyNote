import { expect, test } from "@playwright/test"

// Minimal valid 1x1 transparent PNG
const MIN_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="

const password = "SuperSecure123!"

test("avatar upload: upload, persist, serve via /api/files", async ({ page, request }) => {
  const email = `avatar+${Date.now()}@example.com`

  // Sign up (mirrors workspace-flow.spec.ts pattern)
  await page.goto("/sign-up")
  await page.getByRole("textbox", { name: "Email" }).fill(email)
  await page.getByRole("textbox", { name: "Фамилия" }).fill("Тестов")
  await page.getByRole("textbox", { name: "Имя" }).fill("Аватар")
  await page.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await page.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await page.getByRole("button", { name: "Зарегистрироваться" }).click()
  await page.waitForURL(/\/workspaces\/new/)

  // Go to profile
  await page.goto("/profile")

  // Upload avatar via hidden file input
  const input = page.getByTestId("avatar-file-input")
  await input.setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(MIN_PNG_BASE64, "base64"),
  })

  // Wait for router.refresh() to re-render with new avatar URL
  await expect
    .poll(
      async () => {
        const src = await page.locator("img").first().getAttribute("src")
        return src ?? ""
      },
      { timeout: 10_000, intervals: [200, 500, 1000] },
    )
    .toMatch(/^\/api\/files\//)

  const imgSrc = await page.locator("img").first().getAttribute("src")
  expect(imgSrc).toBeTruthy()

  // Reload and verify persistence
  await page.reload()
  await expect(page.locator("img").first()).toHaveAttribute("src", imgSrc!)

  // The avatar file is public — fetch directly (no auth cookie required)
  const fileRes = await request.get(imgSrc!)
  expect(fileRes.status()).toBe(200)
  expect(fileRes.headers()["content-type"]).toBe("image/png")
})
