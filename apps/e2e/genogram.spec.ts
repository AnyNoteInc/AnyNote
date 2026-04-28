import { type Page, expect, test } from '@playwright/test'

const password = 'SuperSecure123!'

// ---------------------------------------------------------------------------
// Helper: sign up a fresh user, create a workspace, create a GENOGRAM page,
// and wait for the page route. Returns after the EmptyState is reachable.
// ---------------------------------------------------------------------------
async function setupGenogramPage(page: Page) {
  const email = `genogram+${Date.now()}@example.com`

  await page.goto('/sign-up')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('textbox', { name: 'Фамилия' }).fill('Тест')
  await page.getByRole('textbox', { name: 'Имя' }).fill('Тест')
  await page.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await page.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()

  await page.waitForURL(/\/workspaces\/new/)
  await page.getByRole('textbox', { name: 'Название' }).fill('Genogram WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+/)

  // Click the "+" button next to "Страницы" and pick "Генограмма"
  const pagesHeaderRow = page
    .getByText('Страницы', { exact: true })
    .locator('xpath=ancestor::*[.//button][1]')
  await pagesHeaderRow.getByRole('button').click()
  await page.getByRole('menuitem', { name: 'Генограмма' }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// Helper: setup page + fill out OwnerDataForm to create the initial genogram
// ---------------------------------------------------------------------------
async function setupGenogramWithOwner(page: Page) {
  await setupGenogramPage(page)

  await expect(page.getByText('Генограмма пуста')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Создать генограмму' }).click()

  await page.getByLabel('Фамилия').fill('Иванов')
  await page.getByLabel('Имя').fill('Иван')
  // Sex defaults to male — no toggle needed
  await page.getByRole('button', { name: 'Создать генограмму' }).click()

  // Wait for nodes: 3 persons + union + childrenHub + creationDate = 6
  await expect(page.locator('.react-flow__node')).toHaveCount(6, { timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Click the "marriage" ReactFlow edge (partner union line).
//
// ReactFlow edges are SVG <g> elements. Playwright cannot click them via
// normal visibility-based locators. We fire a native click event directly
// on the <g> element in the browser context to trigger ReactFlow's onClick.
// ---------------------------------------------------------------------------
async function clickMarriageEdge(page: Page) {
  // Use the LAST marriage edge — the owner's parents edge is inserted first,
  // the owner's own partner edge is inserted last. Using .last() ensures we
  // target the owner's marriage, not the parents' marriage.
  const edgeGroup = page.locator('.react-flow__edge[data-id^="marriage:"]').last()
  await edgeGroup.waitFor({ state: 'attached' })

  // Fire a native click event on the <g> element — this triggers React's
  // synthetic onClick which ReactFlow wires to the onEdgeClick callback.
  await page.evaluate(() => {
    const els = document.querySelectorAll<SVGGElement>('.react-flow__edge[data-id^="marriage:"]')
    const el = els[els.length - 1]  // last marriage edge = owner's own marriage
    if (!el) throw new Error('marriage edge not found')
    const path = el.querySelector('path')
    const target = path ?? el
    // Get a point on the element to pass as coordinates
    let x = 0
    let y = 0
    if (path) {
      const len = path.getTotalLength()
      const pt = path.getPointAtLength(len / 2)
      const ctm = path.getScreenCTM()
      if (ctm) {
        x = pt.x * ctm.a + ctm.e
        y = pt.y * ctm.d + ctm.f
      }
    }
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  })

  // Give React a tick to process the synthetic event
  await page.waitForTimeout(100)
}

// ---------------------------------------------------------------------------
// Test 1: Create genogram from empty state
// ---------------------------------------------------------------------------
test('Create genogram from empty state', async ({ page }) => {
  await setupGenogramPage(page)

  await expect(page.getByText('Генограмма пуста')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Создать генограмму' }).click()

  // Drawer opens — fill owner data
  await page.getByLabel('Фамилия').fill('Иванов')
  await page.getByLabel('Имя').fill('Иван')
  // Sex toggle: "Мужской" is active by default — nothing to click
  await page.getByRole('button', { name: 'Создать генограмму' }).click()

  // 3 person nodes (owner + father + mother) + union node + children-hub node
  // + creation-date label node = 6 total react-flow nodes
  await expect(page.locator('.react-flow__node')).toHaveCount(6, { timeout: 10_000 })
  await expect(page.getByText(/Дата создания:/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 2: Add partner with marriage, then switch to cohabitation
// ---------------------------------------------------------------------------
test('Add partner with marriage, then switch to cohabitation', async ({ page }) => {
  await setupGenogramWithOwner(page)

  // Click owner node (the one containing "Иванов") to open ElementMenu
  await page.locator('.react-flow__node').filter({ hasText: 'Иванов' }).first().click()
  await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()

  // Fill partner form — sex defaults to female in AddPartnerForm
  await page.getByLabel('Имя').fill('Анна')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Partner node appears
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Анна' })).toBeVisible({
    timeout: 10_000,
  })

  // Click the marriage union line (partner edge) via force click on SVG path
  await clickMarriageEdge(page)
  await page.getByRole('menuitem', { name: 'Редактировать связь' }).click()

  // Switch from "Брак" to "Отношения" (cohabitation)
  await page.getByRole('button', { name: 'Отношения' }).click()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Edge still rendered after save
  await page.locator('.react-flow__edge').first().waitFor({ state: 'attached' })
})

// ---------------------------------------------------------------------------
// Test 3: Add 2 children (one person, one miscarriage); mark child deceased + tragically
// ---------------------------------------------------------------------------
test('Add 2 children (one person, one miscarriage), mark child tragically deceased', async ({
  page,
}) => {
  await setupGenogramWithOwner(page)

  // Add partner first so there is a union line
  await page.locator('.react-flow__node').filter({ hasText: 'Иванов' }).first().click()
  await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()
  await page.getByLabel('Имя').fill('Анна')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Анна' })).toBeVisible({
    timeout: 10_000,
  })

  // Click the marriage union line (partner edge) to open EdgeMenu
  await clickMarriageEdge(page)
  await page.getByRole('menuitem', { name: 'Добавить детей' }).click()

  // Set count to 2
  await page.getByLabel('Укажите количество детей').fill('2')

  // First new child row: fill name, switch sex to female
  await page.getByLabel('Имя').first().fill('Лиза')
  await page.waitForTimeout(100)
  await page.getByRole('button', { name: 'Женский' }).first().click()

  // Second new child row: switch type to "Выкидыш"
  await page.getByRole('button', { name: 'Выкидыш' }).last().click()

  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Miscarriage node shows the letter "В" inside (Cyrillic В for Выкидыш)
  await expect(page.getByText('В', { exact: true })).toBeVisible({ timeout: 10_000 })

  // Click "Лиза" node, open edit form, mark deceased + tragically
  await page.locator('.react-flow__node').filter({ hasText: 'Лиза' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать данные' }).click()
  await page.getByRole('button', { name: 'Умер' }).click()
  await page.getByRole('checkbox', { name: 'Трагически' }).check()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Node still present after save
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Лиза' })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Test 4: Drag divorce mark — verify position changes within the same session
//
// NOTE: Cross-reload persistence requires a running Yjs server (ws://localhost:1234).
// The playwright webServer only starts Next.js, so persistence across reload is not
// tested here. Instead we verify that the mark moves visually during the same session.
// ---------------------------------------------------------------------------
test('Drag divorce mark, verify position changes', async ({ page }) => {
  await setupGenogramWithOwner(page)

  // Add partner with divorce
  await page.locator('.react-flow__node').filter({ hasText: 'Иванов' }).first().click()
  await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()
  await page.getByLabel('Имя').fill('Мария')
  // Tick "Брак расторгнут" in the embedded MarriageRelationForm
  await page.getByLabel('Брак расторгнут').check()
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Мария' })).toBeVisible({
    timeout: 10_000,
  })

  // Divorce mark must be visible now
  const mark = page.locator('[data-testid="divorce-mark"]')
  await expect(mark).toBeVisible({ timeout: 10_000 })

  const before = await mark.boundingBox()
  if (!before) throw new Error('divorce-mark bounding box not found')

  // DivorceMarker uses React onMouseDown on a SVG <g>, then listens on window
  // for mousemove/mouseup. We dispatch native events so both fire correctly.
  const cx = Math.round(before.x + before.width / 2)
  const cy = Math.round(before.y + before.height / 2)

  await page.evaluate(
    ({ x, y, dx }) => {
      const el = document.querySelector<SVGGElement>('[data-testid="divorce-mark"]')
      if (!el) throw new Error('divorce-mark not found')
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      // Simulate 10 incremental moves so the drag handler accumulates delta
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + (dx * i) / 10, clientY: y }))
      }
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x + dx, clientY: y }))
    },
    { x: cx, y: cy, dx: 80 },
  )

  // Give the Yjs write a moment to flush
  await page.waitForTimeout(300)

  // Mark must still be visible and have moved right
  await expect(mark).toBeVisible()
  const after = await mark.boundingBox()
  if (!after) throw new Error('divorce-mark bounding box not found after drag')
  expect(after.x).toBeGreaterThan(before.x)
})

// ---------------------------------------------------------------------------
// Test 5: Multi-partner ordinals appear and can be reordered via edit
// ---------------------------------------------------------------------------
test('Multi-partner ordinals appear and can be reordered', async ({ page }) => {
  await setupGenogramWithOwner(page)

  // Helper: open add-partner drawer for Иванов, fill name, save.
  async function addPartner(name: string) {
    await page.locator('.react-flow__node').filter({ hasText: 'Иванов' }).first().click()
    await page.getByRole('menuitem', { name: 'Добавить партнёра' }).click()

    // Wait for the drawer title to appear — confirms the form is mounted
    const drawerTitle = page.getByText('Добавление партнёра', { exact: true })
    await expect(drawerTitle).toBeVisible({ timeout: 5_000 })

    // Fill the Имя field within the visible drawer context.
    // Scope to the drawer Paper that contains the "Добавление партнёра" title.
    const drawer = page.locator('.MuiDrawer-paper').filter({ hasText: 'Добавление партнёра' })

    // Find the firstName input: it's labeled "Имя" and is the 2nd input in the form
    // (after "Фамилия"). Use nth to disambiguate if getByLabel has issues.
    const firstNameInput = drawer.getByLabel('Имя')
    // Use fill() + tab to commit the value via React's onChange event chain.
    // Pressing Tab fires blur, which ensures React has processed the value.
    await firstNameInput.fill(name)
    await firstNameInput.press('Tab')
    await expect(firstNameInput).toHaveValue(name)
    await drawer.getByRole('button', { name: 'Сохранить' }).click()

    // Wait for the drawer title to disappear (form unmounted)
    await expect(drawerTitle).not.toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(300)
  }

  await addPartner('Анна')
  // After Анна: her ordinal (1) is only shown once there are 2+ partners.
  // Add Мария as the second partner.
  await addPartner('Мария')

  // Both partner nodes must now be in the DOM
  await expect(page.locator('.react-flow__node').filter({ hasText: 'Анна' })).toBeAttached({
    timeout: 10_000,
  })
  // Both partner nodes must show their ordinal number (rendered as SVG <text>)
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Анна' }).getByText('1'),
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Мария' }).getByText('2'),
  ).toBeVisible({ timeout: 10_000 })

  // Edit Анна's data: change partner order to 2
  await page.locator('.react-flow__node').filter({ hasText: 'Анна' }).click()
  await page.getByRole('menuitem', { name: 'Редактировать данные' }).click()
  await page.getByLabel('Порядковый номер партнёра').fill('2')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await page.waitForTimeout(300)

  // After reorder: Анна→2, Мария→1
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Анна' }).getByText('2', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Мария' }).getByText('1', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
})
