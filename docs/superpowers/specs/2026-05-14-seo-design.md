# SEO для публичных страниц AnyNote — 2026-05-14

## Контекст

Сайт `apps/web` написан на Next.js 16 (App Router, React 19), целевая аудитория —
русскоязычный B2B-сегмент. Публичные страницы сейчас имеют только базовый
`title`/`description`, без OG, canonical, sitemap, robots.txt, JSON-LD и
верификации в Яндекс.Вебмастер / Google Search Console. Без этого страницы не
ранжируются корректно, превью при репосте выглядят сырыми, поисковики не
получают сигналов о структуре сайта.

Цель — внедрить production-стандарт SEO для двух приоритетных поисковиков
(Яндекс и Google), заложив расширяемый фундамент под будущие marketing-страницы
(блог, features, about).

## Скоуп

### В скоупе

- `robots.txt` через `app/robots.ts` (allowlist для публичных, disallow для
  `(auth)`, `(protected)`, API).
- `sitemap.xml` через `app/sitemap.ts` (главная, `/pricing`, `/terms`,
  `/terms/[document]` с `lastModified` из `version`).
- `metadataBase` + `title.template` в корневом `app/layout.tsx`.
- Фабрика `buildMetadata({...})` в `lib/seo/build-metadata.ts` — единая точка
  для canonical, OG, robots-настроек.
- Динамические OG-картинки 1200×630: дефолтная через корневой
  `opengraph-image.tsx`, per-page для `/pricing` и `/terms/[document]` через
  стабильные route handlers `opengraph-image/route.tsx`.
- Расширенный JSON-LD: `Organization`, `WebSite` (с SearchAction),
  `SoftwareApplication`, `Product`/`Offer` для тарифов, `BreadcrumbList`
  для `/terms/*`. `FAQPage` — файл-заглушка без подключения до появления
  FAQ-секции на лендинге.
- Верификация Я.Вебмастер и Google Search Console через env-переменные
  (`YANDEX_VERIFICATION`, `GOOGLE_SITE_VERIFICATION`).
- Флаг `SEO_NOINDEX_ALL` для staging/preview окружений.
- Unit-тесты (vitest) для `buildMetadata`, `sitemap`, схем JSON-LD и `robots`.
- E2E-тест (playwright) для проверки `<head>` публичных страниц, доступности
  `sitemap.xml`/`robots.txt`, регрессии `noindex` на `(protected)`.

### Вне скоупа

- IndexNow auto-ping и автосабмит sitemap в Я.Вебмастер/GSC через API.
- Lighthouse SEO как gate в CI.
- Турбо-страницы Яндекса.
- Twitter Cards (`twitter-image.tsx`, `twitter:*` мета) — `og:*` достаточен
  для большинства соцсетей.
- Перевод JSON-LD на CMS-driven контент (актуально только после появления блога).
- OG-картинки для страниц под аутентификацией (они `noindex`).

## Архитектура

### Файловая структура

```
apps/web/
├── src/
│   ├── app/
│   │   ├── robots.ts                          [NEW]
│   │   ├── sitemap.ts                         [NEW]
│   │   ├── opengraph-image.tsx                [NEW]  дефолтный OG
│   │   ├── layout.tsx                         [MOD]  metadataBase + verification
│   │   └── (about)/
│   │       ├── page.tsx                       [MOD]  buildMetadata + JsonLd
│   │       ├── pricing/
│   │       │   ├── page.tsx                   [MOD]  buildMetadata + Product schema
│   │       │   └── opengraph-image/route.tsx  [NEW]  per-page OG
│   │       └── terms/
│   │           ├── page.tsx                   [MOD]
│   │           └── [document]/
│   │               ├── page.tsx               [MOD]  buildMetadata + breadcrumbs
│   │               └── opengraph-image/route.tsx [NEW] dynamic OG из params
│   └── lib/
│       └── seo/
│           ├── build-metadata.ts              [NEW]
│           ├── site-config.ts                 [NEW]
│           ├── json-ld.tsx                    [NEW]
│           └── schemas/
│               ├── organization.ts            [NEW]
│               ├── website.ts                 [NEW]
│               ├── software-app.ts            [NEW]
│               ├── product-offers.ts          [NEW]
│               ├── faq.ts                     [NEW]  заглушка
│               └── breadcrumbs.ts             [NEW]
├── test/
│   └── seo/
│       ├── build-metadata.test.ts             [NEW]
│       ├── sitemap.test.ts                    [NEW]
│       ├── robots.test.ts                     [NEW]
│       └── schemas.test.ts                    [NEW]
└── .env.example                               [MOD]

apps/e2e/seo.spec.ts                           [NEW]
turbo.json                                     [MOD]  globalEnv +3 ключа
```

### Изолированные единицы и их интерфейсы

| Модуль | Что делает | Интерфейс | Зависит от |
|---|---|---|---|
| `lib/seo/site-config.ts` | Константы сайта (URL, имя, локаль, контакты) | `siteConfig` (readonly object) | `process.env.NEXT_PUBLIC_BASE_URL` |
| `lib/seo/build-metadata.ts` | Фабрика `Metadata` для страниц | `buildMetadata(input): Metadata` | `siteConfig` |
| `lib/seo/json-ld.tsx` | React-компонент `<JsonLd>` | `<JsonLd data={schema | schema[]} />` | server-only |
| `lib/seo/schemas/*.ts` | Чистые функции, возвращают JSON-LD объект | `<schemaName>(input?): object \| null` | `siteConfig` (для статичных полей) |
| `app/robots.ts` | Генерация robots.txt | Next route convention | `siteConfig`, `SEO_NOINDEX_ALL` |
| `app/sitemap.ts` | Генерация sitemap.xml | Next route convention | `siteConfig`, `legalDocuments` |
| `app/opengraph-image.tsx` | Дефолтный OG PNG 1200×630 | Next file convention | `siteConfig` |
| `app/**/opengraph-image/route.tsx` | Per-page OG PNG 1200×630 | Route handler со стабильным URL | `siteConfig`, `legalDocumentBySlug` |

Schema-функции принимают только то, что не выводится из `siteConfig`
(динамические данные: список тарифов, breadcrumbs). Это позволяет тестировать
каждую без моков `process.env`.

## Поток данных

### Метаданные страницы

```
ENV (NEXT_PUBLIC_BASE_URL, YANDEX_VERIFICATION, GOOGLE_SITE_VERIFICATION)
        │
        ▼
   siteConfig ────────────► layout.tsx (metadataBase, verification, title.template)
        │
        ▼
   buildMetadata({title, path, ...}) ──► page.tsx export const metadata
        │
        ▼
   Next.js собирает <head>: title, description, canonical, OG, robots
```

### JSON-LD

```
page.tsx (RSC)
   │
   ├── вызывает schema-функции с динамическими данными
   │   (например, productOffersSchema(plans))
   │
   └── рендерит <JsonLd data={[...]} /> в JSX
            │
            ▼
       <script type="application/ld+json">{...}</script> в <head>
```

### OG-картинка (edge runtime)

```
GET /opengraph-image
   │
   ▼
opengraph-image.tsx
   │
   ├── Next.js собирает React-компонент
   ├── @vercel/og рендерит SVG → PNG 1200×630
   └── отдаёт image/png

URL картинки попадает в `og:image` из `buildMetadata`. Для вложенных страниц
используются route handlers, чтобы URL оставался стабильным в production build.
```

### Sitemap и robots

```
GET /sitemap.xml ───► sitemap.ts
                       │
                       ├── статичные URL: /, /pricing, /terms
                       └── динамичные: legalDocuments.map(doc => ...)
                                       (lastModified ← new Date(doc.version))

GET /robots.txt ────► robots.ts
                       │
                       ├── SEO_NOINDEX_ALL=true → disallow: ['/']
                       └── иначе → allow: '/', disallow: protected/auth paths
                       └── sitemap link, host directive
```

## Контракты API

### `buildMetadata`

```ts
type BuildMetadataInput = {
  title: string                // <title>, og:title
  description?: string         // дефолт из siteConfig
  path: string                 // абсолютный путь от корня, '/' для главной
  ogImage?: string             // относительный URL, иначе Next подхватывает file convention
  noIndex?: boolean            // true → robots: noindex,nofollow
  keywords?: string[]
}

function buildMetadata(input: BuildMetadataInput): Metadata
```

**Контракт:**
- `path: '/'` → `alternates.canonical = 'https://<host>/'`.
- `path: '/pricing'` → `canonical = 'https://<host>/pricing'`.
- `noIndex: true` → `robots: { index: false, follow: false }`.
- Без `description` → берёт `siteConfig.description`.
- `og.type = 'website'` всегда (для лендингов корректно; для блог-постов
  переопределим вручную через расширение API когда понадобится).

### `<JsonLd>`

```tsx
type JsonLdProps = { data: Record<string, unknown> | Record<string, unknown>[] | null }
```

**Контракт:**
- `data === null` → ничего не рендерится. Schema-функция возвращает null
  если ей нечего описывать (например, `productOffersSchema([])`).
- Массив → рендерится один `<script>` с массивом объектов (Schema.org это
  допускает).
- `</script>` в данных эскейпится через `\\u003c`.

### Schema-функции

Все возвращают `Record<string, unknown> | null`. Например:

```ts
organizationSchema(): Record<string, unknown>
websiteSchema(): Record<string, unknown>
softwareAppSchema(): Record<string, unknown>
productOffersSchema(plans: PlanForSchema[]): Record<string, unknown> | null
breadcrumbsSchema(items: { name: string; url: string }[]): Record<string, unknown>
faqSchema(items: { q: string; a: string }[]): Record<string, unknown> | null  // не используется до появления FAQ
```

`PlanForSchema` — лёгкий DTO `{ name: string; price: number }`, мапим из ответа
tRPC прямо на странице `/pricing` чтобы не тянуть Prisma-типы в `lib/seo/`.

## Переменные окружения

| Имя | Где используется | Дефолт | Обязательность |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | уже существует, используется в `siteConfig` | `http://localhost:3000` | в проде — обязательна |
| `YANDEX_VERIFICATION` | `layout.tsx → metadata.verification.yandex` | undefined | опциональна |
| `GOOGLE_SITE_VERIFICATION` | `layout.tsx → metadata.verification.google` | undefined | опциональна |
| `SEO_NOINDEX_ALL` | `robots.ts` | `false` | для staging/preview |

Все три новые переменные:
- добавляются в `.env.example`;
- добавляются в `turbo.json` `globalEnv` (CLAUDE.md: иначе будут stale builds);
- НЕ имеют префикса `NEXT_PUBLIC_` — рендерятся только на сервере.

## Обработка граничных случаев

| Сценарий | Поведение |
|---|---|
| `NEXT_PUBLIC_BASE_URL` не задан в dev | Fallback `http://localhost:3000`. Sitemap/canonical используют его — OK для dev. |
| `YANDEX_VERIFICATION` пуст | `metadata.verification.yandex = undefined`, тег не рендерится. |
| `GOOGLE_SITE_VERIFICATION` пуст | Аналогично. |
| `SEO_NOINDEX_ALL=true` | `robots.ts` отдаёт `disallow: ['/']` для всех user-agents. Sitemap остаётся доступен (для smoke-тестов). |
| `legalDocuments` пуст | `sitemap.ts` возвращает только статичные URL. Не падает. |
| `productOffersSchema([])` | Возвращает `null`, `<JsonLd>` не рендерит ничего. Schema.org не любит пустой `offers`. |
| OG-генератор валится в runtime | Edge isolation: страница отдаётся без `og:image`, `<head>` не ломается, ошибка идёт в логи (не глотаем). |
| Неизвестный slug в `/terms/[document]/opengraph-image/route.tsx` | Рендерим дефолтный текст «Документ», не сам `params.document` (защита от XSS в OG). |

## Безопасность

- `<JsonLd>` — единственное место с `dangerouslySetInnerHTML`. Защита:
  `JSON.stringify(data).replace(/</g, '\\u003c')`. Предотвращает закрытие
  тега `</script>` через данные.
- В OG-картинках выводится только заранее известный контент (статичные строки,
  `legalDocumentBySlug` lookup). Пользовательский ввод не попадает.
- Verification-токены — серверные env, не утекают в клиент.

## Тестирование

### Unit (vitest, `apps/web/test/seo/`)

**`build-metadata.test.ts`** — таблица входов/выходов:
- `path: '/'` → `alternates.canonical = 'http://localhost:3000/'`.
- `noIndex: true` → `robots.index === false`.
- Без `description` → подставляется `siteConfig.description`.
- `ogImage: '/custom.png'` → попадает в `openGraph.images`.
- `keywords: [...]` → попадает в `metadata.keywords`.

**`sitemap.test.ts`** — мокаем `legalDocuments`:
- Возвращает массив с главной, `/pricing`, `/terms`.
- Для каждого `legalDocument` URL построен корректно и `lastModified ===
  new Date(doc.version)`.
- Пустые `legalDocuments` — sitemap всё равно валиден.

**`robots.test.ts`**:
- `SEO_NOINDEX_ALL` undefined → блокирует `/app/`, `/api/`, auth-пути; allow корня.
- `SEO_NOINDEX_ALL=true` → disallow `/`.
- Sitemap link присутствует всегда.

**`schemas.test.ts`** — snapshot-тесты для каждой схемы:
- `organizationSchema()` содержит `@context`, `@type: 'Organization'`, `name`, `url`.
- `websiteSchema().potentialAction['@type'] === 'SearchAction'`.
- `productOffersSchema(plans)` со вторым параметром — корректный массив `Offer`.
- `productOffersSchema([])` возвращает `null`.
- `breadcrumbsSchema(items)` — позиции `1..N`.

### E2E (playwright, `apps/e2e/seo.spec.ts`)

```ts
test('homepage exposes canonical, OG and JSON-LD', ...)
test('pricing page exposes Product/Offer JSON-LD', ...)
test('legal doc page exposes BreadcrumbList', ...)
test('sitemap.xml is reachable and lists key pages', ...)
test('robots.txt disallows protected paths and links to sitemap', ...)
test('protected route emits noindex (regression)', ...) // через signUpAndAuthAs
```

E2E запускается на `webServer` Playwright (порт 3100), который Playwright уже
поднимает сам — `pnpm dev` не нужен. Только `docker compose up -d`.

### Compile-time

Все schema-объекты типизировать через `schema-dts` (пакет от Google,
types-only, не добавляет рантайма). Если структура схемы расходится со Schema.org —
тест на сборку падает в `pnpm check-types`.

### Ручная валидация (после деплоя, в чек-листе)

- [https://validator.schema.org/](https://validator.schema.org/) — каждая страница.
- [Yandex Webmaster → Проверка ответа сервера](https://webmaster.yandex.ru/tools/server-response/) — robots/sitemap.
- [Google Rich Results Test](https://search.google.com/test/rich-results) — JSON-LD рендерится.
- Telegram / Slack / Discord — расшарить ссылки, убедиться что превью отображается.

## Миграция и порядок работ

Высокоуровневый порядок (детали — в implementation плане):

1. `lib/seo/site-config.ts` + `lib/seo/build-metadata.ts` (+ unit-тесты).
2. `app/layout.tsx` — добавить `metadataBase`, `title.template`, `verification`.
3. Миграция существующих публичных страниц на `buildMetadata`.
4. `app/robots.ts` + `app/sitemap.ts` (+ unit-тесты).
5. `lib/seo/json-ld.tsx` + `lib/seo/schemas/*` (+ unit-тесты).
6. Вставка `<JsonLd>` на главную, `/pricing`, `/terms/[document]`.
7. OG-картинки: дефолтная + `/pricing` + `/terms/[document]`.
8. `.env.example` + `turbo.json` `globalEnv`.
9. E2E-тесты.
10. Полный прогон `pnpm gates`, ручная валидация на превью-окружении.

## Открытые вопросы

- **Юридическое имя организации, email поддержки, соцсети** для `Organization` schema —
  узнаем у юзера перед написанием `site-config.ts`. До этого — placeholder
  значения с TODO-комментариями недопустимы; либо узнаём, либо опускаем поле
  (Schema.org Organization валиден без `legalName`/`email`/`sameAs`).
- **FAQ-секция на главной** — на текущем лендинге её нет; `faq.ts` создаётся
  как файл-заглушка с экспортируемой функцией, но в `<JsonLd>` не вставляется
  до появления контента. Когда FAQ-блок появится — подключение одной строкой.
- **`SearchAction` URL** — `${url}/app/search?q={query}` ведёт в защищённую
  область. Это формально валидно (Google индексирует только схему), но если
  хочется не светить путь — выкидываем `potentialAction` целиком. По умолчанию
  оставляем.
