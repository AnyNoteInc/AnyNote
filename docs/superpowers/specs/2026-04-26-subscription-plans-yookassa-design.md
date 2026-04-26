---
status: draft
date: 2026-04-26
topic: Subscription plans (Personal/Pro/Max) + YooKassa recurring payments
---

# Subscription Plans + YooKassa — Design

## Goal

Заменить текущую тестовую тройку планов (`free`/`personal`/`corporate`) на продуктовую
модель Personal/Pro/Max, ввести гейтинг чатов / индексации / settings/members /
settings/ai по тарифу, интегрировать YooKassa с recurring payments
(saved-method) для месячных и годовых подписок, добавить cron автопродления
в `apps/engines`, CLI-команду полного возврата, флаг отмены подписки
(`cancelAtPeriodEnd`) и переписать страницы `/pricing`, лендинга, `/settings/billing`

- новый чекаут-flow.

## Non-goals

- **Реализация Custom MCP servers (Max)** — отдельный спек. Здесь — только маркетинговый
  чип в карточке тарифа.
- **Реализация developer space + голосование за беклог (Max)** — отдельный спек.
- **Приоритетная поддержка** — отдельный спек (зависит от наличия системы тикетов).
- **Тариф «Собственная инфраструктура»** — без интеграции с оплатой; отдельная карточка
  «Связаться» → `/contact`.
- **Proration при смене тарифа в середине цикла** — известное ограничение v1. Старая
  подписка переводится в EXPIRED, новая создаётся с новым периодом без перерасчёта.
- **User-facing рефанды.** Возврат денег только через CLI в engines (по запросу
  саппорта).
- **Email-уведомления** при failed renewal / refund / cancel — out of scope, если
  нет готового транспорта в проекте на момент реализации (сейчас в auth.ts
  `sendResetPassword` throws — транспорт не настроен).
- **Миграция реальных данных.** Текущие `Subscription` — тестовые, прод-юзеров нет.
  Миграция переименовывает slugs и backfill-ит новые поля дефолтами.
- **Юридический текст оферты.** Создаём заглушку `/oferta` с пометкой
  `TODO: legal review`. Чекбокс на чекауте работает.

## Current state

- **Plan**: `id`, `slug`, `name`, `description`, `priceMonthly` (kopecks), `currency`,
  `maxWorkspaces`, `maxMembersPerWorkspace`, `features` (Json), `isActive`, `sortOrder`.
  Слаги: `free`, `personal`, `corporate`. Ссылки на `Subscription[]`.
- **Subscription**: `userId`, `planId`, `status` (`ACTIVE` | `CANCELED` | `EXPIRED`),
  `paymentProvider`, `providerSubscriptionId`, `amountPaid`, `currency`, `metadata`,
  `currentPeriodStart`, `currentPeriodEnd`, `cancelledAt`. Без `Order`.
- **Регистрация**: better-auth `databaseHook user.create.after` (`packages/auth/src/auth.ts:50-75`)
  ищет план по `slug: "free"` и создаёт `Subscription(ACTIVE)`.
- **Workspace sidebar**: `apps/web/src/components/workspace/workspace-sidebar.tsx:29,78`
  принимает `planName` пропом, рендерит `<Box>{planName} plan</Box>`.
- **Маршруты**:
  - `apps/web/src/app/(protected)/workspaces/[workspaceId]/chats/page.tsx` — есть
  - `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx` — есть
  - `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx` — есть
- **Pricing**: `apps/web/src/app/(about)/pricing/page.tsx` — статичные карточки в USD из
  `apps/web/src/components/public/content.ts`.
- **Landing**: `apps/web/src/app/(about)/page.tsx:147-190` рендерит `landingPricingCards`
  оттуда же.
- **Billing**: `apps/web/src/app/(protected)/settings/billing/page.tsx` — заглушка.
- **tRPC subscription router**: `packages/trpc/src/routers/subscription.ts` —
  `getCurrent()`, `listHistory()`. Хелпер `getActivePlanForUser` в
  `packages/trpc/src/helpers/plan.ts`.
- **YooKassa**: ничего нет.
- **Engines CLI**: одиночный скрипт `apps/engines/src/cli/backfill-reindex.ts` без
  фреймворка.
- **Cron-паттерн**: `@Cron(...)` из `@nestjs/schedule`, пример
  `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts:44`.
- **Indexer**: тот же cron-сервис обрабатывает `OutboxEvent (page.upserted | page.deleted)`.

## Architecture

```
──────────────────────────── DATA MODEL ────────────────────────────
Plan (3 rows: personal | pro | max + capability flags + priceYearly)
  │
  └─< Subscription (status, billingPeriod, cancelAtPeriodEnd, paymentMethodId, period)
        │
        └─< Order (PENDING → PAID|FAILED|REFUNDED, yookassaPaymentId, idempotencyKey)

──────────────────────────── PURCHASE FLOW ────────────────────────────
/pricing  → Купить Pro
   │  открывается CheckoutModal (period toggle + сумма + оферта)
   ▼
trpc subscription.startCheckout  →  Order(PENDING) + YooKassa.createPayment(save_payment_method=true)
   │
   ▼
window.location = confirmation_url   (виджет YooKassa)
   │
   ▼
оплата → redirect /billing/return?orderId=...
   │   и параллельно ─┐
   ▼                  ▼
polling Order.status   webhook /api/webhooks/yookassa  (payment.succeeded)
                       │
                       ▼
              Order.PAID + Subscription { ACTIVE, paymentMethodId, currentPeriodEnd }
                       │
            (старая платная Subscription → EXPIRED, если была)

──────────────────────────── RENEWAL FLOW ────────────────────────────
apps/engines @Cron "0 0 0 * * *"  TZ=Europe/Moscow
   │
   ▼
expireCanceled():  ACTIVE && cancelAtPeriodEnd && currentPeriodEnd<=now → EXPIRED
   │
   ▼
renewActive():     ACTIVE && !cancelAtPeriodEnd && currentPeriodEnd<=now &&
                   paymentMethodId IS NOT NULL
       (пакетами BILLING_RENEWAL_BATCH_SIZE)
   │
   ▼
   for each:
     Order(PENDING, isInitial=false)
     yookassa.chargeWithSavedMethod(amount, paymentMethodId, idempotencyKey)
       succeeded → Order.PAID + Subscription.currentPeriodEnd += period
       canceled  → Order.FAILED + Subscription.EXPIRED   (soft-downgrade)
       pending   → ждём webhook

──────────────────────────── REFUND FLOW (CLI) ────────────────────────
apps/engines  cli refund <orderId>
   │
   ▼
yookassa.createRefund({ payment_id, amount })
   │
   ▼
Order.REFUNDED  +  Subscription.EXPIRED  +  currentPeriodEnd=now
```

---

## 1. Schema (Prisma)

### 1.1. Переименование слагов в одной миграции

| Было slug   | Стало slug |
| ----------- | ---------- |
| `free`      | `personal` |
| `personal`  | `pro`      |
| `corporate` | `max`      |

`Subscription.planId` ссылается по `id`, не по slug → переименование не ломает
существующие ссылки. Прод-данных нет.

### 1.2. Расширение `Plan`

```prisma
model Plan {
  id                       String   @id @default(uuid())
  slug                     String   @unique  // personal | pro | max
  name                     String
  description              String

  // pricing — kopecks (RUB)
  priceMonthlyKopecks      Int      @default(0)
  priceYearlyKopecks       Int      @default(0)
  currency                 String   @default("RUB")

  // limits
  maxWorkspaces            Int?     // null = unlimited
  maxMembersPerWorkspace   Int      @default(1)

  // capability flags
  chatsEnabled             Boolean  @default(false)
  pageIndexingEnabled      Boolean  @default(false)
  membersSettingsEnabled   Boolean  @default(false)
  aiSettingsEnabled        Boolean  @default(false)
  customMcpEnabled         Boolean  @default(false)   // marketing-only в этом спеке
  prioritySupport          Boolean  @default(false)   // marketing-only
  developerSpaceEnabled    Boolean  @default(false)   // marketing-only

  // marketing copy для карточек
  features                 Json     @default("[]")

  isActive                 Boolean  @default(true)
  sortOrder                Int      @default(0)

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  subscriptions            Subscription[]
}
```

Старое поле `priceMonthly` переименовывается в `priceMonthlyKopecks` (для ясности
единиц). Это breaking-change для tRPC `subscription.getCurrent()`, но т.к. фронт
не использует `priceMonthly` для отображения (заглушка), боль минимальна.

**`availableAiModels` на Plan не нужен**: в схеме уже есть `AiModel.minPlanSlug`
(`packages/db/prisma/schema.prisma:362`) — каждая модель сама декларирует минимальный
план. Это инверсия и предпочтительнее: при добавлении новой модели не нужно
обновлять все Plan-row. Фильтрация моделей в settings/ai — через JOIN с проверкой
`AiModel.minPlanSlug` ≤ `currentPlan.sortOrder` (см. секцию 2.5).

### 1.3. Расширение `Subscription`

```prisma
model Subscription {
  id                       String   @id @default(uuid())
  userId                   String
  planId                   String

  status                   SubscriptionStatus  @default(ACTIVE)
  billingPeriod            BillingPeriod       @default(MONTHLY)

  // period
  currentPeriodStart       DateTime?           // null для бесплатной Personal
  currentPeriodEnd         DateTime?           // null для бесплатной Personal

  // cancellation
  cancelAtPeriodEnd        Boolean             @default(false)
  cancelledAt              DateTime?

  // YooKassa recurring
  paymentMethodId          String?             // YooKassa payment_method.id
  paymentMethodLast4       String?             // для отображения в UI
  paymentMethodBrand       String?             // visa | mastercard | mir | sbp | ...

  // existing
  paymentProvider          String?
  providerSubscriptionId   String?
  amountPaid               Int?
  currency                 String              @default("RUB")
  metadata                 Json?

  expiredAt                DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  user                     User    @relation(fields: [userId], references: [id])
  plan                     Plan    @relation(fields: [planId], references: [id])
  orders                   Order[]

  @@index([userId])
  @@index([currentPeriodEnd, status, cancelAtPeriodEnd])  // для крон-запроса
}

enum SubscriptionStatus {
  ACTIVE
  CANCELED   // (опционально, можно не использовать — отмена живёт через cancelAtPeriodEnd)
  EXPIRED
}

enum BillingPeriod {
  MONTHLY
  YEARLY
}
```

Семантика `currentPeriodEnd = null` — бесплатный/бессрочный план (Personal). Cron
фильтрует `currentPeriodEnd IS NOT NULL` в `expireCanceled` / `renewActive`,
поэтому Personal-юзеры не попадают в обработку.

### 1.4. Новая модель `Order`

```prisma
model Order {
  id                       String      @id @default(uuid())
  userId                   String

  // план/период покупки сохраняем на самом Order, чтобы webhook мог создать
  // Subscription post-factum, не теряя контекст
  planId                   String
  billingPeriod            BillingPeriod
  amountKopecks            Int
  currency                 String      @default("RUB")
  status                   OrderStatus @default(PENDING)

  // Заполняется в webhook payment.succeeded (initial) или сразу cron-ом (renewal)
  subscriptionId           String?

  yookassaPaymentId        String?     @unique
  yookassaIdempotencyKey   String      @unique
  isInitial                Boolean     @default(false)
  savedPaymentMethod       Boolean     @default(false)

  // refund
  refundedAt               DateTime?
  yookassaRefundId         String?

  metadata                 Json?
  paidAt                   DateTime?
  createdAt                DateTime    @default(now())
  updatedAt                DateTime    @updatedAt

  user                     User          @relation(fields: [userId], references: [id])
  plan                     Plan          @relation(fields: [planId], references: [id])
  subscription             Subscription? @relation(fields: [subscriptionId], references: [id])

  @@index([userId])
  @@index([status])
  @@index([subscriptionId])
}

enum OrderStatus {
  PENDING
  PAID
  FAILED
  REFUNDED
  CANCELED
}
```

### 1.5. Default plan на регистрации

`packages/auth/src/auth.ts:50-75` — заменить `slug: "free"` на `slug: "personal"`. При
создании `Subscription` для нового юзера: `currentPeriodStart=null`,
`currentPeriodEnd=null`, `billingPeriod=MONTHLY` (значение игнорируется для бесплатного
плана).

### 1.6. Seed (`packages/db/prisma/seed.ts`)

```ts
const plans = [
  {
    slug: 'personal',
    name: 'Personal',
    description: 'Для личного пользования',
    priceMonthlyKopecks: 0,
    priceYearlyKopecks: 0,
    maxWorkspaces: 1,
    maxMembersPerWorkspace: 1,
    chatsEnabled: false,
    pageIndexingEnabled: false,
    membersSettingsEnabled: false,
    aiSettingsEnabled: false,
    customMcpEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: ['1 рабочее пространство', 'Базовый редактор', 'Без AI и индексации'],
    sortOrder: 1,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Для продвинутых пользователей',
    priceMonthlyKopecks: 15_000, // 150 RUB
    priceYearlyKopecks: 100_000, // 1000 RUB
    maxWorkspaces: 3,
    maxMembersPerWorkspace: 5,
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: false,
    prioritySupport: false,
    developerSpaceEnabled: false,
    features: [
      '3 рабочих пространства',
      'До 5 участников в каждом',
      'Чаты с AI',
      'Индексация страниц',
      'GigaChat-2 и GigaChat-2 Pro',
    ],
    sortOrder: 2,
  },
  {
    slug: 'max',
    name: 'Max',
    description: 'Для команд и больших задач',
    priceMonthlyKopecks: 150_000, // 1500 RUB
    priceYearlyKopecks: 1_200_000, // 12000 RUB
    maxWorkspaces: null, // unlimited
    maxMembersPerWorkspace: 100,
    chatsEnabled: true,
    pageIndexingEnabled: true,
    membersSettingsEnabled: true,
    aiSettingsEnabled: true,
    customMcpEnabled: true,
    prioritySupport: true,
    developerSpaceEnabled: true,
    features: [
      'Неограниченное число пространств',
      'До 100 участников',
      'GigaChat-2, Pro, Max',
      'Кастомные MCP-серверы',
      'Приоритетная поддержка',
      'Доступ к пространству разработчиков',
    ],
    sortOrder: 3,
  },
]
// upsert by slug, идемпотентно
```

---

## 2. Plan-gating в UI и в индексаторе

### 2.1. Хелпер `getWorkspaceFeatures(workspaceId)`

Файл: `packages/trpc/src/helpers/plan.ts`. Резолвит фичи **по владельцу workspace**.

```ts
export type PlanFeatures = {
  slug: 'personal' | 'pro' | 'max'
  name: string
  sortOrder: number // используется для сравнения тарифов
  isPaid: boolean // false для personal
  maxWorkspaces: number | null
  maxMembersPerWorkspace: number
  chatsEnabled: boolean
  pageIndexingEnabled: boolean
  membersSettingsEnabled: boolean
  aiSettingsEnabled: boolean
  customMcpEnabled: boolean
  prioritySupport: boolean
  developerSpaceEnabled: boolean
}

// Список AI-моделей резолвится через AiModel.minPlanSlug, не через PlanFeatures
export async function getAvailableAiModels(workspaceId: string): Promise<AiModel[]>

export async function getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures>
```

Логика:

1. Найти `Workspace.ownerId`.
2. Найти активную (non-EXPIRED) подписку владельца. Если нет — взять Personal-план.
3. Из плана собрать `PlanFeatures`. `isPaid = slug !== "personal"`.

Аналогичный `getActivePlanForUser(userId)` уже есть и продолжает использоваться в
non-workspace контекстах (например, `/settings/billing`).

### 2.2. Layout-уровень enforcement

В `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`:

```ts
const features = await getWorkspaceFeatures(workspaceId)
return (
  <WorkspaceLayoutShell features={features}>
    {children}
  </WorkspaceLayoutShell>
)
```

Sub-layout-ы (server components):

| Маршрут             | Файл                                                 | Проверка                                           |
| ------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| `/chats/*`          | `workspaces/[workspaceId]/chats/layout.tsx` (новый)  | `if (!features.chatsEnabled) notFound()`           |
| `/settings/members` | `workspaces/[workspaceId]/settings/members/page.tsx` | `if (!features.membersSettingsEnabled) notFound()` |
| `/settings/ai`      | `workspaces/[workspaceId]/settings/ai/page.tsx`      | `if (!features.aiSettingsEnabled) notFound()`      |

`features` пробрасывается через React Context (или prop через layout-shell, чтобы
sub-pages могли читать без отдельного fetch). Для упрощения — server-side prop +
react cache.

### 2.3. Скрытие пунктов навигации

`workspace-sidebar.tsx` фильтрует:

- ссылку «Чаты» — по `features.chatsEnabled`
- настройки «Участники» — по `features.membersSettingsEnabled`
- настройки «AI агенты» — по `features.aiSettingsEnabled`

Все эти проверки на сервере (sidebar — server-rendered) либо в client-component с
переданным `features` пропом.

### 2.4. Бейдж тарифа в sidebar

```tsx
// apps/web/src/components/workspace/workspace-sidebar.tsx
<Stack direction="row" alignItems="center" gap={1}>
  <Chip
    label={features.name}
    size="small"
    color={features.isPaid ? 'success' : 'default'}
    variant={features.isPaid ? 'filled' : 'outlined'}
  />
  {!features.isPaid && (
    <Link href="/pricing" sx={{ fontSize: 12 }}>
      Перейти на Pro
    </Link>
  )}
</Stack>
```

Зелёный филлед-чип для Pro/Max через MUI `color="success"`. Для Personal — серый
outlined-чип + текстовая ссылка на /pricing.

### 2.5. Селектор AI-моделей

В схеме уже есть `AiModel.minPlanSlug` (`packages/db/prisma/schema.prisma:362`).
Используем его — избегаем дублирования списка моделей в `Plan.features`.

Хелпер `getAvailableAiModels(workspaceId)` в `packages/trpc/src/helpers/plan.ts`:

```ts
export async function getAvailableAiModels(workspaceId: string): Promise<AiModel[]> {
  const features = await getWorkspaceFeatures(workspaceId)

  // выбираем все плановые slug-и с sortOrder ≤ текущему
  const allowedPlanSlugs = await prisma.plan
    .findMany({
      where: { sortOrder: { lte: features.sortOrder } },
      select: { slug: true },
    })
    .then((rows) => rows.map((r) => r.slug))

  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedPlanSlugs } }],
    },
    include: { provider: true },
  })
}
```

Использование на странице `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`:
после layout-проверки `aiSettingsEnabled` грузим `getAvailableAiModels(workspaceId)`
и рендерим селектор только из этого списка.

Если в `WorkspaceAiSettings.defaultModelId` сохранена модель, которой больше нет в
доступных (например, после даунгрейда Max → Pro и отказа от gigachat-2-max), при
чтении на сервере возвращаем первую модель из доступных вместо ошибки. Перезаписи в
БД не делаем — при следующем сохранении настроек значение синхронизируется.

**Seed данных AiModel** — отдельная задача в плане реализации: убедиться, что в seed
есть три модели с правильными `minPlanSlug`:

- `gigachat-2` → `minPlanSlug: "pro"`
- `gigachat-2-pro` → `minPlanSlug: "pro"`
- `gigachat-2-max` → `minPlanSlug: "max"`

### 2.6. Гейтинг индексации в engines

`apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts` —
в `processRow()` перед вызовом `agentsClient.vectorize(...)`:

```ts
const features = await this.planFeatures.getByWorkspaceId(event.workspaceId)
if (!features.pageIndexingEnabled) {
  // мягко переводим row → DONE без вызова /vectorize
  await this.markDone(rowId)
  return
}
```

`PlanFeaturesService` — тонкая обёртка вокруг той же логики `getWorkspaceFeatures`,
живёт в engines (engines не использует tRPC хелперы напрямую — отдельный сервис
с инжектом Prisma).

После апгрейда юзера с Personal на Pro/Max нужен **backfill индексации**: для всех
workspace, которыми он владеет, эмитим `OutboxEvent(page.upserted)` для каждой
TEXT-страницы. Это маленькая задача в плане реализации, обработчик уже существует.

### 2.7. Soft downgrade — read-only режим

После EXPIRED:

- `getWorkspaceFeatures` для всех его workspace начинает возвращать Personal-фичи
- /chats, /settings/members, /settings/ai → 404 в этих workspace
- Лишние workspace остаются доступными на чтение

Гард на запись:

```ts
// packages/trpc/src/helpers/plan.ts
export async function requireWritableWorkspace(workspaceId: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true, createdAt: true },
  })
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND' })

  const features = await getWorkspaceFeatures(workspaceId)
  if (features.maxWorkspaces === null) return // unlimited (Max)

  // считаем какой по счёту workspace создан владельцем
  const olderCount = await prisma.workspace.count({
    where: { ownerId: workspace.ownerId, createdAt: { lt: workspace.createdAt } },
  })
  if (olderCount >= features.maxWorkspaces) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'WORKSPACE_OVER_PLAN_LIMIT', // i18n-ключ
    })
  }
}
```

Гард применяется в существующих write-мутациях:

- `page.create`, `page.update`, `page.delete`
- `member.invite`
- любые мутации, изменяющие state workspace

Точный список — определю при написании плана (берём из текущего `packages/trpc/src/routers/`).

Чтение (queries) — без гарда.

---

## 3. YooKassa интеграция

### 3.1. Пакет `packages/yookassa`

Новый workspace-package, тонкая HTTP-обёртка.

Структура:

```
packages/yookassa/
  package.json
  tsconfig.json
  src/
    index.ts           // public exports
    client.ts          // class YookassaClient
    types.ts           // Payment, Refund, PaymentMethod, ConfirmationRedirect, Webhook events
    webhook.ts         // parseWebhookEvent + verifyTrustedIp
    errors.ts          // YookassaError, YookassaApiError
```

`YookassaClient` API:

```ts
class YookassaClient {
  constructor(opts: { shopId: string; secretKey: string; baseUrl?: string; fetch?: typeof fetch })
  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<Payment>
  chargeWithSavedMethod(input: ChargeSavedInput, idempotencyKey: string): Promise<Payment>
  getPayment(id: string): Promise<Payment>
  createRefund(input: CreateRefundInput, idempotencyKey: string): Promise<Refund>
  getRefund(id: string): Promise<Refund>
}
```

HTTP: Basic Auth `${shopId}:${secretKey}`, header `Idempotence-Key: ${uuid}`,
`Content-Type: application/json`.

Endpoints:

- POST `https://api.yookassa.ru/v3/payments`
- GET `https://api.yookassa.ru/v3/payments/{id}`
- POST `https://api.yookassa.ru/v3/refunds`
- GET `https://api.yookassa.ru/v3/refunds/{id}`

`webhook.ts`:

- `parseWebhookEvent(body)` → `{ event: string; object: Payment | Refund }`
- `verifyTrustedIp(ip, allowlist?)` — опционально, читает CSV из env

Используется из `apps/web` (initial purchase, webhook) и `apps/engines` (renewal cron, refund CLI).

### 3.2. ENV vars (новые)

В repo root `.env`, объявить в `turbo.json globalEnv`:

| Var                               | Где используется | Default                                      |
| --------------------------------- | ---------------- | -------------------------------------------- |
| `YOOKASSA_SHOP_ID`                | web, engines     | (no default)                                 |
| `YOOKASSA_SECRET_KEY`             | web, engines     | (no default)                                 |
| `YOOKASSA_RETURN_URL_BASE`        | web              | использует `NEXT_PUBLIC_BASE_URL` если пусто |
| `YOOKASSA_TRUSTED_IPS`            | web              | optional CSV                                 |
| `BILLING_RENEWAL_CRON_EXPRESSION` | engines          | `"0 0 0 * * *"`                              |
| `BILLING_RENEWAL_BATCH_SIZE`      | engines          | `50`                                         |

### 3.3. tRPC расширение `subscription` router

Файл `packages/trpc/src/routers/subscription.ts`. Новые процедуры:

```ts
subscription: {
  // existing
  getCurrent: query → { plan, subscription, features }
  listHistory: query → Subscription[]   // переименуем в listOrders ниже

  // new
  startCheckout: mutation
    input { planSlug: "pro" | "max", period: "MONTHLY" | "YEARLY" }
    output { confirmationUrl, orderId }

  cancel: mutation                       // ставит cancelAtPeriodEnd=true
  resume: mutation                       // ставит cancelAtPeriodEnd=false (если ещё ACTIVE)

  getOrder: query                        // для polling на /billing/return
    input { orderId }
    output { id, status, plan, period, amountKopecks }

  listOrders: query                      // для истории платежей
    output Order[]
}
```

`startCheckout` — серверная логика:

```ts
1. Authenticated user only
2. Validate planSlug ∈ {"pro", "max"} и period ∈ {"MONTHLY", "YEARLY"}
3. Загрузить Plan по slug
4. Проверить, что у юзера нет активной Subscription с тем же planId
   (если есть — TRPCError ALREADY_SUBSCRIBED)
5. amountKopecks = period === MONTHLY
       ? plan.priceMonthlyKopecks
       : plan.priceYearlyKopecks
6. idempotencyKey = uuid v4
7. Создать Order {
     userId, planId: plan.id, billingPeriod: period,
     amountKopecks, currency: "RUB",
     status: PENDING, isInitial: true, savedPaymentMethod: true,
     yookassaIdempotencyKey: idempotencyKey,
     subscriptionId: null,   // заполнится в webhook payment.succeeded
   }
8. yookassa.createPayment({
     amount: { value: kopecksToRub(amountKopecks), currency: "RUB" },
     capture: true,
     save_payment_method: true,
     confirmation: { type: "redirect", return_url: `${YOOKASSA_RETURN_URL_BASE}/billing/return?orderId=${orderId}` },
     description: `Подписка ${plan.name} (${period === "MONTHLY" ? "Месяц" : "Год"})`,
     metadata: { orderId, userId, planSlug, period },
   }, idempotencyKey)
9. Update Order { yookassaPaymentId: payment.id }
10. Return { confirmationUrl: payment.confirmation.confirmation_url, orderId }
```

### 3.4. Webhook handler

Файл: `apps/web/src/app/api/webhooks/yookassa/route.ts`. `runtime = "nodejs"`.

```ts
export async function POST(req: NextRequest) {
  // (опционально) verify request IP
  const ip = req.headers.get('x-forwarded-for') ?? '?'
  if (process.env.YOOKASSA_TRUSTED_IPS) {
    if (!isTrustedIp(ip, process.env.YOOKASSA_TRUSTED_IPS)) {
      return Response.json({ error: 'untrusted IP' }, { status: 403 })
    }
  }

  const body = await req.json()
  const event = parseWebhookEvent(body)

  switch (event.type) {
    case 'payment.succeeded':
      await handlePaymentSucceeded(event.object)
      break
    case 'payment.canceled':
      await handlePaymentCanceled(event.object)
      break
    case 'refund.succeeded':
      await handleRefundSucceeded(event.object) // идемпотентно — CLI обычно уже
      break
  }
  return Response.json({ ok: true })
}
```

`handlePaymentSucceeded(payment)`:

```ts
1. Найти Order по yookassaPaymentId (с include: { plan: true })
2. Если Order.status !== PENDING → return (идемпотентно)
3. Defense-in-depth: yookassa.getPayment(payment.id) — проверяем status === "succeeded"
4. В одной транзакции:
   a) Старую ACTIVE Subscription юзера с другим planId → status: EXPIRED, expiredAt: now
   b) Если у юзера уже есть Subscription с тем же planId (например, был на Personal,
      или это renewal-Order):
        - update: status=ACTIVE, billingPeriod, paymentMethodId, currentPeriodStart=now,
          currentPeriodEnd = now + period, cancelAtPeriodEnd=false
      Иначе создать новую Subscription с теми же параметрами
   c) Order { status: PAID, paidAt: now, subscriptionId: <new/updated sub>.id,
            savedPaymentMethod: response.payment_method.saved,
            (опционально) yookassaRefundId не трогаем }
   d) Если payment.payment_method.saved → также апдейтим Subscription
      { paymentMethodId, paymentMethodLast4 (из payment.payment_method.card.last4 если карта),
        paymentMethodBrand (из payment.payment_method.type или card.card_type) }
```

Примечание: для renewal-Order (создаваемого cron-ом) `subscriptionId` уже заполнен
заранее, поэтому шаг 4b просто апдейтит существующую Subscription. Для initial-Order
он заполняется здесь, в webhook'e.

Идемпотентность:

- `Order.status === PENDING` — главный флаг
- `yookassaPaymentId` — `@unique`, не позволит дубликат

`/billing/return?orderId=...` — отдельная страница, polling Order через tRPC.

### 3.5. Cancel & Resume

```ts
subscription.cancel:  Subscription { cancelAtPeriodEnd: true, cancelledAt: now() }
subscription.resume:  Subscription { cancelAtPeriodEnd: false, cancelledAt: null }
                       (только если status === ACTIVE)
```

UI в `/settings/billing`:

- Confirm dialog с текстом «Подписка остаётся активной до DD.MM.YYYY, затем перейдёте
  на Personal без потери данных».

### 3.6. Refund flow (CLI only)

Реализация в engines (секция 4). Webhook `refund.succeeded` вызывается _после_ CLI и
действует идемпотентно (если Order уже REFUNDED — no-op).

### 3.7. Смена тарифа Pro ↔ Max

- Из `/pricing` или `/settings/billing` → клик на «Перейти на Max»
- Открывается тот же CheckoutModal
- Создаётся новый Order на Max
- В webhook'е `payment.succeeded` старая Subscription (Pro) переводится в EXPIRED,
  новая создаётся
- Без proration — known limitation

---

## 4. Engines: cron автопродления + CLI

### 4.1. Новый модуль `apps/engines/src/apps/billing/`

```
apps/engines/src/apps/billing/
  billing.module.ts
  cron/
    subscription-renewal-cron.service.ts
  services/
    subscription-renewal.service.ts        // core логика, переиспользуется cron + CLI
    refund.service.ts
    plan-features.service.ts                // engines-side getWorkspaceFeatures
    yookassa-client.factory.ts              // singleton YookassaClient
  commands/
    refund.command.ts
    force-renew.command.ts
    cancel-subscription.command.ts
```

`BillingModule` подключается в `AppModule` рядом с `IndexerModule`.

### 4.2. Cron: автопродление и истечение

`subscription-renewal-cron.service.ts`:

```ts
@Injectable()
export class SubscriptionRenewalCronService {
  constructor(
    private readonly renewals: SubscriptionRenewalService,
    private readonly logger: Logger,
  ) {}

  @Cron(process.env.BILLING_RENEWAL_CRON_EXPRESSION ?? '0 0 0 * * *', { timeZone: 'Europe/Moscow' })
  async processEndOfDay() {
    await this.renewals.expireCanceled()
    await this.renewals.renewActive()
  }
}
```

`SubscriptionRenewalService.expireCanceled()`:

```sql
UPDATE Subscription
SET status = 'EXPIRED', expiredAt = now()
WHERE status = 'ACTIVE'
  AND cancelAtPeriodEnd = true
  AND currentPeriodEnd IS NOT NULL
  AND currentPeriodEnd <= now()
```

`SubscriptionRenewalService.renewActive()`:

```ts
const batch = await prisma.subscription.findMany({
  where: {
    status: 'ACTIVE',
    cancelAtPeriodEnd: false,
    paymentMethodId: { not: null },
    currentPeriodEnd: { lte: new Date() },
  },
  take: BILLING_RENEWAL_BATCH_SIZE,
  include: { plan: true },
})

for (const sub of batch) {
  try {
    await this.renewOne(sub.id)
  } catch (err) {
    this.logger.error(`renewOne(${sub.id}) failed`, err)
  }
}
```

`SubscriptionRenewalService.renewOne(subscriptionId)`:

```ts
1. Reload Subscription + Plan
2. Validate инварианты (status=ACTIVE, paymentMethodId, currentPeriodEnd<=now)
3. amount = period === MONTHLY ? plan.priceMonthlyKopecks : plan.priceYearlyKopecks
4. Создать Order {
     userId, planId, billingPeriod, amountKopecks: amount,
     status: PENDING, isInitial: false, savedPaymentMethod: true,
     subscriptionId: sub.id,    // уже известен — Subscription существует
     yookassaIdempotencyKey: uuid()
   }
5. yookassa.chargeWithSavedMethod({
     amount, payment_method_id: sub.paymentMethodId,
     capture: true,
     description: `Автопродление ${plan.name} (${period})`,
     metadata: { orderId, subscriptionId },
   }, idempotencyKey)
6. switch payment.status:
   - "succeeded": в транзакции:
        Order { PAID, paidAt, yookassaPaymentId }
        Subscription { currentPeriodStart: now, currentPeriodEnd: now + period }
   - "canceled":
        Order { FAILED, yookassaPaymentId }
        Subscription { status: EXPIRED, expiredAt: now }
   - "pending":  // 3DS, редкость
        Order { PENDING, yookassaPaymentId }   // вебхук дозавершит
        // Subscription оставляем ACTIVE; если webhook не пришёл за 24ч — следующий
        // прогон cron снова попробует (Order.yookassaIdempotencyKey @unique
        // защитит от дублирующего YooKassa-платежа)
```

### 4.3. CLI на nest-commander

Добавить dep `nest-commander` в `apps/engines/package.json`.

Новый entry: `apps/engines/src/cli.ts`:

```ts
import { CommandFactory } from 'nest-commander'
import { CliModule } from './cli.module'

async function bootstrap() {
  await CommandFactory.run(CliModule, { logger: ['error', 'warn', 'log'] })
}
bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

`CliModule` импортирует `BillingModule` и `IndexerModule` (для backfill-reindex).

`apps/engines/package.json`:

```json
{
  "scripts": {
    "cli": "tsx src/cli.ts",
    "cli:prod": "node dist/cli.js"
  }
}
```

Использование:

```bash
pnpm --filter @repo/engines cli refund <orderId>
pnpm --filter @repo/engines cli force-renew <subscriptionId>
pnpm --filter @repo/engines cli cancel-subscription <subscriptionId>
pnpm --filter @repo/engines cli backfill-reindex   # перенос существующего скрипта
```

### 4.4. Команды

#### `refund <orderId>`

```ts
@Command({ name: 'refund', description: 'Полный возврат по Order id', arguments: '<orderId>' })
class RefundCommand extends CommandRunner {
  constructor(private readonly refunds: RefundService) {
    super()
  }

  async run([orderId]: string[]) {
    if (!orderId) {
      console.error('Usage: cli refund <orderId>')
      process.exit(1)
    }
    const result = await this.refunds.fullRefund(orderId)
    console.log('✓ Refunded:', result.yookassaRefundId)
    console.log('✓ Order:', orderId, '→ REFUNDED')
    console.log('✓ Subscription:', result.subscriptionId, '→ EXPIRED')
  }
}
```

`RefundService.fullRefund(orderId)`:

```ts
1. Order = findUnique({ orderId })
2. Validate order.status === "PAID" && order.refundedAt === null
3. yookassa.createRefund({
     payment_id: order.yookassaPaymentId,
     amount: { value: kopecksToRub(order.amountKopecks), currency: order.currency },
     description: "Возврат",
   }, idempotencyKey)
4. В транзакции:
   - Order { status: REFUNDED, refundedAt: now, yookassaRefundId }
   - Subscription { status: EXPIRED, expiredAt: now, currentPeriodEnd: now }
5. Return { yookassaRefundId, subscriptionId }
```

#### `force-renew <subscriptionId>`

Прямой вызов `subscriptionRenewalService.renewOne(subscriptionId)` без проверки
`currentPeriodEnd`. Полезно для проверки saved-method интеграции на тестовом аккаунте.

#### `cancel-subscription <subscriptionId>`

Помечает `cancelAtPeriodEnd=true, cancelledAt=now`. Юзер не теряет доступ. Эквивалент
`subscription.cancel` tRPC, но из CLI для саппорт-кейсов.

### 4.5. Миграция `backfill-reindex.ts`

Существующий `apps/engines/src/cli/backfill-reindex.ts` — переписать как
`@Command({ name: "backfill-reindex" })` в `apps/engines/src/apps/indexer/commands/`.
Маленькое сопутствующее улучшение, чтобы был один CLI-механизм.

---

## 5. Pages: pricing / landing / billing / checkout / return

### 5.1. `/pricing` (публичная)

`apps/web/src/app/(about)/pricing/page.tsx`. Server Component:

```ts
const plans = await prisma.plan.findMany({
  where: { isActive: true },
  orderBy: { sortOrder: "asc" },
})
const session = await getSession()
const currentPlan = session ? await getActivePlanForUser(session.user.id) : null
return <PricingTiers plans={plans} currentPlanSlug={currentPlan?.slug} />
```

`<PricingTiers>` (client):

- Toggle сверху: «Месяц / Год» (MUI ToggleButtonGroup)
- 4 карточки (3 из БД + Custom hard-coded)
- Каждая карточка показывает:
  - Название
  - Цену (зависит от toggle): «150 ₽ / месяц» или «1 000 ₽ / год · 84 ₽/мес»
  - Список фич из `Plan.features`
  - CTA-кнопка по правилам:

| Currentplan  | Plan card    | CTA                                                                       |
| ------------ | ------------ | ------------------------------------------------------------------------- |
| (нет логина) | personal     | «Регистрация» → /sign-up                                                  |
| (нет логина) | pro/max      | «Купить» → /sign-in?redirect=/pricing&intent=purchase&plan=...&period=... |
| personal     | personal     | «Текущий тариф» (disabled)                                                |
| personal     | pro/max      | «Купить» → открывает CheckoutModal                                        |
| pro          | personal     | «Перейти» (downgrade — открывает confirm + cancel-flow)                   |
| pro          | pro          | «Текущий тариф» (disabled)                                                |
| pro          | max          | «Перейти на Max» → CheckoutModal                                          |
| max          | personal/pro | «Перейти» (downgrade)                                                     |
| max          | max          | «Текущий тариф» (disabled)                                                |

«Перейти» (downgrade) на Pro/Max → cancel current subscription (`cancelAtPeriodEnd=true`)
и сообщение «Подписка останется активной до DD.MM.YYYY, после — Personal». Без CheckoutModal.

Custom-карточка: «Связаться» → `/contact`.

### 5.2. `<CheckoutModal>` (client)

`apps/web/src/components/billing/checkout-modal.tsx`:

- Props: `{ planSlug, defaultPeriod, open, onClose }`
- Внутри: переключатель «Месяц / Год» (синхронизирован с `defaultPeriod`),
  итоговая сумма, описание, чекбокс «Принимаю условия [оферты](/oferta)»
- Кнопка «Оплатить N ₽»: вызывает tRPC `subscription.startCheckout`
- На success → `window.location.href = data.confirmationUrl`
- Состояния: idle / loading / error (читаемое сообщение из tRPC-ошибки)

Интеграция с pricing-страницей:

- Логин → клик «Купить» → `setCheckoutOpen({ planSlug, period })` → модалка
- Не залогинен → редирект на /sign-in?redirect=/pricing&intent=purchase&plan=...&period=...
- После логина — pricing-страница смотрит query-params и автооткрывает модалку

### 5.3. `/billing/return?orderId=...`

`apps/web/src/app/(protected)/billing/return/page.tsx` (Server Component):

- Проверяет `Order.userId === session.user.id`, иначе `notFound()`
- Передаёт `orderId` в `<OrderProgress orderId/>`

`<OrderProgress>` (client):

- TanStack Query: `trpc.subscription.getOrder.useQuery({ orderId }, { refetchInterval: 2000 })`
- Состояния:
  - `PENDING` ≤30с: спиннер «Обрабатываем оплату…»
  - `PAID`: ✓ «Оплата прошла успешно. Подписка активна до DD.MM.YYYY», кнопка «В рабочее пространство» → `/app`
  - `FAILED`: ✗ «Не удалось провести оплату. Попробуйте ещё раз», кнопка «Назад к тарифам» → /pricing
  - `PENDING` >30с: «Платёж в обработке. Уведомим, когда подтвердится», ссылка на `/settings/billing`

### 5.4. `/settings/billing` — кабинет подписки

`apps/web/src/app/(protected)/settings/billing/page.tsx` (полностью переписать):

Секции:

1. **Текущий тариф**:
   - Бейдж + название + статус
     - `ACTIVE && !cancelAtPeriodEnd`: «Активна, продление DD.MM.YYYY»
     - `ACTIVE && cancelAtPeriodEnd`: «Отменена, доступ до DD.MM.YYYY»
     - `EXPIRED`: «Истекла»
     - Personal: «Бесплатный тариф»
2. **Способ оплаты** (если есть paymentMethodId):
   - Иконка бренда + «\*\*\*\* N4N4N4N»
   - Кнопка «Изменить» — TBD (out of scope в v1; YooKassa требует new payment для смены карты)
3. **Управление подпиской**:
   - Personal → «Перейти на Pro» → /pricing
   - Pro/Max + ACTIVE + не отменена → «Отменить подписку» (confirm dialog)
   - Pro/Max + ACTIVE + отменена → «Возобновить подписку» (resume mutation)
4. **История платежей** (Order[]): таблица — дата, тариф, период, сумма, статус
5. **Сменить тариф** (внутри Pro/Max): кнопка-ссылка на /pricing

### 5.5. Лендинг

`apps/web/src/app/(about)/page.tsx:147-190` использует `landingPricingCards` из
`apps/web/src/components/public/content.ts`.

Переписать `landingPricingCards`:

- Personal — Бесплатно — основные фичи
- Pro — от 150 ₽/мес — основные фичи
- Max — от 1500 ₽/мес — основные фичи
- Custom — Связаться — для крупных компаний

Источник: маркетинговая копия в `content.ts`. Цены и slug-и совпадают с seed.ts по
соглашению; добавляем unit-тест, который читает seed plan rows и сверяет суммы с
`landingPricingCards`.

Каждая карточка кликабельна: ведёт на `/pricing` (без чекаута на лендинге).

### 5.6. Sidebar CTA

`workspace-sidebar.tsx` — под Chip-бейджем для Personal-юзера: маленькая ссылка
«Перейти на Pro» → `/pricing` (см. секцию 2.4).

### 5.7. `/oferta` placeholder

Новый файл `apps/web/src/app/(about)/oferta/page.tsx`:

- Server Component
- Контент: заголовок «Договор-оферта», placeholder-текст с пометкой `TODO: legal review`
- В чекаут-модалке ссылка `<Link href="/oferta">условия оферты</Link>`

---

## 6. Migration / Rollout

### 6.1. Single Prisma migration

```
packages/db/prisma/migrations/<timestamp>_subscription_plans/migration.sql
```

Содержание:

1. `ALTER TABLE Plan` — переименовать `priceMonthly` → `priceMonthlyKopecks`,
   добавить `priceYearlyKopecks` и capability flags
   (`chatsEnabled`, `pageIndexingEnabled`, `membersSettingsEnabled`,
   `aiSettingsEnabled`, `customMcpEnabled`, `prioritySupport`, `developerSpaceEnabled`)
2. `UPDATE Plan` — переименовать slugs и обновить значения по новой матрице (см. seed)
3. `ALTER TABLE Subscription` — добавить `billingPeriod`, `cancelAtPeriodEnd`,
   `paymentMethodId`, `paymentMethodLast4`, `paymentMethodBrand`, `expiredAt`
4. `CREATE TABLE Order`
5. `CREATE INDEX Subscription(currentPeriodEnd, status, cancelAtPeriodEnd)`
6. **AiModel data fix** (если нужно): `UPDATE AiModel SET minPlanSlug = 'pro'` для
   моделей, требующих Pro+. Существующая колонка не затрагивается.

### 6.2. Seed update

Обновить `packages/db/prisma/seed.ts` (см. раздел 1.6) — идемпотентный upsert
по slug.

### 6.3. Order rollout

1. Schema migration + seed
2. Default plan на регистрации `personal`
3. tRPC `subscription` расширение
4. UI: sidebar Chip + CTA, layout enforcement, AI model selector
5. Engines: BillingModule (Yookassa client + cron + CLI команды)
6. Webhook handler в apps/web
7. /pricing redesign + CheckoutModal + /billing/return
8. /settings/billing redesign
9. Лендинг — обновление `landingPricingCards`
10. /oferta placeholder
11. End-to-end тест: новый юзер → personal → /pricing → купить Pro (тестовый
    YooKassa shop) → webhook → ACTIVE → cancel → ждём `currentPeriodEnd` → cron
    expires → soft-downgrade → лишний workspace read-only

### 6.4. Тесты

- **Unit**: `subscription-renewal.service.spec.ts`, `refund.service.spec.ts`,
  `plan-features.service.spec.ts`, webhook handler tests
- **Integration**: tRPC `subscription.startCheckout` mocking YookassaClient
- **E2E (Playwright)**:
  - Новый юзер видит Personal-чип, /chats возвращает 404
  - Покупка Pro через mock-YookassaClient → юзер видит Pro-чип, /chats доступен
  - Cancel → ACTIVE остаётся, чип «отменена», /chats доступен до конца периода
  - Expire (forced cron-вызов) → soft-downgrade, лишние workspace read-only

### 6.5. Operational notes

- Тестовый shop YooKassa имеет sandbox payment_methods — добавить инструкцию в
  README.md (apps/engines или apps/web)
- Webhook URL для production: `https://<domain>/api/webhooks/yookassa` —
  зарегистрировать в личном кабинете YooKassa
- IP allowlist YooKassa: публикуется в их доке, обновляется не часто; брать актуальный
  список и положить в `YOOKASSA_TRUSTED_IPS`

---

## 7. Known limitations & follow-ups

| Тема                               | Статус                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| Custom MCP servers (Max)           | Marketing-only флаг; отдельный спек                                |
| Developer space + voting (Max)     | Marketing-only флаг; отдельный спек                                |
| Priority support routing           | Marketing-only флаг; отдельный спек                                |
| Proration при смене тарифа         | Не делаем; известное ограничение                                   |
| Email-уведомления                  | Зависит от транспорта; сейчас не настроен — отдельная задача       |
| User-facing рефанды                | Только CLI; UI — позже                                             |
| Смена карты в /settings/billing    | Только через новый payment в YooKassa; UI «Изменить карту» — позже |
| Юридический текст оферты           | Placeholder; ждём legal-review                                     |
| Backfill индексации после апгрейда | Маленькая задача в плане реализации                                |
