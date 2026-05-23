import { type Page, expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const password = 'SuperSecure123!'

async function setupTextPage(page: Page) {
  const email = `codeblock+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('CodeBlock WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  // Wait for the /chats redirect to settle before switching sections (the
  // pathname→section sync would otherwise revert the section mid-click).
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 30_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createBtn = page.getByRole('button', { name: 'Новая страница' })
  await expect(createBtn).toBeVisible()
  await createBtn.click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  return editor
}

test('code block highlights syntax and exposes a copy button', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('код')
  await page.getByRole('button', { name: 'Код', exact: true }).click()
  await page.keyboard.type('def hello():\n    return 1')

  // lowlight auto-detects the language and emits highlight.js token spans;
  // the content.css theme colors them.
  await expect(page.locator('.anynote-editor .hljs-keyword').first()).toBeVisible({
    timeout: 10_000,
  })
  // the custom node view renders a copy button to the right of the block
  await expect(page.getByTestId('code-block-copy').first()).toBeVisible()
})

test('mermaid code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('mermaid')
  await page.getByRole('button', { name: 'Mermaid' }).click()
  await page.keyboard.type('graph TD; A-->B;')

  // toolbar toggle switches the block from source to a rendered diagram
  await page.getByRole('button', { name: 'Просмотр' }).click()
  await expect(page.locator('.anynote-code-block__preview svg').first()).toBeVisible({
    timeout: 15_000,
  })
})

test('code block language picker sets the highlight language', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('код')
  await page.getByRole('button', { name: 'Код', exact: true }).click()
  await page.keyboard.type('print(1)')

  // pick a language from the in-block dropdown → sets node.attrs.language
  await page.locator('.anynote-code-block').getByRole('combobox').click()
  await page.getByRole('option', { name: 'Python', exact: true }).click()
  await expect(page.locator('.anynote-code-block[data-language="python"]')).toBeVisible()
})

test('plantuml code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('plantuml')
  await page.getByRole('button', { name: 'PlantUML' }).click()
  await page.keyboard.type('@startuml\nAlice->Bob: hi\n@enduml')

  await page.getByRole('button', { name: 'Просмотр' }).click()
  await expect(page.locator('.anynote-code-block__preview svg').first()).toBeVisible({
    timeout: 20_000,
  })
})

test('likec4 code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('likec4')
  await page.getByRole('button', { name: 'LikeC4' }).click()
  // Type (not insertText): in a ProseMirror code block, type() sends Enter for
  // each \n so the newlines LikeC4's grammar needs are preserved; insertText
  // collapses them into one line and the source fails to parse.
  await page.keyboard.type(
    "specification {\n element system\n}\nmodel {\n a = system 'A'\n}\nviews {\n view index {\n include *\n}\n}",
  )

  await page.getByRole('button', { name: 'Просмотр' }).click()
  // likec4 renders a React/xyflow tree (in an open shadow root, which Playwright
  // pierces), not an SVG — assert a flow node, not an <svg>. Generous timeout:
  // in the dev-mode test server the @likec4/language-services chunk (Langium +
  // graphviz-wasm) compiles on first import, which can take a while.
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 60_000 })
})
