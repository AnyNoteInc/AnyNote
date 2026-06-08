import { expect, test } from '@playwright/test'

import { loadEnvFromRoot, signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

// A plan slug dedicated to E2E so we never mutate the seeded personal/pro/max
// plans. `publicSitesEnabled` is derived from the plan's `features` JSON array
// containing the literal flag 'publicSites' (see billing.repository planToFeatures).
const E2E_PRO_PLAN_SLUG = 'e2e-public-sites'

/**
 * Sign up, create the first workspace, and open a fresh TEXT page. Returns the
 * page id parsed from the URL. Mirrors the flow in page-sharing.spec.ts so both
 * specs stay aligned with the current sidebar/dialog selectors.
 */
async function createTextPage(
  page: import('@playwright/test').Page,
  workspaceName: string,
): Promise<string> {
  await page.getByRole('textbox', { name: 'Название' }).fill(workspaceName)
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // Creation redirects through /app to a neutral URL (the seeded start page).
  await page.waitForURL(/\/(pages|chats)\//, { timeout: 30_000 })
  const startUrl = page.url()

  // The redesigned sidebar shows a «Новая страница» button per section (Команда
  // / Личное); create a page from the first one, then pick the Text type.
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  // Wait for the navigation away from the seeded start page to the new page.
  await page.waitForURL((url) => /\/pages\/[a-f0-9-]+/.test(url.href) && url.href !== startUrl, {
    timeout: 15_000,
  })
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 15_000 })

  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]
  expect(pageId).toBeTruthy()
  return pageId!
}

test('the share dialog gates "Опубликовать сайт" for a free-plan user', async ({ page }) => {
  test.setTimeout(120_000)
  const email = `publish-gate+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тариф' })
  await createTextPage(page, 'Gate WS')

  // Open the share dialog and switch to the «Публикация» tab.
  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('tab', { name: 'Публикация' }).click()

  // The publish CTA exists but is disabled on a free plan, and the upgrade
  // caption explains why. This is the honest free-user gating assertion —
  // publishing itself is server-FORBIDDEN without a publicSites plan.
  const publishButton = page.getByRole('button', { name: 'Опубликовать сайт' })
  await expect(publishButton).toBeVisible({ timeout: 15_000 })
  await expect(publishButton).toBeDisabled()
  await expect(page.getByText('Публикация сайта доступна на тарифе Pro и выше.')).toBeVisible()
})

test('a Pro user publishes a site; the public URL and a published subpage open; copy button appears', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  const email = `publish-pro+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Про' })
  const rootPageId = await createTextPage(page, 'Publish WS')

  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')

  // Look up this user + the workspace they just created so we can (a) repoint
  // their ACTIVE subscription at a publicSites-enabled plan and (b) place pages
  // in the TEAM collection (the public resolver excludes PERSONAL collections
  // from a published subtree, so both root and child must live in TEAM).
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })
  const rootPage = await prisma.page.findUniqueOrThrow({
    where: { id: rootPageId },
    select: { workspaceId: true },
  })
  const teamCollection = await prisma.collection.findFirstOrThrow({
    where: { workspaceId: rootPage.workspaceId, kind: 'TEAM', ownerId: null },
    select: { id: true },
  })

  // Upgrade: an E2E-only plan whose `features` JSON contains 'publicSites'
  // (the exact flag planToFeatures looks for). Repoint the user's ACTIVE
  // subscription created by the sign-up hook so getWorkspaceFeatures resolves
  // publicSitesEnabled=true for this workspace's owner.
  const proPlan = await prisma.plan.upsert({
    where: { slug: E2E_PRO_PLAN_SLUG },
    create: {
      slug: E2E_PRO_PLAN_SLUG,
      name: 'E2E Public Sites',
      maxMembersPerWorkspace: 5,
      features: ['publicSites'] as never,
    },
    update: { features: ['publicSites'] as never },
    select: { id: true },
  })
  await prisma.subscription.updateMany({
    where: { userId: user.id, status: 'ACTIVE' },
    data: { planId: proPlan.id },
  })

  // The root page lands in the actor's PERSONAL collection by default; move it
  // into TEAM so it (and its child) form a publishable, non-personal subtree.
  await prisma.page.update({
    where: { id: rootPageId },
    data: { collectionId: teamCollection.id },
  })

  // A published subpage, created directly (UI subpage creation + content needs a
  // yjs server the E2E webServer does not run). Parented under the root in TEAM
  // so the resolver's path-to-root walk and publicTree both accept it.
  const childPage = await prisma.page.create({
    data: {
      workspaceId: rootPage.workspaceId,
      parentId: rootPageId,
      collectionId: teamCollection.id,
      type: 'TEXT',
      title: 'Подстраница',
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  // Reload so the (protected) layout re-renders with the upgraded plan features
  // (the publish gate reads PlanFeaturesProvider from the server render). The
  // editor keeps long-lived connections open, so `networkidle` never settles —
  // wait for the editor surface to re-appear instead.
  await page.reload()
  await expect(page.locator('.anynote-editor .ProseMirror')).toBeVisible({ timeout: 30_000 })

  // Open the dialog → Публикация → publish the site.
  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('button', { name: 'Копировать ссылку' })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole('tab', { name: 'Публикация' }).click()

  const publishButton = page.getByRole('button', { name: 'Опубликовать сайт' })
  await expect(publishButton).toBeEnabled({ timeout: 15_000 })
  await publishButton.click()

  // Server confirms publish by flipping the button to «Снять с публикации».
  await expect(page.getByRole('button', { name: 'Снять с публикации' })).toBeVisible({
    timeout: 15_000,
  })

  // Enable copy-to-workspace so the public page renders the «Сохранить себе»
  // CTA. The switch is controlled by the server view-model (no optimistic
  // flip), so a plain click + DB poll is more robust than `.check()` — which
  // asserts the `checked` attribute changes synchronously before the refetch.
  await page.getByLabel('Разрешить копирование в пространство').click()

  // Resolve the published shareId and wait for allowCopy to land server-side.
  let shareId: string | undefined
  for (let i = 0; i < 50; i += 1) {
    const row = await prisma.pageShare.findUnique({
      where: { pageId: rootPageId },
      select: { shareId: true, mode: true, publishedAt: true, allowCopy: true },
    })
    if (row?.mode === 'SITE' && row.publishedAt && row.allowCopy) {
      shareId = row.shareId
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(shareId).toMatch(/^[0-9a-f]{64}$/)

  // (1) An anonymous visitor opens the published site root. The «Сохранить себе»
  // copy button is present because allowCopy is on.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(`http://localhost:3100/s/${shareId}`)
  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 20_000 })
  await expect(anonPage.getByRole('link', { name: 'Сохранить себе' })).toBeVisible()

  // (2) The nested published-subpage route resolves for the same anonymous
  // visitor: the resolver validates childPageId is genuinely inside the
  // published subtree of shareId.
  await anonPage.goto(`http://localhost:3100/s/${shareId}/${childPage.id}`)
  await expect(anonPage.getByText('Общий доступ')).toBeVisible({ timeout: 20_000 })
  // The subpage chrome header shows the child's own title (it also appears in
  // the SITE nav tree as a link — hence we target the heading specifically),
  // proving the nested resolve returned the child, not the root, page.
  await expect(anonPage.getByRole('heading', { name: 'Подстраница' })).toBeVisible()
  // The body container renders (the route was granted, not an unavailable state).
  await expect(anonPage.locator('.share-page-content')).toHaveCount(1)

  await anon.close()
})
