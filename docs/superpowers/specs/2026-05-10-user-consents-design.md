# Юридическая фиксация согласий пользователей (user consents)

**Дата:** 2026-05-10
**Статус:** утверждено пользователем, готово к реализации.

## Цель

Сделать юридически фиксируемое хранение пользовательских согласий по 152-ФЗ
«О персональных данных» и ФЗ-38 «О рекламе»: при регистрации (как через email,
так и через OAuth) пользователь принимает обязательные документы и опционально
маркетинговые рассылки; в `/settings` появляется раздел просмотра/управления
согласиями; уже существующие пользователи без согласий блокируются на
`/onboarding/consents` до их принятия.

## Документы, попадающие в систему

Из `apps/web/src/lib/legal-documents.ts` и `apps/web/docs/terms/`:

| `ConsentDocumentType` | Слаг                | Файл                     | Заголовок                                 | Обязательность |
| --------------------- | ------------------- | ------------------------ | ----------------------------------------- | -------------- |
| `USER_AGREEMENT`      | `user-agreement`    | `UserAgreement.md`       | Пользовательское соглашение               | Обязательно    |
| `PRIVACY_POLICY`      | `privacy-policy`    | `PrivacyPolicy.md`       | Политика обработки персональных данных    | Обязательно    |
| `PII_PROCESSING`      | `consent`           | `ConsentToProcessing.md` | Согласие на обработку персональных данных | Обязательно    |
| `MARKETING`           | `marketing-consent` | `MarketingConsent.md`    | Согласие на получение рекламных рассылок  | Опционально    |
| `PUBLIC_OFFER`        | `public-offer`      | `PublicOffer.md`         | Оферта на оказание услуг                  | Обязательно    |

`information` (страница самозанятого) в систему consents не входит — это
информационная страница, не подлежащая принятию.

`MarketingConsent.md` создаётся в рамках этой работы с финальным текстом
(без DRAFT-пометки) по требованиям ФЗ-38 ст. 18:

- Кто оператор (берётся из `Information.md`).
- Какие виды рассылок: рекламные, информационные, сервисные.
- Каналы: e-mail.
- Срок действия: до отзыва.
- Способ отзыва: переключатель в `/settings/consents` или письменное обращение.

## Модель данных

### Prisma schema (`packages/db/prisma/schema.prisma`)

```prisma
enum ConsentDocumentType {
  USER_AGREEMENT
  PRIVACY_POLICY
  PII_PROCESSING
  MARKETING
  PUBLIC_OFFER
}

enum ConsentSource {
  SIGN_UP
  ONBOARDING
  SETTINGS
}

model UserConsent {
  id              String              @id @default(uuid(7))
  userId          String              @map("user_id")
  documentType    ConsentDocumentType @map("document_type")
  granted         Boolean
  documentVersion String              @map("document_version")
  source          ConsentSource
  ipAddress       String?             @map("ip_address")
  userAgent       String?             @map("user_agent")
  createdAt       DateTime            @default(now()) @map("created_at")

  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, documentType, createdAt(sort: Desc)])
  @@map("user_consents")
}
```

В `User` добавляется обратное отношение:

```prisma
consents UserConsent[]
```

### Свойства

- **Immutable**: `INSERT-only`, без `updatedAt`. Каждое действие (принятие,
  отказ, повторный opt-in) — новая строка.
- Текущее состояние согласия = последняя строка по
  `(userId, documentType)` сортировке `createdAt DESC`.
- `documentVersion` хранит версию документа на момент согласия. Версия
  вычисляется как `sha256(file.contents)` при старте Next.js (модульный
  кэш) и пересчитывается при следующем cold-start. Сравнение версий —
  out-of-scope: фиксируем «что подписал», но не инвалидируем при
  изменении документа.
- `ipAddress` берётся из `x-forwarded-for` (первый сегмент) с fallback
  на `x-real-ip`. Может быть `null` если ни один заголовок не пришёл.
- `userAgent` усекается до 1024 символов перед записью.

### Миграция

Один Prisma migration: `pnpm --filter @repo/db exec prisma migrate dev --name add_user_consents`.
Создаёт два enum (`ConsentDocumentType`, `ConsentSource`), таблицу
`user_consents`, индекс. Без data-миграции — существующие пользователи
обрабатываются через middleware-редирект на `/onboarding/consents`.

## Реестр документов

### `apps/web/src/lib/legal-documents.ts`

Расширение существующего реестра. К каждому документу добавляются поля:

```typescript
export type LegalDocument = {
  slug: LegalDocumentSlug
  title: string
  file: string
  consentType: ConsentDocumentType | null // null → не входит в consents (information)
  required: boolean // marketing → false; information → false
}
```

Хелпер `getLegalDocumentByConsentType(type)` для обратного маппинга.

### Версионирование

Новый файл `apps/web/src/lib/legal-document-versions.ts`:

```typescript
export const getDocumentVersion = (slug: LegalDocumentSlug): string => {
  // sha256 хэш .md файла, кэширован модульным scope
}
```

Использует синхронное чтение `fs.readFileSync` + `crypto.createHash` при
первом вызове. Кэш не инвалидируется в процессе работы Node — обновление
текста документа требует перезапуска сервера. Это приемлемо: документы
меняются редко и через PR.

## Серверная логика

### Хелперы (`packages/trpc/src/lib/consents.ts`)

```typescript
export type CurrentConsent = {
  documentType: ConsentDocumentType
  granted: boolean
  grantedAt: Date
  documentVersion: string
}

export const getCurrentConsents = async (
  prisma: PrismaClient,
  userId: string,
): Promise<CurrentConsent[]>
// Возвращает по одной актуальной записи на каждый documentType
// (DISTINCT ON по userId+documentType, ORDER BY createdAt DESC).

export const hasAllRequiredConsents = (consents: CurrentConsent[]): boolean
// true только если все 4 обязательных типа имеют granted=true.

export const writeConsentBatch = async (
  prisma: PrismaClient,
  args: {
    userId: string
    marketing: boolean
    source: ConsentSource
    ipAddress: string | null
    userAgent: string | null
  },
): Promise<void>
// Идемпотентно: если все 5 строк уже соответствуют запрашиваемому состоянию
// (по последним записям), ничего не пишет. Иначе пишет 5 строк одной транзакцией:
// 4 обязательных granted=true + marketing=input.marketing.

export const writeMarketingToggle = async (
  prisma: PrismaClient,
  args: {
    userId: string
    granted: boolean
    ipAddress: string | null
    userAgent: string | null
  },
): Promise<void>
// Пишет одну строку MARKETING с указанным granted. Дедуп по последнему состоянию:
// если последний MARKETING уже granted=input.granted, ничего не пишет.

export const extractIpAddress = (headers: Headers): string | null
export const extractUserAgent = (headers: Headers): string | null
```

### tRPC router (`packages/trpc/src/routers/consent.ts`)

```typescript
export const consentRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Возвращает [{ slug, title, url, granted, grantedAt, required, documentType }]
    // для всех 5 documentType. Если по типу нет записи — granted=false, grantedAt=null.
  }),

  setMarketing: protectedProcedure
    .input(z.object({ granted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await writeMarketingToggle(ctx.prisma, {
        userId: ctx.user.id,
        granted: input.granted,
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })
      return { success: true }
    }),

  acceptRequired: protectedProcedure
    .input(z.object({ marketing: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await writeConsentBatch(ctx.prisma, {
        userId: ctx.user.id,
        marketing: input.marketing,
        source: 'ONBOARDING',
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })
      return { success: true }
    }),
})
```

Регистрируется в `packages/trpc/src/index.ts` как `consent: consentRouter`.

### tRPC router для регистрации (`packages/trpc/src/routers/auth.ts`, новый)

```typescript
export const authRouter = router({
  signUp: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        marketing: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { marketing, ...rest } = input
      const fullName = `${rest.lastName} ${rest.firstName}`

      // Передаём captcha header дальше через ctx.headers — better-auth captcha
      // plugin читает x-captcha-response из request headers.
      const result = await auth.api.signUpEmail({
        body: {
          email: rest.email,
          password: rest.password,
          name: fullName,
          firstName: rest.firstName,
          lastName: rest.lastName,
          callbackURL: '/verify-email?status=success',
        },
        headers: ctx.headers,
        asResponse: false,
      })

      await writeConsentBatch(ctx.prisma, {
        userId: result.user.id,
        marketing,
        source: 'SIGN_UP',
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })

      return { success: true }
    }),
})
```

Регистрируется в `packages/trpc/src/index.ts` как `auth: authRouter`.

**Обработка ошибок**: если `auth.api.signUpEmail` бросает (дубликат email,
captcha fail и т.д.) — consent не пишется, ошибка пробрасывается tRPC-клиенту
как обычно. Если consent-запись падает после успешного создания пользователя
(БД-ошибка) — ошибка тоже пробрасывается; пользователь создан, но consents
нет → при следующем входе middleware отправит на `/onboarding/consents`.
Это корректно: код естественно fault-tolerant.

## Гейт в protected layout

`apps/web/src/app/(protected)/layout.tsx` обновляется:

```typescript
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/get-session'
import { prisma } from '@repo/db'
import { getCurrentConsents, hasAllRequiredConsents } from '@repo/trpc/lib/consents'

export default async function ProtectedLayout({ children }) {
  const session = await requireSession()
  const consents = await getCurrentConsents(prisma, session.user.id)
  if (!hasAllRequiredConsents(consents)) {
    redirect('/onboarding/consents')
  }
  return <TRPCReactProvider>...</TRPCReactProvider>
}
```

`getCurrentConsents` оборачивается в React `cache()` чтобы один RSC-рендер
не делал дублирующих запросов (если хелпер вызывается ещё где-то).

## Onboarding-флоу

### Route group

Новая route-группа `apps/web/src/app/(onboarding)/`:

```
(onboarding)/
  layout.tsx               — requireSession() + редирект на /profile если consents уже есть
  consents/
    page.tsx               — RSC, отдаёт <ConsentsOnboardingForm />
    consents-form.tsx      — client component
```

`(onboarding)/layout.tsx` НЕ оборачивает в `TRPCReactProvider` глобально —
форма импортирует свой минимальный обёрточный провайдер (или используется
прямой fetch к tRPC через `httpBatchLink`). Чтобы не плодить инфраструктуру,
проще обернуть `(onboarding)` в `<TRPCReactProvider>` тоже — он не делает
ничего тяжёлого, и форма уже подключена к tRPC.

### `consents-form.tsx`

UI идентичен sign-up чекбоксам (через общий компонент `<ConsentsCheckboxes>`,
см. ниже):

- Заголовок: «Завершите регистрацию».
- Подзаголовок: «Для использования сервиса требуется принятие следующих документов».
- 1 обязательный чекбокс (4 ссылки в одной фразе).
- 1 опциональный чекбокс (ссылка на marketing-consent).
- Кнопка «Принять и продолжить» → `trpc.consent.acceptRequired.mutate({marketing})`.
- После успеха: `router.push('/profile')`.

`?next=` параметр НЕ используется — после онбординга всегда редирект
на `/profile` (совпадает с post-signup поведением, упрощает middleware).

## UI-компоненты

### Общий чекбокс-блок (`packages/ui/src/widgets/auth/consents-checkboxes.tsx`)

Новый компонент, разделяемый между `RegisterForm` и `ConsentsOnboardingForm`:

```typescript
export type ConsentsCheckboxesValues = {
  agreedToTerms: boolean // объединённый обязательный
  agreedToMarketing: boolean // опциональный
}

export type ConsentsCheckboxesUrls = {
  userAgreement: string
  privacyPolicy: string
  piiConsent: string // НОВЫЙ — ссылка на /terms/consent
  publicOffer: string
  marketingConsent: string // НОВЫЙ — ссылка на /terms/marketing-consent
}

export type ConsentsCheckboxesProps = {
  register: UseFormRegister<ConsentsCheckboxesValues>
  errors: FieldErrors<ConsentsCheckboxesValues>
  urls: ConsentsCheckboxesUrls
}
```

Рендерит два `<FormControlLabel>` подряд:

1. Обязательный — required validation, `data-testid="register-terms-checkbox"` (имя сохраняется для совместимости с E2E `signUpAndAuthAs`).
2. Опциональный — без validation, `data-testid="register-marketing-checkbox"`.

Текст обязательного чекбокса: «Я принимаю **пользовательское соглашение**, **политику обработки персональных данных**, **согласие на обработку персональных данных** и **оферту на оказание услуг**».

Текст опционального: «Я согласен получать **информационные и рекламные рассылки**».

### `RegisterForm` (`packages/ui/src/widgets/auth/register-form.tsx`)

Изменения:

- `RegisterFormValues` получает `agreedToMarketing: boolean` (default `false`).
- `RegisterSubmitPayload` теперь `Omit<RegisterFormValues, 'confirmPassword' | 'agreedToTerms'>` — то есть включает `agreedToMarketing`.
- `TermsUrls` расширяется до `ConsentsCheckboxesUrls` (5 полей, все обязательные).
- Внутренний JSX чекбоксов заменяется на `<ConsentsCheckboxes>`.
- Сохраняется `data-testid="register-terms-checkbox"` для E2E-стабильности.

### `apps/web/src/app/(auth)/sign-up/sign-up-form.tsx`

Изменения:

- `signUp.email()` (better-auth client) заменяется на `trpc.auth.signUp.useMutation()`.
- В payload передаётся `marketing: values.agreedToMarketing`.
- Captcha token прокидывается через httpBatchLink `headers()` callback или через input mutation context (см. ниже).
- Существующий 3-секундный редирект на `/profile` через `useEffect` сохраняется.
- `termsUrls` обновляется до 5 ссылок.

### Передача captcha-token в tRPC

Сейчас captcha передаётся через `fetchOptions.headers["x-captcha-response"]`
в better-auth client. Для tRPC mutation такого механизма нет — нужно либо:

**Выбранный подход**: пробрасывать через `useTRPC` link опцию `headers()`,
которая поддерживает контекстные значения. Создать React Context
`CaptchaTokenContext` со state `currentToken`. Перед вызовом mutation
устанавливаем токен в context, link читает его и кладёт в header. После
вызова — обнуляем.

Альтернатива: передавать токен в input mutation как `captchaToken: string`,
а на сервере через middleware-плагин better-auth дёргать его явно. Это
чище архитектурно, но дублирует логику captcha-плагина. Идём с context-подходом.

### `/settings/consents`

#### Маршрут

`apps/web/src/app/(protected)/settings/consents/page.tsx` — RSC.

```typescript
export default async function ConsentsSettingsPage() {
  const session = await requireSession()
  const consents = await getCurrentConsents(prisma, session.user.id)
  return <ConsentsTable initialConsents={consents} />
}
```

#### `SettingsNav`

В `apps/web/src/app/(protected)/settings/settings-nav.tsx` (или эквиваленте)
добавляется пункт:

```typescript
{ href: '/settings/consents', label: 'Согласия', icon: <GavelIcon /> }
```

#### `ConsentsTable` (client)

`apps/web/src/app/(protected)/settings/consents/consents-table.tsx`:

```
┌─────────────────────────────┬────────────┬──────────────────┬────────────┐
│ Документ                    │ Статус     │ Дата             │ Действие   │
├─────────────────────────────┼────────────┼──────────────────┼────────────┤
│ Пользовательское соглашение │ ✓ Принято  │ 2026-05-10 14:30 │ Открыть    │
│ Политика обработки ПД       │ ✓ Принято  │ 2026-05-10 14:30 │ Открыть    │
│ Согласие на обработку ПД    │ ✓ Принято  │ 2026-05-10 14:30 │ Открыть    │
│ Оферта на оказание услуг    │ ✓ Принято  │ 2026-05-10 14:30 │ Открыть    │
│ Маркетинговые рассылки      │ ✗ Отклонено│ 2026-05-10 14:30 │ [Switch]   │
└─────────────────────────────┴────────────┴──────────────────┴────────────┘
```

- 4 обязательных строки: read-only.
  - Статус: «✓ Принято» (всегда true для обязательных, иначе пользователя бы не пустило).
  - «Открыть» — `<Link>` на `/terms/<slug>` в новой вкладке.
- Строка маркетинга:
  - Статус: «✓ Принято» / «✗ Отклонено».
  - Дата: время последнего toggle (или сообщение «Не принималось», если строки никогда не было).
  - Действие: MUI `<Switch>` + ссылка «Открыть».
  - Toggle вызывает `trpc.consent.setMarketing.useMutation()` с инвалидацией `consent.list`.

Используется существующий MUI `<Table>` через `@repo/ui/components`. Новые компоненты не добавляются в `@repo/ui`, остаются в `apps/web`.

## Безопасность и приватность

- **IP-адрес**: первый сегмент `x-forwarded-for`, trim'нутый. Fallback `x-real-ip`. Если оба `null` — пишем `null` (локальная разработка может дать `127.0.0.1`).
- **User-Agent**: усечение до 1024 символов перед записью.
- **`acceptRequired`** идемпотентна: повторный вызов при уже существующем полном наборе НЕ дублирует строки. Без этого refresh страницы онбординга мог бы плодить записи.
- **`setMarketing`** дедуплицируется по последнему состоянию: если последний MARKETING уже соответствует input, не пишем (чтобы спам-кликом не забивать историю).
- **Captcha**: `auth.signUp` процедура наследует captcha-валидацию от better-auth — токен прокидывается через `ctx.headers`. `consent.acceptRequired` и `consent.setMarketing` НЕ требуют captcha (пользователь уже залогинен).

## Тестирование

### Unit (vitest)

- `packages/trpc/src/__tests__/consents-helpers.test.ts`:
  - `getCurrentConsents` возвращает только последнюю строку по типу.
  - `hasAllRequiredConsents` корректно по edge cases (нет строк / есть отказ / есть только маркетинг).
  - `writeConsentBatch` идемпотентен.
  - `writeMarketingToggle` дедупликация.
  - `extractIpAddress` парсит x-forwarded-for, x-real-ip, oba отсутствуют.
- `packages/trpc/src/routers/__tests__/consent.test.ts` — все 3 procedures.
- `packages/trpc/src/routers/__tests__/auth.test.ts` — `signUp` mutation, проверка что consents пишутся, marketing=false по умолчанию, ошибка better-auth не пишет consent.
- `packages/ui/src/widgets/auth/__tests__/register-form.test.tsx` — обновить: payload теперь содержит `agreedToMarketing`, marketing checkbox не блокирует submit.
- `packages/ui/src/widgets/auth/__tests__/consents-checkboxes.test.tsx` — рендер обоих чекбоксов, required validation на первом, links открываются в новой вкладке.

### Web (vitest + jsdom)

- `apps/web/test/(auth)/sign-up-form.test.tsx` — обновить: mock `trpc.auth.signUp` вместо `auth-client.signUp.email`. Сохранить тест 3-секундного редиректа.
- `apps/web/test/(onboarding)/consents-form.test.tsx` (новый) — submit вызывает mutation и редиректит.
- `apps/web/test/(protected)/settings/consents-page.test.tsx` (новый) — таблица, marketing toggle.

### E2E (Playwright)

- `apps/e2e/auth.spec.ts` — расширить существующий sign-up тест: после регистрации зайти в /settings/consents и проверить что 5 строк отображаются (4 принятых + marketing отклонено).
- `apps/e2e/consents-onboarding.spec.ts` (новый):
  1. Создать пользователя через Prisma напрямую без consent-строк.
  2. Войти через UI.
  3. Проверить редирект на `/onboarding/consents`.
  4. Принять (без marketing) → проверить редирект на `/profile`.
  5. Зайти в `/settings/consents` → проверить наличие 5 строк, marketing=false.

`signUpAndAuthAs` хелпер в `apps/e2e/helpers/auth.ts` обновляется: после signup также пишет 5 consent строк через Prisma напрямую (чтобы существующие тесты, использующие хелпер, не падали на onboarding-редиректе).

## Документация

- В `CLAUDE.md` добавить блок в «Conventions that bite»:

  > **Consents**: `(protected)/layout.tsx` редиректит пользователей без обязательных consents на `/onboarding/consents`. При создании пользователя через Prisma напрямую (тесты, миграции) нужно вручную записать 5 строк в `user_consents`. Marketing — единственный toggleable consent через `consent.setMarketing`.

- E2E хелпер `signUpAndAuthAs` обновляется и комментируется.

## Out of scope

- **Пересогласование при изменении документа**: фиксируем `documentVersion`, но не сравниваем с текущей при последующих входах. Если документ меняется — старое согласие остаётся валидным. Реализация re-consent flow — отдельная фича.
- **Админ-страница для просмотра consents всех пользователей**.
- **Экспорт согласий в PDF** для предъявления Роскомнадзору / судам.
- **Email-уведомления** при изменении статуса (особенно при отзыве маркетинга).
- **Rate limiting** на `consent.setMarketing`.
- **Удаление аккаунта при отзыве PII consent**: в текущем дизайне обязательные consents read-only, отозвать через UI нельзя. Если в будущем понадобится «удалить аккаунт» — это отдельный flow.

## Файлы, которые изменятся

### Новые

- `packages/db/prisma/migrations/<timestamp>_add_user_consents/migration.sql`
- `packages/trpc/src/lib/consents.ts`
- `packages/trpc/src/routers/consent.ts`
- `packages/trpc/src/routers/auth.ts`
- `packages/trpc/src/__tests__/consents-helpers.test.ts`
- `packages/trpc/src/routers/__tests__/consent.test.ts`
- `packages/trpc/src/routers/__tests__/auth.test.ts`
- `packages/ui/src/widgets/auth/consents-checkboxes.tsx`
- `packages/ui/src/widgets/auth/__tests__/consents-checkboxes.test.tsx`
- `apps/web/src/lib/legal-document-versions.ts`
- `apps/web/docs/terms/MarketingConsent.md`
- `apps/web/src/app/(onboarding)/layout.tsx`
- `apps/web/src/app/(onboarding)/consents/page.tsx`
- `apps/web/src/app/(onboarding)/consents/consents-form.tsx`
- `apps/web/src/app/(protected)/settings/consents/page.tsx`
- `apps/web/src/app/(protected)/settings/consents/consents-table.tsx`
- `apps/web/test/(onboarding)/consents-form.test.tsx`
- `apps/web/test/(protected)/settings/consents-page.test.tsx`
- `apps/e2e/consents-onboarding.spec.ts`

### Изменения

- `packages/db/prisma/schema.prisma` — добавить enum'ы, model, relation в User.
- `packages/trpc/src/index.ts` — зарегистрировать `consent` и `auth` routers.
- `packages/trpc/src/context.ts` — убедиться что `headers` доступен (уже есть).
- `packages/ui/src/widgets/auth/register-form.tsx` — использовать `<ConsentsCheckboxes>`, расширить payload.
- `packages/ui/src/widgets/auth/__tests__/register-form.test.tsx` — обновить под новый payload.
- `packages/ui/src/widgets/index.ts` (или auth/index.ts) — экспортировать `ConsentsCheckboxes`.
- `apps/web/src/lib/legal-documents.ts` — добавить `marketing-consent`, поля `consentType` и `required`.
- `apps/web/src/app/(auth)/sign-up/sign-up-form.tsx` — переход на `trpc.auth.signUp`.
- `apps/web/test/(auth)/sign-up-form.test.tsx` — mock на `trpc.auth.signUp`.
- `apps/web/src/app/(protected)/layout.tsx` — гейт `hasAllRequiredConsents`.
- `apps/web/src/app/(protected)/settings/settings-nav.tsx` (или эквивалент) — пункт «Согласия».
- `apps/web/src/trpc/client.tsx` — добавить captcha-token прокидывание (`CaptchaTokenContext` + link `headers()`).
- `apps/e2e/helpers/auth.ts` — `signUpAndAuthAs` пишет 5 consent строк.
- `apps/e2e/auth.spec.ts` — расширить sign-up тест проверкой /settings/consents.
- `CLAUDE.md` — короткий блок про consents.
