# Лимиты пространств: участники и хранилище

Дата: 2026-05-27
Статус: draft

## 1. Контекст

Сейчас тарифы в `Plan` определяют только `maxWorkspaces` и `maxMembersPerWorkspace` плюс feature-флаги. Лимита по объёму загружаемых файлов нет, а `max.maxWorkspaces = null` означает безлимит. Лимиты для пространства определяются динамически через `getWorkspaceFeatures(workspaceId)`, читая активную подписку владельца.

Бизнес-требования:

- ПРО: до 5 ГБ файлов в каждом пространстве (новый лимит).
- МАКС: до 10 пространств (было — безлимит), 20 участников, 20 ГБ файлов в каждом пространстве.
- Персональный (бесплатный): добавить 500 МБ на пространство.
- Лимиты пространства — расширяемые, кастомизируемые на уровне пространства и «переносятся» из тарифа в момент покупки.
- При изменении тарифа (вверх/вниз) — пере-синхронизация всех пространств, где пользователь владелец. Данные сверх лимита не удаляются — блокируются только новые загрузки/приглашения.
- Страница `/workspaces/{workspaceId}/settings/usage` с `LinearProgress` для участников и хранилища.
- Сообщение о достижении лимита + CTA: апгрейд тарифа (или контакт администрации для МАКС).
- Обновить `docs/terms/PublicOffer.md` и прочие места, где упоминаются лимиты.

## 2. Архитектура

### 2.1 Модель данных

**`Plan` (миграция, расширение):**

```prisma
model Plan {
  // ... существующие поля
  maxFileBytes BigInt @default(0) @map("max_file_bytes")
}
```

Сид-значения (`packages/db/prisma/seed.ts`):

| Slug     | maxWorkspaces | maxMembersPerWorkspace | maxFileBytes        |
| -------- | ------------- | ---------------------- | ------------------- |
| personal | 1             | 1                      | 524_288_000 (500 МБ)|
| pro      | 3             | 5                      | 5_368_709_120 (5 ГБ)|
| max      | 10            | 20                     | 21_474_836_480 (20 ГБ)|

Также в сиде обновляются буллеты `features`:

- personal: добавить «До 500 МБ файлов»
- pro: добавить «До 5 ГБ файлов на пространство»
- max: заменить «Неограниченное число пространств» на «До 10 пространств», добавить «До 20 ГБ файлов на пространство»

**`WorkspaceLimit` (новая таблица):**

```prisma
model WorkspaceLimit {
  workspaceId    String   @id @map("workspace_id") @db.Uuid
  maxMembers     Int      @map("max_members")
  maxFileBytes   BigInt   @map("max_file_bytes")
  sourcePlanSlug String?  @map("source_plan_slug") @db.VarChar(50)
  syncedAt       DateTime @map("synced_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace      Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@map("workspace_limits")
}
```

В `Workspace` добавляется обратная связь `limits WorkspaceLimit?`.

**Бэкфилл миграции:**

```sql
INSERT INTO workspace_limits (workspace_id, max_members, max_file_bytes, source_plan_slug, synced_at, created_at, updated_at)
SELECT
  w.id,
  COALESCE(p.max_members_per_workspace, personal.max_members_per_workspace),
  COALESCE(p.max_file_bytes, personal.max_file_bytes),
  COALESCE(p.slug, personal.slug),
  NOW(),
  NOW(),
  NOW()
FROM workspaces w
LEFT JOIN subscriptions s ON s.user_id = w.created_by_id AND s.status = 'ACTIVE'
LEFT JOIN plans p ON p.id = s.plan_id
CROSS JOIN (SELECT max_members_per_workspace, max_file_bytes, slug FROM plans WHERE slug = 'personal') personal
ON CONFLICT (workspace_id) DO NOTHING;
```

Workspace без `created_by_id` или с неактивной подпиской получают `personal`-лимиты.

### 2.2 Хелпер `syncWorkspaceLimits`

В `packages/trpc/src/helpers/plan.ts`:

```ts
export async function syncWorkspaceLimits(
  tx: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const plan = await resolveActivePlanOrPersonal(tx, userId)
  const workspaces = await tx.workspace.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  const now = new Date()
  await Promise.all(
    workspaces.map((w) =>
      tx.workspaceLimit.upsert({
        where: { workspaceId: w.id },
        create: {
          workspaceId: w.id,
          maxMembers: plan.maxMembersPerWorkspace,
          maxFileBytes: plan.maxFileBytes,
          sourcePlanSlug: plan.slug,
          syncedAt: now,
        },
        update: {
          maxMembers: plan.maxMembersPerWorkspace,
          maxFileBytes: plan.maxFileBytes,
          sourcePlanSlug: plan.slug,
          syncedAt: now,
        },
      }),
    ),
  )
}

async function resolveActivePlanOrPersonal(
  tx: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<Plan> {
  const sub = await tx.subscription.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  return sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { slug: 'personal' } }))
}
```

Используется в:

- `workspace.create` — после создания пространства, в той же транзакции.
- `handlePaymentSucceeded` (`packages/trpc/src/services/billing.ts`) — после `tx.subscription.update/create`.
- `handleRefundSucceeded` — после установки `EXPIRED`.
- `subscription-renewal.service.ts` (engines) — при изменении статуса подписки (`EXPIRED` или возврат в `ACTIVE`).

### 2.3 Enforcement

**Загрузка файлов** — `apps/web/src/app/api/files/upload/route.ts`:

```ts
if (kind === 'attachment') {
  const [usage, limits] = await Promise.all([
    prisma.file.aggregate({
      where: { workspaceId: workspaceIdParam!, status: FileStatus.ACTIVE },
      _sum: { fileSize: true },
    }),
    prisma.workspaceLimit.findUnique({ where: { workspaceId: workspaceIdParam! } }),
  ])
  if (!limits) {
    return Response.json({ error: 'WORKSPACE_LIMIT_MISSING' }, { status: 500 })
  }
  const used = usage._sum.fileSize ?? 0n
  if (used + BigInt(bytes.length) > limits.maxFileBytes) {
    return Response.json({ error: 'WORKSPACE_STORAGE_LIMIT' }, { status: 413 })
  }
}
```

Аватары (`kind === 'avatar'`, `workspaceId = null`) под лимит не попадают.

**Приглашение участника** — `packages/trpc/src/routers/workspace.ts` `inviteMember`:

```ts
const [memberCount, limits] = await Promise.all([
  ctx.prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
  ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: input.workspaceId } }),
])
if (limits && memberCount >= limits.maxMembers) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'WORKSPACE_MEMBER_LIMIT' })
}
```

Существующие участники сверх лимита не трогаются. `updateMemberRole` не блокируется.

**Создание пространства** — `workspace.create`:

- Существующая проверка `plan.maxWorkspaces` сохраняется.
- После `workspace.create` + `workspaceMember.create` + `userPreference.upsert` добавляется вызов `syncWorkspaceLimits(tx, ctx.user.id)`.

### 2.4 tRPC `workspace.getUsage`

В `packages/trpc/src/routers/workspace.ts`:

```ts
getUsage: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertRole(ctx, input.workspaceId, ['OWNER','ADMIN','EDITOR','COMMENTER','VIEWER','GUEST'])
    const [limits, memberCount, agg, workspace] = await Promise.all([
      ctx.prisma.workspaceLimit.findUnique({ where: { workspaceId: input.workspaceId } }),
      ctx.prisma.workspaceMember.count({ where: { workspaceId: input.workspaceId } }),
      ctx.prisma.file.aggregate({
        where: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE },
        _sum: { fileSize: true },
      }),
      ctx.prisma.workspace.findUniqueOrThrow({
        where: { id: input.workspaceId },
        select: { createdById: true },
      }),
    ])
    if (!limits) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'WORKSPACE_LIMIT_MISSING' })
    const ownerPlan = workspace.createdById
      ? await resolveActivePlanOrPersonal(ctx.prisma, workspace.createdById)
      : await ctx.prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return {
      limits: {
        maxMembers: limits.maxMembers,
        maxFileBytes: limits.maxFileBytes.toString(),
        sourcePlanSlug: limits.sourcePlanSlug,
      },
      usage: {
        memberCount,
        fileBytesUsed: (agg._sum.fileSize ?? 0n).toString(),
      },
      ownerPlanSlug: ownerPlan.slug,
    }
  }),
```

### 2.5 UI — страница `/workspaces/[workspaceId]/settings/usage`

**RSC `page.tsx`** в `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/usage/page.tsx`:

- Загружает `await getServerTRPC().workspace.getUsage({ workspaceId })`.
- Передаёт данные в клиентский компонент `<UsageView />`.

**Клиентский `usage-view.tsx`**:

- Две `Card`-секции (используем `Stack` из `@repo/ui/components`).
- Заголовок секции, основная строка («X из Y», «3.2 ГБ из 5 ГБ»), `LinearProgress determinate`, подсказка.
- Цвет прогресса по `value`:
  - `< 80%` — `primary`
  - `80–100%` — `warning`
  - `≥ 100%` — `error`
- Над всем — `<OverLimitAlert>` если хотя бы один лимит достигнут. Внутри:
  - Текст «Достигнут лимит. Удалите ненужные файлы/участников или повысьте тариф.»
  - Кнопка `«Перейти на старший тариф»` → `/billing` (если `ownerPlanSlug !== 'max'`).
  - Кнопка `«Связаться с администрацией»` → `mailto:anynote@yandex.ru` (если `ownerPlanSlug === 'max'`).

**Утилита форматирования** — `apps/web/src/lib/format-bytes.ts`:

```ts
export function formatBytes(bytes: bigint | number, fractionDigits = 1): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(fractionDigits)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(fractionDigits)} МБ`
  return `${(n / 1024 ** 3).toFixed(fractionDigits)} ГБ`
}
```

**Навигация:** добавить пункт «Использование» в side-навигации настроек (`settings/layout.tsx` или общий nav-компонент). Доступен всем участникам (read-only данные).

### 2.6 Toasts/UX для ошибок

- Upload-route `413 WORKSPACE_STORAGE_LIMIT` — клиент показывает toast «Достигнут лимит на хранилище. Освободите место в Settings → Использование или повысьте тариф.» (искать места, где есть существующая обработка ошибок аплоада — обычно `useUploadAttachment`/`useFileUpload`).
- `inviteMember` `FORBIDDEN: WORKSPACE_MEMBER_LIMIT` — обработать в форме приглашения (`members/`-страница), показать понятную ошибку.

### 2.7 Обновление текстов и legal-документов

**`docs/terms/PublicOffer.md`:**

- В разделе с тарифами (около строки 327 и других мест) обновить значения лимитов:
  - ПРО: до 3 пространств, до 5 участников, до 5 ГБ файлов в пространстве.
  - МАКС: до 10 пространств, до 20 участников, до 20 ГБ файлов в пространстве.
  - Персональный: 1 пространство, 1 участник, до 500 МБ файлов.
- Обновить дату редакции на сегодняшнюю (2026-05-27).
- При наличии в `apps/web/src/lib/legal-documents.ts` поля `version` для `PUBLIC_OFFER` — увеличить версию (это вызовет повторный консент у пользователей).

**`apps/web/src/components/billing/pricing-tiers.tsx`:**

- Заменить хардкод «Неограниченное число пространств» на «До 10 пространств».
- Убедиться, что буллеты из `plan.features` JSON выводятся корректно — если они читаются из БД, достаточно обновить сид и переcидить локально.

**Главная (`apps/web/src/components/public/home/home-pricing.tsx` или похожее):**

- Если есть статический список фич — синхронизировать с новыми буллетами.

## 3. Тестирование

**Unit tests (vitest, `packages/trpc/test/`):**

- `syncWorkspaceLimits.test.ts`:
  - Owner с активной подпиской pro → лимиты pro.
  - Owner без активной подписки → personal-лимиты.
  - Несколько пространств одного владельца — все обновляются в одной транзакции.
  - Идемпотентность: повторный вызов не падает.
- `workspace.getUsage.test.ts`:
  - Возвращает корректные `limits`, `usage`, `ownerPlanSlug`.
  - Сериализует `fileBytesUsed`/`maxFileBytes` как строки.
- `workspace.inviteMember.test.ts`:
  - Блокирует при `memberCount >= maxMembers`.
- Расширить `billing.test.ts` (если есть) или добавить — проверка вызова `syncWorkspaceLimits` после успешной оплаты.

**Unit tests (apps/web vitest):**

- `format-bytes.test.ts` — округление и единицы.
- Если есть тесты на upload-route — добавить кейс с превышением storage-лимита (`413`).

**E2E (`apps/e2e/`):**

- `workspace-usage.spec.ts`:
  - Создать пользователя на personal, открыть `/workspaces/{id}/settings/usage`, увидеть «0 из 1» и «0 МБ из 500 МБ».
  - LinearProgress отрендерен.

**Миграция:** проверка вручную или прогон сида в чистой БД.

## 4. План реализации (Build order)

1. **Schema + миграция** — Prisma модель `WorkspaceLimit`, поле `Plan.maxFileBytes`, миграция с бэкфиллом.
2. **Seed + хелперы** — обновить `seed.ts`, добавить `syncWorkspaceLimits` + `resolveActivePlanOrPersonal` в `helpers/plan.ts`, тесты.
3. **Хук в billing-flow** — `handlePaymentSucceeded`, `handleRefundSucceeded`, `subscription-renewal.service.ts`, `workspace.create`. Тесты.
4. **Enforcement** — upload-route (storage), `inviteMember` (members). Тесты.
5. **tRPC `workspace.getUsage`** — процедура + тесты.
6. **UI usage-страница** — RSC + клиентский view + утилита formatBytes + навигация. Smoke-проверка вручную.
7. **Legal + UI-тексты** — `PublicOffer.md` (дата + лимиты), `legal-documents.ts` (version), `pricing-tiers.tsx`, home-pricing.
8. **E2E** — `workspace-usage.spec.ts`.

## 5. Out-of-scope / явные YAGNI

- Передача владельца пространства другому пользователю (отдельная фича, потребует ре-синхронизации лимитов на нового owner).
- Per-page или per-attachment storage-лимиты (только агрегат по пространству).
- Soft-delete файлов с грейс-периодом (deleted-файлы не учитываются по требованию «не удаляем данные»).
- Пер-пользовательский лимит по числу пространств — оставлен в `Plan`, не дублируется в `WorkspaceLimit`.
- Уведомления по достижении 80% — пока не входит в этот спек (можно добавить позже как notification-event).
