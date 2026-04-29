import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

// Minimal valid 1x1 transparent PNG
const MIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

const password = 'SuperSecure123!'

test('avatar upload: upload, persist, serve via /api/files', async ({ page, request }) => {
  const email = `avatar+${Date.now()}@example.com`

  // Sign up and authenticate
  await signUpAndAuthAs(page, { email, password, firstName: 'Аватар', lastName: 'Тестов' })

  // Go to profile
  await page.goto('/profile')

  // Upload avatar via hidden file input
  const input = page.getByTestId('avatar-file-input')
  await input.setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(MIN_PNG_BASE64, 'base64'),
  })

  const avatarImg = page.locator('img[src^="/api/files/"]')

  // Wait for the avatar image to appear with the right src after upload
  await expect
    .poll(async () => (await avatarImg.first().getAttribute('src')) ?? '', {
      timeout: 10_000,
      intervals: [200, 500, 1000],
    })
    .toMatch(/^\/api\/files\//)

  const imgSrc = await avatarImg.first().getAttribute('src')
  expect(imgSrc).toBeTruthy()

  // Reload and verify persistence
  await page.reload()
  await expect(avatarImg.first()).toHaveAttribute('src', imgSrc!)

  // The avatar file is public — fetch directly (no auth cookie required)
  const fileRes = await request.get(imgSrc!)
  expect(fileRes.status()).toBe(200)
  expect(fileRes.headers()['content-type']).toBe('image/png')
})
