import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TiptapTransformer } from '@hocuspocus/transformer'
import { signUpAndAuthAs } from './helpers/auth'
import Document from '@tiptap/extension-document'
import Heading from '@tiptap/extension-heading'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import * as Y from 'yjs'

/**
 * Regression for the right-hand page-outline quick navigation:
 * clicking one section and then a second (lower) section must land the
 * scroll container on the second section — not jump back or park at a
 * wrong position.
 *
 * Runs against `next dev` with no Hocuspocus server: the outline reads the
 * in-memory Tiptap doc, so seeded contentYjs renders fine without persistence.
 */

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: { findUniqueOrThrow: (args: unknown) => Promise<{ id: string }> }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: { create: (args: unknown) => Promise<unknown> }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
}

test.setTimeout(180_000)

test.beforeAll(async () => {
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  const readVar = (key: string): string | undefined =>
    envFile
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${key}=`))
      ?.slice(`${key}=`.length)
      .replace(/^"|"$/g, '')
  if (!process.env.DATABASE_URL) {
    const databaseUrl = readVar('DATABASE_URL')
    if (!databaseUrl) throw new Error('DATABASE_URL not configured in .env')
    process.env.DATABASE_URL = databaseUrl
  }
  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = 'SuperSecure123!'
const EXTENSIONS = [Document, Paragraph, Text, Heading]
const SECTIONS = 12

function buildContentYjs(content: object): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

/** `h2 "Раздел NN"` sections + filler so the page really scrolls. */
function buildDoc(sections = SECTIONS, fillerParagraphs = 3, fillerRepeat = 30): object {
  const filler = 'Наполнение раздела, много текста для высоты страницы. '.repeat(fillerRepeat)
  const content: object[] = []
  for (let i = 1; i <= sections; i++) {
    const name = `Раздел ${String(i).padStart(2, '0')}`
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: name }],
    })
    for (let p = 0; p < fillerParagraphs; p++) {
      content.push({ type: 'paragraph', content: [{ type: 'text', text: filler }] })
    }
  }
  return { type: 'doc', content }
}

type TraceEntry = { t: number; y: number; kind: string }

declare global {
  interface Window {
    __outlineTrace?: TraceEntry[]
  }
}

async function installTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const container = document.querySelector('.page-content-scroll') as HTMLElement | null
    if (!container) throw new Error('.page-content-scroll not found')
    const trace: { t: number; y: number; kind: string }[] = []
    window.__outlineTrace = trace
    container.addEventListener(
      'scroll',
      () => trace.push({ t: performance.now(), y: container.scrollTop, kind: 'scroll' }),
      { passive: true },
    )
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement
      trace.push({
        t: performance.now(),
        y: container.scrollTop,
        kind: `focus:${target.tagName}${target.className ? '.' + String(target.className).slice(0, 40) : ''}`,
      })
    })
  })
}

async function markTrace(page: Page, label: string): Promise<void> {
  await page.evaluate((label) => {
    const container = document.querySelector('.page-content-scroll') as HTMLElement
    window.__outlineTrace?.push({ t: performance.now(), y: container.scrollTop, kind: label })
  }, label)
}

/** Resolve once scrollTop stays unchanged for `quietMs` (or timeout). */
async function waitForScrollSettle(page: Page, quietMs = 700, timeout = 8_000): Promise<number> {
  return page.evaluate(
    ({ quietMs, timeout }) =>
      new Promise<number>((resolve) => {
        const container = document.querySelector('.page-content-scroll') as HTMLElement
        let last = container.scrollTop
        let lastChange = performance.now()
        const start = performance.now()
        const iv = window.setInterval(() => {
          const now = performance.now()
          if (container.scrollTop !== last) {
            last = container.scrollTop
            lastChange = now
          }
          if (now - lastChange >= quietMs || now - start > timeout) {
            window.clearInterval(iv)
            resolve(container.scrollTop)
          }
        }, 50)
      }),
    { quietMs, timeout },
  )
}

/** Absolute scrollTop the outline's handleClick aims for (same formula). */
async function expectedScrollTop(page: Page, sectionIndex: number): Promise<number> {
  return page.evaluate((sectionIndex) => {
    const container = document.querySelector('.page-content-scroll') as HTMLElement
    const headings = document.querySelectorAll<HTMLElement>('.anynote-editor .ProseMirror h2')
    const el = headings[sectionIndex]
    if (!el) throw new Error(`heading index ${sectionIndex} not found`)
    const top =
      container.scrollTop +
      (el.getBoundingClientRect().top - container.getBoundingClientRect().top) -
      16
    return Math.max(0, top)
  }, sectionIndex)
}

async function dumpTrace(page: Page, title: string): Promise<void> {
  const trace = await page.evaluate(() => window.__outlineTrace ?? [])
  console.log(`\n===== trace: ${title} =====`)
  for (const e of trace) console.log(`${e.t.toFixed(0)}ms y=${e.y.toFixed(0)} ${e.kind}`)
  console.log('===== end trace =====\n')
}

async function setupPage(
  page: Page,
  doc?: object,
): Promise<{ pageId: string; cleanup: () => Promise<void> }> {
  const email = `outline-nav+${Date.now()}@example.com`
  await signUpAndAuthAs(page, { email, password, firstName: 'Навигация', lastName: 'Тест' })

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })
  const workspace = await prisma.workspace.create({
    data: { name: `Outline nav ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })
  const content = doc ?? buildDoc()
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Быстрая навигация',
      type: 'TEXT',
      content,
      contentYjs: buildContentYjs(content),
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })
  const cleanup = async () => {
    await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
    await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
  }
  return { pageId: pageRow.id, cleanup }
}

async function openOutlinePanel(page: Page) {
  const nav = page.locator('nav[aria-label="Содержание страницы"]')
  await expect(nav).toBeVisible({ timeout: 15_000 })
  await nav.hover()
  const panel = page.locator('.MuiPopover-paper')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  return panel
}

test('outline: two sequential clicks land on the second target (settled)', async ({ page }) => {
  const { pageId, cleanup } = await setupPage(page)
  try {
    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror h2').first()).toBeVisible({
      timeout: 30_000,
    })
    await installTrace(page)

    const panel = await openOutlinePanel(page)

    // Click 1: a section below the viewport.
    await markTrace(page, 'CLICK Раздел 06')
    await panel.getByRole('button', { name: 'Раздел 06', exact: true }).click()
    const y1 = await waitForScrollSettle(page)
    const want1 = await expectedScrollTop(page, 5)

    // Click 2: another section further below, after everything settled.
    await markTrace(page, 'CLICK Раздел 10')
    await panel.getByRole('button', { name: 'Раздел 10', exact: true }).click()
    const y2 = await waitForScrollSettle(page)
    const want2 = await expectedScrollTop(page, 9)

    await dumpTrace(page, 'sequential clicks')
    console.log(`click1: settled=${y1} expected=${want1}`)
    console.log(`click2: settled=${y2} expected=${want2}`)

    expect(Math.abs(y1 - want1), `first click parked at ${y1}, expected ~${want1}`).toBeLessThan(60)
    expect(Math.abs(y2 - want2), `second click parked at ${y2}, expected ~${want2}`).toBeLessThan(
      60,
    )
  } finally {
    await cleanup()
  }
})

test('outline: clicks navigate when the editor already holds the caret', async ({ page }) => {
  const { pageId, cleanup } = await setupPage(page)
  try {
    await page.goto(`/pages/${pageId}`)
    const firstHeading = page.locator('.anynote-editor .ProseMirror h2').first()
    await expect(firstHeading).toBeVisible({ timeout: 30_000 })
    // Put the caret into the document first, like a user who just typed.
    await firstHeading.click()
    await installTrace(page)

    const panel = await openOutlinePanel(page)

    await markTrace(page, 'CLICK Раздел 06')
    await panel.getByRole('button', { name: 'Раздел 06', exact: true }).click()
    const y1 = await waitForScrollSettle(page)
    const want1 = await expectedScrollTop(page, 5)

    await markTrace(page, 'CLICK Раздел 10')
    await panel.getByRole('button', { name: 'Раздел 10', exact: true }).click()
    const y2 = await waitForScrollSettle(page)
    const want2 = await expectedScrollTop(page, 9)

    await dumpTrace(page, 'focused editor clicks')
    console.log(`focused click1: settled=${y1} expected=${want1}`)
    console.log(`focused click2: settled=${y2} expected=${want2}`)

    expect(Math.abs(y1 - want1), `first click parked at ${y1}, expected ~${want1}`).toBeLessThan(60)
    expect(Math.abs(y2 - want2), `second click parked at ${y2}, expected ~${want2}`).toBeLessThan(
      60,
    )
  } finally {
    await cleanup()
  }
})

test('outline: dense doc with many headings — two clicks land on targets', async ({ page }) => {
  // 30 short sections: several headings per viewport, the mini-bar nav and
  // the popover panel both overflow and scroll internally.
  const { pageId, cleanup } = await setupPage(page, buildDoc(30, 1, 8))
  try {
    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror h2').first()).toBeVisible({
      timeout: 30_000,
    })
    await installTrace(page)

    const panel = await openOutlinePanel(page)

    await markTrace(page, 'CLICK Раздел 12')
    await panel.getByRole('button', { name: 'Раздел 12', exact: true }).click()
    const y1 = await waitForScrollSettle(page)
    const want1 = await expectedScrollTop(page, 11)

    await markTrace(page, 'CLICK Раздел 20')
    await panel.getByRole('button', { name: 'Раздел 20', exact: true }).click()
    const y2 = await waitForScrollSettle(page)
    const want2 = await expectedScrollTop(page, 19)

    await dumpTrace(page, 'dense doc clicks')
    console.log(`dense click1: settled=${y1} expected=${want1}`)
    console.log(`dense click2: settled=${y2} expected=${want2}`)

    expect(Math.abs(y1 - want1), `first click parked at ${y1}, expected ~${want1}`).toBeLessThan(60)
    expect(Math.abs(y2 - want2), `second click parked at ${y2}, expected ~${want2}`).toBeLessThan(
      60,
    )
  } finally {
    await cleanup()
  }
})

test('outline: panel does not scale-animate after opening (clicks are aim-safe)', async ({
  page,
}) => {
  // MUI Popover's default Grow transition scales the paper for ~300ms after
  // open. During that window item coordinates shift by dozens of pixels, so a
  // click aimed at one section lands on another (or dies when mousedown and
  // mouseup straddle different buttons). The outline panel opens on hover and
  // must be click-stable from the first visible frame.
  const { pageId, cleanup } = await setupPage(page, buildDoc(30, 1, 8))
  try {
    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror h2').first()).toBeVisible({
      timeout: 30_000,
    })

    const nav = page.locator('nav[aria-label="Содержание страницы"]')
    await expect(nav).toBeVisible({ timeout: 15_000 })
    // Sample the paper's transform every frame for 300ms starting the moment
    // it exists. Any scale animation shows up as a non-identity matrix.
    const hover = nav.hover()
    const transforms = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = []
          const t0 = performance.now()
          const tick = () => {
            const paper = document.querySelector('.MuiPopover-paper')
            if (paper) {
              const t = getComputedStyle(paper).transform
              if (t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)' && !seen.includes(t)) {
                seen.push(t)
              }
            }
            if (performance.now() - t0 > 800) resolve(seen)
            else requestAnimationFrame(tick)
          }
          tick()
        }),
    )
    await hover
    expect(transforms, `paper scale-animated after open: ${transforms.join('; ')}`).toEqual([])
  } finally {
    await cleanup()
  }
})

test('outline: opening the panel reveals the active section', async ({ page }) => {
  // The panel list overflows with many headings. When it opens it must be
  // scrolled so the CURRENT section is visible — otherwise "the section
  // below" sits past the panel fold and aiming at it closes the hover menu.
  const { pageId, cleanup } = await setupPage(page, buildDoc(30, 1, 8))
  try {
    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror h2').first()).toBeVisible({
      timeout: 30_000,
    })

    // Jump the page to section 25 like a user who scrolled there.
    const want = await expectedScrollTop(page, 24)
    await page.evaluate((top) => {
      document.querySelector('.page-content-scroll')!.scrollTo({ top })
    }, want)
    // Wait until the outline's scroll tracker marks section 25 active.
    await expect(
      page.locator(`nav[aria-label="Содержание страницы"] [data-outline-index="24"]`),
    ).toHaveAttribute('aria-current', 'true', { timeout: 5_000 })

    const panel = await openOutlinePanel(page)
    const active = panel.getByRole('button', { name: 'Раздел 25', exact: true })
    await expect(active).toBeVisible()
    // Visible within the panel's scroll viewport, not clipped past the fold.
    const inView = await active.evaluate((el) => {
      const paper = el.closest('.MuiPopover-paper')!
      const r = el.getBoundingClientRect()
      const p = paper.getBoundingClientRect()
      return r.top >= p.top && r.bottom <= p.bottom
    })
    expect(inView, 'active section is clipped outside the open panel').toBe(true)
  } finally {
    await cleanup()
  }
})

test('outline: typed content + wheel scroll + two clicks (user-faithful flow)', async ({
  page,
}) => {
  // Seed an EMPTY page, then type the sections like a real user: markdown
  // `## ` input rule for headings, caret ends at the bottom of the doc.
  const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }
  const { pageId, cleanup } = await setupPage(page, emptyDoc)
  try {
    await page.goto(`/pages/${pageId}`)
    const editor = page.locator('.anynote-editor .ProseMirror')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.click()

    const filler = 'Текст раздела, немного наполнения для высоты страницы. '.repeat(6)
    for (let i = 1; i <= 10; i++) {
      await page.keyboard.type(`## Заголовок ${String(i).padStart(2, '0')}`)
      await page.keyboard.press('Enter')
      for (let p = 0; p < 2; p++) {
        await page.keyboard.insertText(filler)
        await page.keyboard.press('Enter')
      }
    }
    await expect(editor.locator('h2')).toHaveCount(10, { timeout: 10_000 })

    // Wheel back to the top like a user (caret stays at the doc end).
    await editor.hover()
    await page.mouse.wheel(0, -100_000)
    await page.waitForFunction(() => {
      const c = document.querySelector('.page-content-scroll')
      return c instanceof HTMLElement && c.scrollTop === 0
    })

    await installTrace(page)
    const panel = await openOutlinePanel(page)

    await markTrace(page, 'CLICK Заголовок 05')
    await panel.getByRole('button', { name: 'Заголовок 05', exact: true }).click()
    const y1 = await waitForScrollSettle(page)
    const want1 = await expectedScrollTop(page, 4)

    await markTrace(page, 'CLICK Заголовок 09')
    await panel.getByRole('button', { name: 'Заголовок 09', exact: true }).click()
    const y2 = await waitForScrollSettle(page)
    const want2 = await expectedScrollTop(page, 8)

    await dumpTrace(page, 'typed-content clicks')
    console.log(`typed click1: settled=${y1} expected=${want1}`)
    console.log(`typed click2: settled=${y2} expected=${want2}`)

    expect(Math.abs(y1 - want1), `first click parked at ${y1}, expected ~${want1}`).toBeLessThan(60)
    expect(Math.abs(y2 - want2), `second click parked at ${y2}, expected ~${want2}`).toBeLessThan(
      60,
    )
  } finally {
    await cleanup()
  }
})

test('outline: rapid second click (mid-animation) still lands on the second target', async ({
  page,
}) => {
  const { pageId, cleanup } = await setupPage(page)
  try {
    await page.goto(`/pages/${pageId}`)
    await expect(page.locator('.anynote-editor .ProseMirror h2').first()).toBeVisible({
      timeout: 30_000,
    })
    await installTrace(page)

    const panel = await openOutlinePanel(page)

    await markTrace(page, 'CLICK Раздел 06')
    await panel.getByRole('button', { name: 'Раздел 06', exact: true }).click()
    // Click again while the first smooth scroll is still animating and the
    // first deferred focus timer has not fired yet.
    await page.waitForTimeout(250)
    await markTrace(page, 'CLICK Раздел 10')
    await panel.getByRole('button', { name: 'Раздел 10', exact: true }).click()

    const y2 = await waitForScrollSettle(page)
    const want2 = await expectedScrollTop(page, 9)

    await dumpTrace(page, 'rapid clicks')
    console.log(`rapid click2: settled=${y2} expected=${want2}`)

    expect(Math.abs(y2 - want2), `second click parked at ${y2}, expected ~${want2}`).toBeLessThan(
      60,
    )
  } finally {
    await cleanup()
  }
})
