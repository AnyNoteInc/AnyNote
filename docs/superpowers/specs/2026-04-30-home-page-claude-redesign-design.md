---
status: draft
date: 2026-04-30
topic: home page Claude-style redesign + rebrand to "Любые заметки"
---

# Home Page Claude Redesign — Design

## Goal

Repaint the public home page ([apps/web/src/app/page.tsx](apps/web/src/app/page.tsx)) in a Claude-influenced editorial aesthetic (paper-cream palette, serif headings with italic accent color, origami-style geometric motifs) and align all user-facing copy with the new product name "Любые заметки" and the Russian "ИИ" abbreviation in place of "AI".

A new "Что ещё" capability grid, a "Особое решение" contact section, and a redesigned dark footer are added. Existing sections (hero, market-fit, modes, ИИ-поиск, тарифы, final CTA) are repainted but keep their semantic role.

## Current state

- The home page lives entirely in [apps/web/src/app/page.tsx](apps/web/src/app/page.tsx) (≈908 lines, all section subcomponents defined inline).
- Public chrome lives at [apps/web/src/components/public/public-header.tsx](apps/web/src/components/public/public-header.tsx) and [apps/web/src/components/public/public-footer.tsx](apps/web/src/components/public/public-footer.tsx); both reference the brand "AnyNote" and link `publicFooterSections` from [apps/web/src/components/public/content.ts](apps/web/src/components/public/content.ts).
- A reusable `<ContactForm>` already exists at [apps/web/src/components/public/contact-form.tsx](apps/web/src/components/public/contact-form.tsx) with three fields (name / email / phone) and submits to `console.log`. It is currently used only on the contact page.
- Pricing data lives in [apps/web/src/components/public/content.ts](apps/web/src/components/public/content.ts) as `landingPricingCards`. The "ПРО" tier description currently says "Чаты с AI" — needs to change to "Чаты с ИИ".
- `landingPricingCards` already contains four entries (Персональный, ПРО, МАКС, Собственная инфраструктура), matching the new four-column layout — no data shape change needed.
- Workspace UI reality: the in-product `/workspaces/{id}` page tree contains pages of type `TEXT | EXCALIDRAW | GENOGRAM` with emoji icons; sidebar shows workspace name, plan chip, "Поиск и чаты", "Настройки", favorites, page tree, "Корзина", user menu — see [apps/web/src/components/workspace/workspace-sidebar.tsx](apps/web/src/components/workspace/workspace-sidebar.tsx). The current hero mockup invents "Клиенты / Ромашка / договоры" which does not exist in the product. The redesign mirrors the real sidebar and shows pages, not clients.
- MUI v6 is the design system (consumed via `@repo/ui/components`). `@repo/ui` already exports `Box`, `Container`, `Stack`, `Typography`, `Button`, `Divider`, `Paper`, `TextField`, `Alert`, plus icon set. Custom CSS via `sx` prop is the pattern used across the codebase — keeping it.
- Fonts: `var(--font-geist-mono)` is wired in the root layout; for serif headings we will introduce one additional Google-hosted serif (Charter alternatives → Crimson Pro or Source Serif 4 via `next/font`, decided in the implementation plan).

## Non-goals

- Backing the contact form with a real mailer endpoint. The submit handler stays `console.log` + success Alert, matching the existing `<ContactForm>` behavior. Wiring outbox/email is a follow-up.
- Database, tRPC, or content-CMS changes. All copy lives in `content.ts` as plain TS literals.
- Internationalization. The page is Russian-only; no i18n keys.
- Editing any in-product surface (`/app`, `/workspaces/*`, settings). Rebrand only touches public surfaces (home, header, footer, marketing pages, registration / sign-in copy stays unchanged for this pass).
- A/B testing infrastructure or analytics events for the new sections.
- Changing pricing numbers, plan names, or plan slugs.
- Mobile-app shell. Responsive web only.
- Replacing existing brand artwork in `BrandMark` — the origami motif lives inline in the page CSS, not as a swap of the logo component.

## Visual language

### Palette (CSS custom properties on the page root)

| Token           | Hex                   | Usage                                              |
| --------------- | --------------------- | -------------------------------------------------- |
| `--paper`       | `#faf9f5`             | section backgrounds, sidebar in mockup             |
| `--paper-deep`  | `#f0eee6`             | hero gradient end, button text on dark             |
| `--ink`         | `#1d1d1b`             | primary text, dark sections, primary button        |
| `--ink-soft`    | `rgba(29,29,27,0.65)` | body copy on light                                 |
| `--ink-mute`    | `rgba(29,29,27,0.42)` | eyebrows, captions                                 |
| `--orange`      | `#c96442`             | accent (italic in headings, indicators, CTA hover) |
| `--orange-warm` | `#d97757`             | secondary accent (origami highlights, gradients)   |
| `--line`        | `rgba(0,0,0,0.08)`    | hairlines and subtle borders                       |

The teal `#0f766e` from the current page is retired from public surfaces (it remains the workspace-icon brand color in-product, no change there).

### Typography

- **Serif heading** (new) — Crimson Pro at weight 500 via `next/font/google` with `display: 'swap'` and a CSS variable. Used for h1/h2/h3 with `letter-spacing: -0.02em` and `line-height: 1.02–1.15`. Italic spans use `<em>` with `color: var(--orange)`. (Source Serif 4 is an acceptable substitute if Crimson Pro renders poorly at 56px — the implementation plan will run a quick A/B before locking it in.)
- **Sans body** — system stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`). No new font for body.
- **Mono eyebrow** — existing `var(--font-geist-mono)`. Used for section eyebrows, monospaced numbers in market-fit, form labels, footer section headings.
- Hero h1 56px, section h2 44px, card h6 20–22px, body 14–17px depending on context.

### Motif: origami

Geometric shapes (rhombus, triangle, dark circle) in Claude-orange gradients are the recurring decorative element. They appear in: the hero (around the workspace preview), the "Особое решение" illustration, the final CTA, and the featured pricing column (small ornament on the popular plan). Implemented as `clip-path: polygon(...)` on absolutely-positioned `<Box>` elements with linear-gradient backgrounds. Aria-hidden.

### Motion

Three keyframes, each ≤300ms or ≤6s for ambient float, all respect `prefers-reduced-motion`:

- `heroIn` — 520ms ease-out fade-up on hero text on mount.
- `surfaceFloat` — 6s sine-wave Y translate on the workspace preview card.
- `scan` — 2.8–3.4s left-to-right gradient sweep on AI-related surfaces (workspace preview AI panel, ИИ-поиск answer card).

Section hover micro-motions (market-fit row shifts 12px right; mode card brightens) are CSS transitions ≤200ms.

## Page structure

Order matches the home page top-to-bottom. Section IDs are anchor names for the header nav.

```
1. Hero                  (section.hero, paper gradient)
2. Market-fit            (#why, paper)
3. Workspace modes       (#modes, white card on paper)
4. ИИ-поиск              (#search, paper)
5. Что ещё               (#features, paper)
6. Тарифы                (#pricing, dark)
7. Особое решение        (#contact, white)
8. Final CTA             (paper gradient)
9. Footer                (dark)
```

## Section specs

### 1. Hero

Two-column grid, 1fr / 1.15fr at ≥980px, single-column below.

- **Left column**: pill ("Любые заметки · ИИ-пространство") → serif h1 ("Рабочая память команды _с ИИ-поиском_") with italic orange `<em>` on "с ИИ-поиском" → body lede → primary CTA "Начать бесплатно" (signed-in users see "Открыть рабочее пространство" as today) and secondary "Смотреть тарифы" (hidden when signed in) → trust row (3 dot-prefixed lines: "Без банковской карты", "Публичные ссылки", "ИИ по вашим данным").
- **Right column**: "stage" — three origami shapes (rhombus top-left, triangle bottom-right, dark circle bottom-left) absolutely positioned around a workspace preview card.
- **Workspace preview card**: realistic mirror of `/workspaces/{id}`:
  - Browser chrome bar with three LEDs and URL `любые-заметки.app / workspaces / база-знаний`.
  - Sidebar (168px): workspace icon (gradient teal box, 📒) + name "База знаний" + plan chip "Бесплатный". Below: "Поиск и чаты" row, "Настройки" row, "Избранное" section with one item (⭐ Roadmap 2026), "Страницы" tree section with items (📝 Заметки встреч, 📄 Стратегия 2026 expanded → 🎯 Q2 цели _active_ + 📊 Метрики, 🎨 Архитектура, 🌳 Команда). Footer: "Корзина".
  - Main: toolbar with breadcrumbs "База знаний / Стратегия 2026 / Q2 цели" → page-icon emoji 🎯 in orange-tint square → serif h5 "Q2 цели" → seven editor lines + one h3 mock.
  - AI panel pinned bottom-right of main: dark card with question "Что мы обещали в марте?", short answer, two source items (📄 Стратегия 2026, 📝 Заметка встречи 18.03). Carries the `scan` animation.
- The misleading "контекст найден в N источниках" badge from the current page is removed; sources now live inside the AI panel.

### 2. Market-fit ("Почему это важно")

Editorial three-row table on paper. Eyebrow → serif h2 ("Команда покупает не хранилище — _а быстрый доступ к контексту_") → lede → three rows.

Each row: 3-column grid `200px 0.85fr 1fr`, baseline-aligned, 32px vertical padding, hairline border-bottom. Row hover shifts content `padding-left: 12px` over 250ms.

- Row 1: mono "10 секунд" / serif title "Понятно, что делает продукт" / body
- Row 2: mono "1 ссылка" / "Меньше трения для клиента" / body
- Row 3: mono "0 карт" / "Старт без лишних барьеров" / body

Mobile: collapses to single column with 8px gap, padding-shift disabled.

### 3. Workspace modes (4 modes)

White card on paper, `1fr 1fr` modes-head/grid layout at ≥980px.

Left column: eyebrow "РАБОЧЕЕ ПРОСТРАНСТВО", serif h2 "Один продукт — _четыре режима работы_", lede.

Right column: 2×2 card grid (single column on mobile). Each card: 38×38 orange-tinted icon box with emoji → serif h6 → body → mini-illustration in 100px-tall paper-tinted box.

Mode mini-illustrations (each is a CSS-only sketch, no images):

- **Документы** (📄): four light bars, top one inked + 50% width to hint at heading + body
- **Схемы и холсты** (🎨): three shapes (dark circle, orange triangle, warm-orange rotated square) over a horizontal hairline (suggests connections)
- **ИИ-чаты** (💬): two chat bubbles — dark "me" bubble right-aligned, orange-tinted AI bubble left-aligned with `✦` glyph
- **Публичные ссылки** (🔗): dashed-border URL box `любые-заметки.app/share/abc123` with the path in orange + a mini doc preview row (avatar + two lines)

Hover: card background `#fff → var(--paper)`.

### 4. ИИ-поиск

Two-column `0.9fr 1.1fr` on paper.

- **Left**: eyebrow "ИИ-ПОИСК" → h2 "Ответ должен приходить из ваших документов — _не из догадок_" → lede → 4-step list. Each step is `[28px circle with mono number]  text`. Steps:
  1. Загрузите документы, заметки и вложения команды
  2. Разложите их по рабочим пространствам и страницам
  3. Задайте вопрос обычными словами
  4. Получите ответ со ссылками на исходные материалы
- **Right**: answer card. Dark question header (with `✦` spark icon and scan animation) → body with serif-typeset answer (`<span class="typed">25 апреля</span>` carries a `border-right: 2px solid var(--orange)` to mimic a streaming cursor) → divider → mono "Источники" label → three source rows (document emoji, name, mono "N цитат"). Source rows hover-tint to `--paper-deep`.

### 5. Что ещё

New section. Paper background, eyebrow "ВОЗМОЖНОСТИ", serif h2 "Что ещё _стоит знать_", lede.

3-column × 2-row grid below at ≥880px (2 cols at 560–880, 1 col below). Each card is column-stack: emoji 22px → serif h6 (20px) → body 14px (max 320px wide). No card border, no background — just typography and rhythm; emulates the reference screenshot but with our typeface and copy.

Six items:

| Icon | Title                          | Body                                                                                                     |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| ⚡   | Мгновенный редактор            | Документы и холсты открываются за доли секунды — Tiptap + кеш страниц вместо ожидания загрузки.          |
| 🤝   | Несколько курсоров на странице | Команда редактирует одну страницу одновременно — без конфликтов и пересохранений.                        |
| 🌗   | Светлая и тёмная тема          | Интерфейс адаптируется под систему или переключается вручную — глаза не устают в любое время.            |
| 🔐   | Гранулярные права              | Чтение или запись для участников, групп и гостей — каждому даёте ровно столько доступа, сколько нужно.   |
| 🔗   | Публичные ссылки               | Откройте страницу одной ссылкой — без регистрации для читателя и без рассылок «вот файл в почту».        |
| 🛡️   | Без санкционных рисков         | Российский хостинг и self-hosted-сборка — продукт работает в любой ситуации, ваши данные остаются у вас. |

Copy is _paraphrased_ from the reference screenshot, not copied — titles and bodies all rewritten.

### 6. Тарифы

Dark Claude section (`#1d1d1b`). `0.7fr 1.3fr` head/grid layout.

Left: eyebrow "ТАРИФЫ", h2 "Начните бесплатно — _расширяйте по мере роста_", outline button "Сравнить планы" → `/pricing`.

Right: 4-column pricing grid in 2×2 on tablet, 1col on mobile, with hairline borders top + left so each cell becomes a clean grid cell.

Each plan column (data from `landingPricingCards`):

- Head row: serif h6 plan name, optional mono badge "популярный" (only on `pro`).
- Price line in serif 28px. Persональный free price is in `--orange-warm` to make zero-cost visually distinct.
- Features list with `+` bullets (mono, orange-warm).
- Bottom row: "Подробнее →" linking to `/pricing`.
- The featured (`pro`) column has a small origami rhombus accent (32px, top:-16px right:18px, rotated 8deg) — visually hooks the plan to the brand motif.
- Hover lifts background opacity from baseline.

Plan list (locked):

1. Персональный — Бесплатно — 1 пространство, базовый редактор
2. ПРО — от 150 ₽/мес — 3 пространства, до 5 участников, **Чаты с ИИ**, индексация _(rename "AI" → "ИИ" in `content.ts`)_
3. МАКС — от 1500 ₽/мес — ∞ пространств, до 100, все модели GigaChat, MCP-серверы
4. Своя инфраструктура — Связаться — Self-hosted, SLA, индивидуальные интеграции

### 7. Особое решение (new)

White section, `1fr 1.1fr` two-column at ≥980px.

- **Left**: eyebrow "ОСОБОЕ РЕШЕНИЕ", h2 "Нужна _нестандартная конфигурация?_", lede explaining on-prem / SSO / custom plans, plus an origami illustration block (rhombus + triangle + dark circle) with a small white quote card overlapping the bottom-right ("Среднее время ответа — связались в тот же день и собрали стенд за неделю").
- **Right**: form card on white with `0 24px 48px rgba(0,0,0,0.06)` shadow.
  - Row 1: Имя / Компания
  - Row 2: Телефон / E-mail
  - Single field: textarea "Что нужно" (placeholder: "On-prem на 200 пользователей, интеграция с Bitrix24, SSO через Keycloak…")
  - Submit row: 280-wide hint text ("Нажимая, вы соглашаетесь с обработкой персональных данных по политике конфиденциальности.") on the left, "Отправить запрос →" button on the right.
  - Field labels in mono uppercase (12px). Inputs paper-bg with orange focus ring (`box-shadow: 0 0 0 3px rgba(201,100,66,0.14)`).

Implementation: build on top of the existing `<ContactForm>` by extending its state to add `company` and `message` fields and reusing it on the home page section. The original contact-page usage should keep working — extend the form props rather than fork the component.

### 8. Final CTA

Paper-gradient section (same gradient as hero) with two large origami decor pieces:

- Big rhombus (260×260, orange gradient, right edge bleeding `-60px`, vertically centered).
- Dark circle (80×80, bottom-left corner).

Content `1fr auto` grid at ≥880px: serif h3 "Перенесите рабочие знания туда, _где их можно найти_" + body lede on the left, large "Начать бесплатно →" button right-aligned. Mobile: stacked, button full-width.

Primary CTA href flips to `/app` for signed-in users (matching current `primaryHref` logic).

### 9. Footer (redesigned)

Dark Claude section, replaces the entire body of [apps/web/src/components/public/public-footer.tsx](apps/web/src/components/public/public-footer.tsx). Same component, repainted internals.

Top grid: `1.4fr 1fr 1fr 1fr` at ≥980px (2 cols at ≤980, 1 col at ≤560).

- **Brand column**: small origami rhombus mark + serif "Любые заметки" wordmark → tagline → two mono pill badges ("RU · 2026", "ИИ-поиск").
- **Продукт**: Возможности → `#features`, Тарифы → `/pricing`, Roadmap → `/roadmap`, Документация → `/docs`.
- **Компания**: О нас → `/about` (or `/`), Контакты → `/contact`, Оферта → `/oferta`, Политика → `/privacy`. Existing routes from `apps/web/src/app/(about)/` are reused; no new routes are created.
- **Связаться**: ✉ email, 📞 phone, ✈ Telegram. Phone and email values are sourced from a new `publicContact` constant in `content.ts`. Telegram link is optional — if the value is an empty string, the row is not rendered.

Bottom row (1px hairline above): copyright "© 2026 «Любые заметки». Все права защищены." left, three legal links right (Политика / Оферта / Cookies).

Subtle radial-gradient warm tint at top-right (`rgba(217,119,87,0.16)` → transparent) as decor.

`publicFooterSections` in `content.ts` will be restructured to match the four-column model. The existing `BrandMark` import and `Container`/`Paper` styling come out.

## Rebrand pass

Single search-and-replace pass over public surfaces:

- `AnyNote` → `Любые заметки` in: page metadata, header, footer, contact page, pricing page, roadmap page, docs page, about/oferta/terms/privacy bodies, the registration page, and email-template subjects in `packages/mail/src/templates/*` (templates only — no new mail flow).
- `AI-` and ` AI` → `ИИ-` / ` ИИ` in user-facing strings only. Code identifiers (`aiSettings`, `AiModel`, `AiProvider`, etc.) stay — they are internal API surfaces.
- The browser tab title for the home page becomes "Любые заметки — рабочая память команды".

The in-product workspace UI (`/app`, `/workspaces/*`, settings panes) is **not** touched in this pass. Settings labels like "Чаты с AI" inside `apps/web/src/components/workspace/settings/ai-section.tsx` are out of scope.

Public-page text that contains the old name in copy bodies (not just navigation/branding) is rewritten to fit naturally — e.g., "AnyNote отвечает по вашим материалам" → "«Любые заметки» отвечает по вашим материалам" (with the quoted-product-name convention used in Russian copy).

## Component organization

Today the home page is one 908-line file. The redesign splits it into eight in-page section components plus shared primitives. The footer (section 9) lives in the existing `public-footer.tsx` — repainted, not relocated.

```
apps/web/src/components/public/home/
   home-hero.tsx            (section 1)
   home-market-fit.tsx      (section 2)
   home-modes.tsx           (section 3)
   home-search.tsx          (section 4)
   home-features.tsx        (section 5 — Что ещё, new)
   home-pricing.tsx         (section 6)
   home-contact.tsx         (section 7 — Особое решение, new)
   home-final-cta.tsx       (section 8)
   home-tokens.ts           (palette + typography + motion CSS-in-TS, shared)
   origami.tsx              (rhombus / triangle / circle primitive)
```

The footer redesign edits [apps/web/src/components/public/public-footer.tsx](apps/web/src/components/public/public-footer.tsx) in place.

`apps/web/src/app/page.tsx` becomes a thin composer that imports the eight in-page sections, fetches the session, and renders them in order — target ~80 lines.

The `origami.tsx` primitive accepts `size`, `variant` (`rhombus | triangle | circle`), `gradient`, and `position` props so each section uses it without copy-paste clip-path strings.

Each section is a Server Component except `home-contact` (form is interactive, has `"use client"`).

Reasons for the split:

- The 908-line file is hard to scan and AI-edit; per-section files allow surgical changes.
- Section components become discoverable for future iteration / A-B tests.
- It keeps the rebrand diff readable — the section structure is committed first, then each file repainted.

## Data flow

No new data sources. All copy lives in TypeScript:

- Pricing: existing `landingPricingCards` in `content.ts` (only `pro.features` array gets one string updated: "Чаты с AI" → "Чаты с ИИ").
- Footer columns: a restructured `publicFooterSections` constant in `content.ts` (replace existing).
- New constant `publicContact = { email, phone, telegram }` in `content.ts` for the footer "Связаться" column and the contact page header.
- New constant `homeFeatures` in `content.ts` for the six "Что ещё" entries (icon string, title, body).

The contact form posts to `console.log` (matching the existing component) and shows the existing `<Alert severity="success">` feedback. Server submission is a follow-up.

The hero workspace-preview content is hardcoded markup inside `home-hero.tsx` — it's a static screenshot-equivalent, not rendered from real data.

## RSC and "use client" boundaries

- All section files except `home-contact.tsx` are Server Components.
- `home-contact.tsx` is `"use client"` because the form has state.
- The wrapping `apps/web/src/app/page.tsx` stays an `async` Server Component and continues calling `getSession()` to drive the CTA copy/href.
- No `<Button component={Link}>` patterns from a Server Component (existing CLAUDE.md guidance) — the redesign uses `<Button href={...}>` directly, or wraps `<Button>` inside a separate `<Link>` element. This is verified at hand-off by a `pnpm --filter web build` run.

## Testing

- Existing Playwright e2e tests in `apps/e2e/` should continue passing — none currently target the home-page DOM by selectors that would break (none of them match the marketing surface today; spot-checked).
- Add one Playwright e2e: `apps/e2e/home-redesign.spec.ts` that loads `/`, checks the new heading text "Рабочая память команды", asserts the contact form is present, and submits with valid values to confirm the success Alert appears. Reuses no auth helper — public page.
- Visual regression: out of scope (no Chromatic or Percy in repo).
- Type/lint gate: `pnpm gates` must pass after the change.
- Manual cross-section pass on `pnpm dev` at viewport widths 360 / 768 / 1024 / 1440 to confirm the responsive grids degrade as specified.

## Risks and edge cases

- **Web font load shift**: introducing one Google serif font causes a brief FOUT. Mitigation: `next/font` `display: 'swap'` and matching `size-adjust` to system serif; the spec accepts a small CLS at first paint.
- **Origami clip-path on Safari**: `clip-path: polygon(...)` is supported in all modern Safari versions but the gradient + box-shadow combo can flicker on retina. Mitigation: `will-change: transform` on each origami element and a `prefers-reduced-motion` media query that disables the float keyframe.
- **Long Russian words breaking the trust row / mode card titles**: titles are short (≤30 chars) but body copy can wrap awkwardly at 320px. Mitigation: `text-wrap: balance` on titles and body.
- **Plan badge overlap on Тарифы when wrapping**: the "популярный" mono badge can collide with a long plan name. Plan names are bounded by `landingPricingCards` (≤22 chars in Russian). Spec accepts the existing names.
- **Footer Telegram value missing**: gracefully omit the row when value is empty string. Codified in the section spec above.
- **Existing `<ContactForm>` consumers**: the contact page imports it. Extending the form with two new fields (company, message) must keep the existing call-site working — fields default to empty strings, no required-prop change.
- **"AI" inside identifiers vs copy**: a careless replace would break code. The rebrand pass uses string-only replacement scoped to `*.tsx` JSX text nodes, `metadata` literals, and message templates — never identifiers.

## Out of band — not blocking this design

- A future iteration can wire the contact form to the existing mail outbox in `packages/mail` using `enqueueMailEvent`.
- An "ИИ-демо" interactive section that streams a real example through the agents service could replace the static `home-search` answer card later.
- The rebrand of email templates is included; the rebrand of in-product surfaces and admin panels is a separate workstream.
