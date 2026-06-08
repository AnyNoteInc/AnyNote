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
  await page.waitForURL(/\/chats/, { timeout: 30_000 })

  await page.getByRole('button', { name: 'Страницы' }).click()
  const createBtn = page.getByRole('button', { name: 'Новая страница' })
  await expect(createBtn).toBeVisible()
  await createBtn.click()
  await page.getByRole('button', { name: 'Создать страницу: Текст' }).click()
  await page.waitForURL(/\/pages\/[a-f0-9-]+/, { timeout: 15_000 })

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

test('code block language picker shows Auto mode by default', async ({ page }) => {
  test.setTimeout(120_000)
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('код')
  await page.getByRole('button', { name: 'Код', exact: true }).click()

  await expect(page.locator('.anynote-code-block').getByRole('combobox')).toHaveText(/Авто/)
})

test('code block uses uniform background and equal padding', async ({ page }) => {
  test.setTimeout(120_000)
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('код')
  await page.getByRole('button', { name: 'Код', exact: true }).click()
  await page.keyboard.type('import datetime as dt')

  await expect
    .poll(async () =>
      page.locator('.anynote-code-block pre').evaluate((pre) => ({
        text: pre.textContent,
        childTexts: Array.from(pre.childNodes).map((child) => child.textContent),
      })),
    )
    .toEqual({
      text: 'import datetime as dt',
      childTexts: ['import datetime as dt'],
    })

  const metrics = await page.locator('.anynote-code-block pre').evaluate((pre) => {
    const code = pre.querySelector('code')
    if (!code) return null

    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    if (!textNode?.textContent) return null

    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent.length)
    const textRect = range.getBoundingClientRect()
    const codeRect = code.getBoundingClientRect()
    const preRect = pre.getBoundingClientRect()
    const codeStyles = getComputedStyle(code)

    return {
      elementTop: Math.round(codeRect.top - preRect.top),
      elementBottom: Math.round(preRect.bottom - codeRect.bottom),
      elementLeft: Math.round(codeRect.left - preRect.left),
      elementRight: Math.round(preRect.right - codeRect.right),
      textTop: Math.round(textRect.top - preRect.top),
      textBottom: Math.round(preRect.bottom - textRect.bottom),
      preHeight: Math.round(preRect.height),
      textHeight: Math.round(textRect.height),
      codeBackground: codeStyles.backgroundColor,
      codeBorderRadius: codeStyles.borderRadius,
    }
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.elementTop).toBeGreaterThanOrEqual(metrics!.elementLeft - 1)
  expect(metrics!.elementTop).toBeLessThanOrEqual(metrics!.elementLeft + 1)
  expect(metrics!.elementBottom).toBeGreaterThanOrEqual(metrics!.elementLeft - 1)
  expect(metrics!.elementBottom).toBeLessThanOrEqual(metrics!.elementLeft + 1)
  expect(metrics!.elementRight).toBeGreaterThanOrEqual(metrics!.elementLeft - 1)
  expect(metrics!.elementRight).toBeLessThanOrEqual(metrics!.elementLeft + 1)
  expect(metrics!.preHeight).toBeGreaterThanOrEqual(metrics!.textHeight + metrics!.elementLeft * 2)
  expect(metrics!.codeBackground).toBe('rgba(0, 0, 0, 0)')
  expect(metrics!.codeBorderRadius).toBe('0px')
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
