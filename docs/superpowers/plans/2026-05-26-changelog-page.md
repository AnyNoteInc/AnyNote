# Changelog Page (`/changelog`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `/changelog` page that renders a curated, Russian-language `docs/changelog.md` and is reachable from the marketing AppBar next to «Цены».

**Architecture:** Mirror the existing `/terms` page exactly — a hand-written markdown file under `docs/` rendered through the already-configured MDX pipeline (`@next/mdx` + `remark-gfm`, `@docs` alias, global styles in `apps/web/src/mdx-components.tsx`) inside `PublicPageShell`. No new rendering mechanism, no new workspace package. Wiring (nav item, footer link, sitemap) is plain data edits.

**Tech Stack:** Next.js 16 App Router (RSC), MUI v6 via `@repo/ui`, `@next/mdx`, Vitest (web unit tests), Playwright (E2E).

**Spec:** [docs/superpowers/specs/2026-05-26-changelog-page-design.md](../specs/2026-05-26-changelog-page-design.md)

**Branch:** `feat/changelog-page` (already created; spec already committed there).

**Prerequisites for E2E (Task 3) and gates (Task 5):**
- `docker compose up -d` must be running (Playwright boots its own `next dev` on port 3100, which still talks to Postgres for `getSession()` and the home-page pricing query).

---

### Task 1: Navigation + footer link

Add the «Обновления» entry so it renders in the AppBar (next to «Цены») and in the footer «Продукт» section. Both are driven by data arrays in `content.ts`; the header (`public-header.tsx`) and footer (`public-footer.tsx`) iterate those arrays, so no component edits are needed.

**Files:**
- Modify: `apps/web/src/components/public/content.ts`
- Test: `apps/web/test/public-nav.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/public-nav.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { publicFooterSections, publicNavItems } from '../src/components/public/content'

describe('public navigation', () => {
  it('exposes the changelog page in the AppBar nav', () => {
    expect(publicNavItems).toContainEqual({ label: 'Обновления', href: '/changelog' })
  })

  it('keeps pricing in the AppBar nav', () => {
    expect(publicNavItems).toContainEqual({ label: 'Цены', href: '/pricing' })
  })

  it('links to the changelog from the footer «Продукт» section', () => {
    const product = publicFooterSections.find((section) => section.title === 'Продукт')
    expect(product?.links).toContainEqual({ label: 'Обновления', href: '/changelog' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/public-nav.test.ts`
Expected: FAIL — first and third assertions fail (`toContainEqual` does not find the «Обновления» entry); the pricing assertion passes.

- [ ] **Step 3: Edit `content.ts`**

In `apps/web/src/components/public/content.ts`, add the changelog entry to `publicNavItems` (after «Цены»):

```ts
export const publicNavItems = [
  { label: 'Цены', href: '/pricing' },
  { label: 'Обновления', href: '/changelog' },
] as const
```

And add it to the «Продукт» footer section (after «Тарифы»):

```ts
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '/#features' },
      { label: 'Тарифы', href: '/pricing' },
      { label: 'Обновления', href: '/changelog' },
    ],
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/public-nav.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/test/public-nav.test.ts apps/web/src/components/public/content.ts
git commit -m "feat(web): add changelog nav item next to pricing"
```

---

### Task 2: Changelog content (`docs/changelog.md`)

Hand-written, curated content (the canonical text lives in the spec's content map). Format: **no top-level `#` H1** (the page title comes from `PublicPageShell`); one `##` block per minor version, newest first; `**Новое**` / `**Исправлено**` bold labels above bullet lists; `---` between blocks; the «Готовится» block first.

**Files:**
- Create: `docs/changelog.md`

- [ ] **Step 1: Verify the one uncertain release line before writing**

Run: `git show --stat 72f65ce | head -40`
Confirm the v1.7 «add themes» change is the theme switcher in the user menu (`workspace-user-menu.tsx`) plus date-insert tweaks. If the diff says otherwise, adjust the v1.7 block wording in Step 2 to match what actually shipped. Do **not** invent behavior.

- [ ] **Step 2: Create `docs/changelog.md`**

```markdown
## Готовится

Эти возможности уже доступны в продукте и проходят финальную проверку перед официальным релизом.

**Комментарии к страницам**

- Обсуждения прямо в тексте: выделите фрагмент, оставьте комментарий и ведите тред — с пометкой «решено» и повторным открытием.
- Упоминания участников через «@» с уведомлением тому, кого упомянули.
- Всплывающее окно треда рядом с выделенным фрагментом и прямые ссылки на конкретный комментарий.
- Комментарии работают и на странице, открытой по публичной ссылке.

**Публичные ссылки с правами доступа**

- Делитесь страницей по ссылке: роль «Комментатор» даёт чтение и комментарии без права на правку.
- Гостевой доступ для тех, у кого нет аккаунта.

---

## v1.21 — Избранные чаты и обновлённые пространства · 19 мая 2026

**Новое**

- Избранные чаты — быстрый доступ к важным диалогам с ИИ.
- Переработанный экран рабочих пространств.

**Исправлено**

- Надёжнее работает создание страниц из чата на моделях GigaChat-2 Pro.

---

## v1.20 — ИИ создаёт страницы из чата · 18 мая 2026

**Новое**

- ИИ-агент может сам создать страницу с готовым содержимым прямо из диалога и вернуть ссылку на неё — например, конспект обсуждения.

---

## v1.19 — Новый ИИ-агент: план, действие, самопроверка · 18 мая 2026

**Новое**

- Переработанный ИИ-агент работает по схеме «план → выполнение → самопроверка» и доводит задачу до результата.
- Подключение собственных MCP-серверов в разделе «Настройки → Интеграции → MCP».
- Память агента: он запоминает важные факты о вас и проекте, а список и удаление доступны в «Настройки → Память».
- Подтверждение действий: перед чувствительной операцией агент спрашивает разрешение.
- Панель плана в чате показывает шаги выполнения в реальном времени.

---

## v1.18 — Канбан-доски · 16 мая 2026

**Новое**

- Доски задач с перетаскиванием карточек, спринтами и представлениями «Доска», «Таблица» и «Диаграмма Ганта».
- Карточки задач с типами, приоритетами, метками, исполнителями и вложениями.
- Комментарии и журнал активности в задачах, архив и подзадачи.

**Исправлено**

- Обновления доски приходят в реальном времени, без перезагрузки страницы.

---

## v1.17 — Превью ссылок и поисковая выдача · 14 мая 2026

**Новое**

- Аккуратные карточки-превью с заголовком, описанием и картинкой при публикации ссылок в соцсетях и мессенджерах.
- Карта сайта и корректные метаданные для поисковых систем.

---

## v1.16 — Развитие генограмм · 14 мая 2026

**Новое**

- Заметки на элементах, роли «предшественник» и «партнёр», аккуратная раскладка для сложных связей между ветвями семьи.

---

## v1.15 — Тарифы и оплата · 13 мая 2026

**Новое**

- Обновлённые цены тарифов ПРО и МАКС.

**Исправлено**

- Оплата через YooKassa подтверждается сразу на странице возврата, не дожидаясь вебхука.
- Новая фирменная иконка и favicon — оранжевый ромб.

---

## v1.14 — Колонки в редакторе · 13 мая 2026

**Новое**

- Колоночная вёрстка с произвольным числом колонок и перетаскиваемыми разделителями; поддержка списков-задач.

---

## v1.13 — Напоминания · 11 мая 2026

**Новое**

- Напоминания на страницах помогают вернуться к заметке вовремя; быстрая вставка через «/».

**Исправлено**

- Управление уведомлениями: удаление всех сразу и корректная позиция всплывающего окна.

---

## v1.12 — Редизайн боковой панели · 11 мая 2026

**Новое**

- Боковая панель в режимах «полная» и «скрытая», колокольчик уведомлений, корзина внизу и горячие клавиши.

**Исправлено**

- Выравнивание вложенных пунктов-задач и компактное оглавление по умолчанию.

---

## v1.11 — Уведомления · 11 мая 2026

**Новое**

- Система уведомлений: в приложении, на электронную почту и push в браузере.

---

## v1.10 — Юридически значимые согласия · 10 мая 2026

**Новое**

- Полный учёт согласий пользователя (соглашение, политика, обработка персональных данных, оферта) с историей версий.

---

## v1.8 — Оглавление документа · 8 мая 2026

**Новое**

- Оглавление страницы для быстрой навигации по длинным документам, меню действий страницы и режим полной ширины.

---

## v1.7 — Переключение темы из меню · 8 мая 2026

**Новое**

- Светлая и тёмная темы переключаются прямо из меню пользователя; улучшена вставка даты в редакторе.

---

## v1.5 — Экспорт страниц · 7 мая 2026

**Новое**

- Экспорт страниц в PDF, HTML и Markdown с серверным рендерингом.

---

## v1.4 — Поиск по пространству · 6 мая 2026

**Новое**

- Поиск по рабочему пространству по горячей клавише ⌘/Alt+K с ИИ-поиском по смыслу и историей запросов.

---

## v1.2 — Письма приходят сразу · 5 мая 2026

**Новое**

- Подтверждение почты, сброс и повторная отправка пароля — с моментальной доставкой письма.

---

## v1.1 — Юридические документы · 4 мая 2026

**Новое**

- Страницы юридических документов (соглашение, политика и другие) и обновлённый футер.

**Исправлено**

- Стабилизированы вход через Google и проверка reCAPTCHA.

---

## v1.0 — Запуск · 3 мая 2026

**Новое**

- Совместный редактор документов: одновременная правка несколькими людьми, курсоры соавторов, перетаскивание блоков, slash-меню, таблицы, списки-задачи и цветовое выделение.
- Рабочие пространства и дерево страниц; типы страниц — текст, доска Excalidraw, генограмма и диаграммы Mermaid.
- Избранное, корзина с очисткой, переименование, дублирование и перемещение страниц по дереву.
- ИИ-чат в рабочем пространстве с поиском по вашим страницам и переиндексацией.
- Вход по электронной почте и через Google, подтверждение почты, reCAPTCHA; загрузка и скачивание файлов-вложений.
- Светлая и тёмная темы, русская локализация, аватар в боковой панели и профиле.
```

- [ ] **Step 3: Format-check the file**

Run: `pnpm exec prettier --check docs/changelog.md`
Expected: either "All matched files use Prettier code style!" or a list of fixes. If it reports issues, run `pnpm exec prettier --write docs/changelog.md` and re-check.

- [ ] **Step 4: Commit**

```bash
git add docs/changelog.md
git commit -m "docs(changelog): curated Russian release history"
```

---

### Task 3: Changelog page + renderer + E2E

Create the route. The renderer is a tiny `'use client'` component that imports the MDX file (exact mirror of `terms/[document]/legal-document-renderer.tsx`); the page is a server component mirroring `pricing/page.tsx` (metadata + breadcrumbs JSON-LD + `PublicPageShell`).

**Files:**
- Create: `apps/web/src/app/(about)/changelog/changelog-content.tsx`
- Create: `apps/web/src/app/(about)/changelog/page.tsx`
- Test: `apps/e2e/changelog.spec.ts` (create)

- [ ] **Step 1: Write the failing E2E spec**

Create `apps/e2e/changelog.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test.describe('Changelog page', () => {
  test('renders /changelog for anonymous visitors', async ({ page, context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
    await page.goto('/changelog')

    await expect(page.getByRole('heading', { level: 1 })).toContainText('История изменений')
    await expect(page.locator('main')).toContainText('Готовится')
    await expect(page.locator('main')).toContainText('Канбан-доски')
  })

  test('is reachable from the AppBar next to pricing', async ({ page, context }) => {
    await context.addCookies([
      { name: 'cookie-consent', value: 'accepted', domain: 'localhost', path: '/' },
    ])
    await page.goto('/')

    await page.getByRole('link', { name: 'Обновления' }).first().click()
    await expect(page).toHaveURL(/\/changelog$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('История изменений')
  })
})
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm exec playwright test apps/e2e/changelog.spec.ts`
Expected: FAIL — `/changelog` returns the Next 404 page (route does not exist yet), so the `История изменений` heading assertion fails in both tests.

- [ ] **Step 3: Create the renderer**

Create `apps/web/src/app/(about)/changelog/changelog-content.tsx`:

```tsx
'use client'

import Changelog from '@docs/changelog.md'

export function ChangelogContent() {
  return <Changelog />
}
```

- [ ] **Step 4: Create the page**

Create `apps/web/src/app/(about)/changelog/page.tsx`:

```tsx
import { PublicPageShell } from '@/components/public/public-page-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

import { ChangelogContent } from './changelog-content'

export const metadata = buildMetadata({
  title: 'История изменений',
  path: '/changelog',
  description:
    'Что нового в «Любые заметки»: новые возможности редактора, ИИ-агент, канбан-доски, совместная работа, уведомления и публикация страниц.',
  keywords: ['история изменений', 'обновления', 'changelog заметки'],
})

export default function ChangelogPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'История изменений', url: `${siteConfig.url}/changelog` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <PublicPageShell
        eyebrow="Обновления"
        title="История изменений"
        description="Коротко о том, что менялось в продукте: новые возможности и заметные улучшения, свежее — сверху."
      >
        <ChangelogContent />
      </PublicPageShell>
    </>
  )
}
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm exec playwright test apps/e2e/changelog.spec.ts`
Expected: PASS (2 passed). If the first navigation times out on cold Turbopack compile, re-run with `--retries 1` (dev-only flake; see `feedback_e2e_cold_compile_retries`).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(about)/changelog/changelog-content.tsx" "apps/web/src/app/(about)/changelog/page.tsx" apps/e2e/changelog.spec.ts
git commit -m "feat(web): public /changelog page rendering docs/changelog.md"
```

---

### Task 4: Sitemap entry

Add `/changelog` to the sitemap and refresh the static-pages timestamp so crawlers re-fetch.

**Files:**
- Modify: `apps/web/src/app/sitemap.ts`
- Test: `apps/web/test/sitemap.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/sitemap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import sitemap from '../src/app/sitemap'

describe('sitemap', () => {
  it('lists the public changelog page', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.some((url) => url.endsWith('/changelog'))).toBe(true)
  })

  it('still lists pricing', () => {
    const urls = sitemap().map((entry) => entry.url)
    expect(urls.some((url) => url.endsWith('/pricing'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run test/sitemap.test.ts`
Expected: FAIL — the changelog assertion fails (no `/changelog` URL yet); the pricing assertion passes.

- [ ] **Step 3: Edit `sitemap.ts`**

In `apps/web/src/app/sitemap.ts`, bump the constant:

```ts
const STATIC_PAGES_LAST_MODIFIED = new Date('2026-05-26')
```

And add a `/changelog` entry immediately after the `/pricing` object (before the `/terms` entry):

```ts
    {
      url: `${base}/changelog`,
      lastModified: STATIC_PAGES_LAST_MODIFIED,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run test/sitemap.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/sitemap.ts apps/web/test/sitemap.test.ts
git commit -m "feat(seo): list /changelog in the sitemap"
```

---

### Task 5: Full gates + manual verification

Confirm the whole web app type-checks, lints, builds (prod webpack path — catches RSC↔Client and MDX-resolution issues), and tests pass.

**Files:** none (verification only)

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: PASS — `check-types`, `lint` (`--max-warnings 0`), `build`, and `test` all green. The web build must resolve `@docs/changelog.md` under webpack exactly as it already does for `docs/terms/*.md`.

- [ ] **Step 2: Manual smoke check**

Run: `pnpm --filter web dev` then open `http://localhost:3000/`.
Confirm:
- «Обновления» appears in the header next to «Цены» and opens `/changelog`.
- The changelog shows the «История изменений» title, the «Готовится» block first, then v1.21 → v1.0 with `---` dividers and styled lists.
- Light and dark themes both render correctly; the page is readable at mobile width.

- [ ] **Step 3: Final commit (only if Step 1/2 required fixes)**

```bash
git add -A
git commit -m "chore(changelog): address gate/manual-check fixes"
```

---

## Notes for the implementer

- **Why a `'use client'` renderer:** it mirrors the proven `legal-document-renderer.tsx`. A direct `import Changelog from '@docs/changelog.md'` in the RSC page may also work, but the client wrapper is the established, low-risk pattern in this repo — keep it.
- **No `next.config.js` change:** the `@docs` alias and `remark-gfm` MDX pipeline already exist and already ship `docs/` in the Docker build context (fixed in v1.1.1). Do not add a new `transpilePackages` entry — there is no new package.
- **No duplicate H1:** `docs/changelog.md` must not start with `#`. The only `<h1>` on the page is the `PublicPageShell` title, which keeps `getByRole('heading', { level: 1 })` unambiguous.
- **Strict-mode locators:** «Обновления» appears in both header and footer; the E2E uses `.first()` to target the header (it precedes `<main>`/`<footer>` in the DOM).
```
