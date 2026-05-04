# Юридические документы (terms): MDX-страницы, footer, чекбокс при регистрации

**Дата:** 2026-05-04
**Статус:** утверждено пользователем, готово к реализации.

## Цель

Превратить пять `.md`-файлов в `docs/terms/` в публично доступные правовые
страницы, изменить футер и форму регистрации так, чтобы они ссылались на эти
страницы и собирали явное согласие пользователя.

## Источники правды

`docs/terms/`:

| Файл                     | Заголовок                                          |
| ------------------------ | -------------------------------------------------- |
| `UserAgreement.md`       | Пользовательское соглашение                        |
| `PrivacyPolicy.md`       | Политика в отношении обработки персональных данных |
| `ConsentToProcessing.md` | Согласие на обработку персональных данных          |
| `PublicOffer.md`         | Публичная оферта                                   |
| `Information.md`         | Информация о самозанятом                           |

`docs/terms/` остаётся источником правды; `apps/web` импортирует файлы напрямую.

## URL-структура

| URL                     | Источник                 | Заголовок                                 |
| ----------------------- | ------------------------ | ----------------------------------------- |
| `/terms`                | новый index              | Юридические документы (список)            |
| `/terms/user-agreement` | `UserAgreement.md`       | Пользовательское соглашение               |
| `/terms/privacy-policy` | `PrivacyPolicy.md`       | Политика обработки персональных данных    |
| `/terms/consent`        | `ConsentToProcessing.md` | Согласие на обработку персональных данных |
| `/terms/public-offer`   | `PublicOffer.md`         | Публичная оферта                          |
| `/terms/information`    | `Information.md`         | Информация о самозанятом                  |

Страницы живут внутри существующей route-группы `(about)`, чтобы получить
`PublicHeader` / `PublicFooter` / `CookieBanner` и общий стилевой контейнер.

## Удаляемые страницы

Без 301-редиректов (по решению пользователя):

- `apps/web/src/app/(about)/terms/page.tsx` (старый хардкод)
- `apps/web/src/app/(about)/privacy/` (вся папка)
- `apps/web/src/app/(about)/oferta/` (вся папка)
- `apps/web/src/app/(about)/offer/` (вся папка)

## Архитектура MDX-рендера

### Зависимости (apps/web/package.json)

- `@next/mdx`
- `@mdx-js/loader`
- `@mdx-js/react`
- `@types/mdx` (devDependencies)

### next.config.js

Применить `withMDX({ extension: /\.mdx?$/ })` к экспорту. **`pageExtensions`
расширять не нужно** — `.md` импортируются как модули, а не как страницы. Также
добавить webpack-алиас `@docs` → `<repo-root>/docs`, чтобы импорт выглядел как
`import UserAgreement from '@docs/terms/UserAgreement.md'`.

Turbopack в dev-режиме обрабатывает `withMDX` нативно; `next build --webpack`
использует тот же loader через `withMDX`.

### tsconfig.json

В `apps/web/tsconfig.json` добавить путь:

```json
"paths": {
  "@/*":      ["./src/*"],
  "@docs/*":  ["../../docs/*"]
}
```

Плюс импорт типов `@types/mdx` через `tsconfig` (он автоматически подхватится
из `node_modules/@types`).

### mdx-components.tsx

Файл `apps/web/mdx-components.tsx` (на корне `apps/web`) маппит markdown-узлы
на MUI-компоненты `@repo/ui/components`:

| Markdown        | Компонент / стиль                                                |
| --------------- | ---------------------------------------------------------------- |
| `h1`            | `Typography variant="h3"`                                        |
| `h2`            | `Typography variant="h4"` с `mt: 4`                              |
| `h3`            | `Typography variant="h5"` с `mt: 3`                              |
| `p`             | `Typography variant="body1" color="text.secondary"`              |
| `ul`/`ol`       | MUI `List` / нативный `<ul>` со стилем; `li` с `Typography`      |
| `a`             | `Link` (next/link), цвет `primary.main`                          |
| `table`         | MUI `Table` + `TableContainer Paper` + `TableHead` / `TableBody` |
| `tr`/`th`/`td`  | MUI `TableRow` / `TableCell`                                     |
| `hr`            | MUI `Divider`                                                    |
| `strong`/`em`   | нативные с `Typography component`                                |
| `code` (inline) | `Box component="code"` с моно-шрифтом                            |
| `pre`           | `Paper` с моно-шрифтом и `overflow: auto`                        |

Цель: документы выглядят как набор статей `PublicPageShell` без отдельной
TSX-стилизации каждого пункта.

### Динамическая страница

`apps/web/src/app/(about)/terms/[document]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import UserAgreement from '@docs/terms/UserAgreement.md'
import PrivacyPolicy from '@docs/terms/PrivacyPolicy.md'
import Consent from '@docs/terms/ConsentToProcessing.md'
import PublicOffer from '@docs/terms/PublicOffer.md'
import Information from '@docs/terms/Information.md'

import { PublicPageShell } from '@/components/public/public-page-shell'

const documents = {
  'user-agreement': {
    title: 'Пользовательское соглашение',
    eyebrow: 'Terms',
    Component: UserAgreement,
  },
  'privacy-policy': {
    title: 'Политика обработки персональных данных',
    eyebrow: 'Privacy',
    Component: PrivacyPolicy,
  },
  consent: {
    title: 'Согласие на обработку персональных данных',
    eyebrow: 'Consent',
    Component: Consent,
  },
  'public-offer': { title: 'Публичная оферта', eyebrow: 'Offer', Component: PublicOffer },
  information: { title: 'Информация о самозанятом', eyebrow: 'Info', Component: Information },
} as const

export function generateStaticParams() {
  return Object.keys(documents).map((document) => ({ document }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>
}): Promise<Metadata> {
  const { document } = await params
  const entry = documents[document as keyof typeof documents]
  return { title: entry?.title ?? 'Документ' }
}

export default async function Page({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params
  const entry = documents[document as keyof typeof documents]
  if (!entry) notFound()
  const { Component, title, eyebrow } = entry
  return (
    <PublicPageShell eyebrow={eyebrow} title={title} description="">
      <Component />
    </PublicPageShell>
  )
}
```

`description` для shell оставляется пустой строкой; визуально подзаголовок
отсутствует, чтобы не вступать в противоречие с содержимым `.md`.

### Index-страница `/terms`

`apps/web/src/app/(about)/terms/page.tsx` — статический список карточек со
ссылками на пять документов. Источник списка — единый константный массив
`legalDocuments` в `apps/web/src/lib/legal-documents.ts`, который также
используется футером и формой регистрации (см. ниже).

## Footer

### content.ts

Добавить третью секцию `publicFooterSections`:

```ts
{
  title: 'Юридические документы',
  links: [
    { label: 'Пользовательское соглашение',                    href: '/terms/user-agreement' },
    { label: 'Политика обработки персональных данных',          href: '/terms/privacy-policy' },
    { label: 'Согласие на обработку персональных данных',       href: '/terms/consent' },
    { label: 'Публичная оферта',                                href: '/terms/public-offer' },
    { label: 'Информация о самозанятом',                        href: '/terms/information' },
  ],
}
```

В существующей секции «Компания» убрать `Оферта` и `Политика` (они уехали в
новую секцию). Если в результате секция «Компания» содержит только `Контакты`,
оставить только её.

### public-footer.tsx

В нижней строке `Политика | Оферта` заменить ссылки:

- `Политика` → `/terms/privacy-policy`
- `Оферта` → `/terms/public-offer`

Layout с четырьмя колонками `1.4fr 1fr 1fr 1fr` сохраняется и продолжает
вмещать новую секцию.

## Регистрация

### packages/ui/src/widgets/auth/register-form.tsx

API виджета расширяется опциональным пропом `termsUrls`:

```ts
type RegisterFormProps = {
  defaultValues?: Partial<RegisterFormValues>
  onSubmit?: (values: RegisterSubmitPayload) => Promise<void>
  signInHref?: string
  isSubmitting?: boolean
  termsUrls?: {
    userAgreement: string
    privacyPolicy: string
    publicOffer: string
  }
}
```

Если `termsUrls` передан, форма рендерит `Checkbox` над кнопкой
«Зарегистрироваться» с лейблом:

> Я принимаю **пользовательское соглашение**, **политику обработки персональных данных** и **оферту на оказание услуг**

Каждое жирное вхождение — `<a target="_blank" rel="noopener noreferrer">` со
`color="primary.main"`. Чекбокс required, состояние хранится в `react-hook-form`
как `agreedToTerms: boolean` (валидация: `required: 'Подтвердите согласие'`).
Submit не вызывается, пока не отмечено. Если `termsUrls` не передан, чекбокс
не рендерится — текущие e2e и storybook продолжают работать без изменений.

`RegisterSubmitPayload` остаётся прежним — поле `agreedToTerms` не уходит на
сервер. Согласие — UX-уровень; backend better-auth уже хранит факт регистрации.

### apps/web/src/app/(auth)/sign-up/sign-up-form.tsx

Передать в `<RegisterForm>` пропс:

```ts
termsUrls={{
  userAgreement: '/terms/user-agreement',
  privacyPolicy: '/terms/privacy-policy',
  publicOffer:   '/terms/public-offer',
}}
```

## Прочие точки замены ссылок

Поиск по `apps/web/src` и `packages/`:

| Файл                                                 | Старая ссылка                         | Новая ссылка                                   |
| ---------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| `apps/web/src/components/public/cookie-banner.tsx`   | `/privacy`                            | `/terms/privacy-policy`                        |
| `apps/web/src/components/billing/checkout-modal.tsx` | `/oferta`                             | `/terms/public-offer`                          |
| `apps/web/src/components/public/content.ts`          | `/oferta`, `/privacy` (footer)        | новая секция (см. выше)                        |
| `apps/web/src/components/public/public-footer.tsx`   | `/privacy`, `/oferta` (нижняя строка) | `/terms/privacy-policy`, `/terms/public-offer` |

## Тестирование

### Что считается «проходом»

1. Команды на корне репо:
   - `pnpm lint`
   - `pnpm format`
   - `pnpm check-types`
2. Playwright e2e — регрессии загрузки картинок и файлов:
   - `pnpm exec playwright test apps/e2e/files.spec.ts`
   - `pnpm exec playwright test apps/e2e/editor-slash-media.spec.ts`
3. Ручная проверка через `pnpm --filter web dev`:
   - `/terms` рендерит index-список;
   - все 5 документов открываются и рендерятся корректно (заголовки, таблицы,
     списки);
   - регистрация: кнопка disabled пока не отмечен чекбокс;
   - футер отображает раздел «Юридические документы».

### Известные ограничения

- E2E-помощник `signUpAndAuthAs` (apps/e2e/helpers/auth.ts) использует тот же
  виджет `RegisterForm`. После добавления чекбокса нужно либо отметить чекбокс
  в helper-flow, либо помощник продолжит работать (если `termsUrls` не
  передан, чекбокса нет; но тестируется реальный sign-up на dev-сервере, где
  `termsUrls` пробрасывается). **Helper нужно обновить** — отмечать чекбокс
  по `data-testid` или label-тексту перед submit.

## Критерии приёмки

- [ ] Все 5 документов доступны по адресам из таблицы выше.
- [ ] `/privacy`, `/oferta`, `/offer` возвращают 404.
- [ ] В footer есть секция «Юридические документы» со всеми 5 ссылками.
- [ ] На странице регистрации есть чекбокс согласия с тремя кликабельными
      ссылками; submit заблокирован, пока чекбокс не отмечен.
- [ ] `pnpm lint`, `pnpm format`, `pnpm check-types` — проходят.
- [ ] Playwright тесты `files.spec.ts` и `editor-slash-media.spec.ts` —
      проходят (золотой путь по загрузке файлов и медиа не сломан).

## Out of scope

- Версионирование документов (storage в БД).
- Хранение факта согласия в базе пользователя.
- Локализация документов (только русский).
- Печать / PDF-выгрузка документов.
- Автоматическая синхронизация `docs/terms/` в Git с уведомлением пользователей.
