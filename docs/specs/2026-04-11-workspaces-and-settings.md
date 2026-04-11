# Design: Workspaces and Settings

**Date:** 2026-04-11
**Status:** Approved for implementation
**Scope:** Database merge (subset of `docs/database.md`), `/settings/*` pages, `/workspaces/*` pages, Notion-style onboarding page

---

## 1. Goals

1. Merge a **minimal subset** of the Notion-style schema from `docs/database.md` into `packages/db/prisma/schema.prisma` — only tables required by the UI in this iteration.
2. Add two domains that are **not** in `docs/database.md`: user-facing integrations (OAuth providers) and plan/subscription billing.
3. Build a `(protected)` route group in `apps/web/src/app/` with a single `requireSession()` gate and a shared `<TRPCReactProvider>`, housing `/app`, `/settings/*`, and `/workspaces/*`.
4. Build `/settings/{general,account,billing,integrations}` with a shared 2-pane shell (left nav + content).
5. Build `/workspaces/new` and `/workspaces/[workspaceId]` with a Notion-style onboarding page (3-column dark layout).
6. Enforce the "Free plan = 1 workspace" limit at the application layer.

## 2. Explicitly out of scope

- `Block`, `Database`, `DatabaseView`, `Comment*`, `Revision`, `SearchDocument`, `ActivityLog`, `Job`, `Automation`, `Template`, `LinkEdge`, `Mention`, `Formula`, `Rollup` — postponed to the editor iteration.
- `pgvector` extension and `SearchDocument.embedding` — postponed. `compose.yml` Postgres image stays `postgres:16-alpine`.
- Real OAuth flows for integrations — this iteration renders UI, writes `integrations` rows with `PENDING`/placeholder credentials, and shows "OAuth coming soon" in the modal.
- Real payment gateway (Stripe / ЮKassa) — UI and schema only. `subscriptions.paymentProvider` stays null for FREE, the "Upgrade" button is a placeholder.
- Email transport for `changeEmail`, password reset, and notifications — stays as-is (throws in production, logs in development, matching existing `sendResetPassword` behavior in `packages/auth/src/auth.ts`).
- Block-level editor, real page content, page sharing/permissions, realtime collaboration.

## 3. Schema changes

### 3.1 New enums

```prisma
enum RoleType {
  OWNER
  ADMIN
  EDITOR
  COMMENTER
  VIEWER
  GUEST
}

enum ParentType {
  WORKSPACE
  PAGE
  DATABASE
  BLOCK
}

enum IntegrationScope {
  USER        // привязка интеграции к персональному аккаунту (yandex, github, telegram)
  WORKSPACE   // привязка к workspace (AmoCRM, MangoOffice)
  BOTH        // провайдер поддерживает оба режима, выбирается при подключении
}

enum IntegrationStatus {
  PENDING
  CONNECTED
  DISCONNECTED
  ERROR
}

enum SubscriptionStatus {
  TRIAL
  ACTIVE
  CANCELED
  EXPIRED
  PAST_DUE
}
```

### 3.2 New models

#### `Workspace`

```prisma
model Workspace {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String   @db.VarChar(255)
  slug        String?  @unique @db.VarChar(255)
  icon        String?  @db.VarChar(64)  // emoji or icon slug
  createdById String?  @map("created_by_id") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  createdBy        User?             @relation("WorkspaceCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  members          WorkspaceMember[]
  pages            Page[]
  workspaceIntegrations Integration[] @relation("WorkspaceIntegrations")
  defaultForUsers  UserPreference[]  @relation("DefaultWorkspace")

  @@index([createdById])
  @@map("workspaces")
}
```

- Uses `uuid v4` via `gen_random_uuid()`. Rationale: existing schema uses `uuid(7)` inline default which is a Prisma-7 feature — but mixing it with the `pgcrypto`-backed `gen_random_uuid()` for this iteration keeps the migration reviewable. **Decision during implementation:** match whatever default form the existing schema uses. If the rest of the repo is on `uuid(7)`, switch all new models to it.
- `name` is required; `slug` is optional in this iteration (no slug-based routing yet).
- `createdById` is **for audit only** — ownership is determined via `WorkspaceMember.role = OWNER`.

#### `WorkspaceMember`

```prisma
model WorkspaceMember {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  role        RoleType
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([workspaceId])
  @@index([userId])
  @@index([userId, role])
  @@map("workspace_members")
}
```

- `@@index([userId, role])` supports the free-plan enforcement query: "how many workspaces does this user own?"

#### `Page` (skeleton only)

```prisma
model Page {
  id            String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String     @map("workspace_id") @db.Uuid
  parentType    ParentType @map("parent_type")
  parentId      String?    @map("parent_id") @db.Uuid
  title         String?    @db.Text
  icon          String?    @db.Text
  coverUrl      String?    @map("cover_url") @db.Text
  isDatabaseRow Boolean    @default(false) @map("is_database_row")
  archived      Boolean    @default(false)
  deletedAt     DateTime?  @map("deleted_at") @db.Timestamptz(6)
  createdById   String?    @map("created_by_id") @db.Uuid
  updatedById   String?    @map("updated_by_id") @db.Uuid
  createdAt     DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy   User?     @relation("PageCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  updatedBy   User?     @relation("PageUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)

  @@index([workspaceId])
  @@index([parentType, parentId])
  @@index([archived])
  @@map("pages")
}
```

- Portability table. **This iteration does not read or write `pages`.** Included so the next iteration (editor) doesn't have to rewrite its parent's migration.
- Relations to `Block`, `PagePermission`, `DatabaseRow`, `PropertyValue`, `Comment`, `Favorite`, `RecentPage`, `Revision`, `Template` are **omitted** (those models don't exist yet). They'll be added in the editor iteration.

#### `UserPreference`

```prisma
model UserPreference {
  id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId                String    @unique @map("user_id") @db.Uuid
  theme                 String?   @db.VarChar(16)  // 'light' | 'dark' | 'system'
  locale                String?   @db.VarChar(16)
  defaultWorkspaceId    String?   @map("default_workspace_id") @db.Uuid
  notificationSettings  Json?     @map("notification_settings")
  createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt             DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  user              User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  defaultWorkspace  Workspace? @relation("DefaultWorkspace", fields: [defaultWorkspaceId], references: [id], onDelete: SetNull)

  @@index([defaultWorkspaceId])
  @@map("user_preferences")
}
```

- Dropped `startPageId`, `sidebarState`, `editorSettings` from `docs/database.md` — not used by any UI in this iteration. Will be added later if needed.
- `notificationSettings` jsonb shape (validated by Zod, not DB):

  ```ts
  {
    email: {
      mentions: boolean,
      comments: boolean,
      weeklyDigest: boolean,
    }
  }
  ```

#### `IntegrationProvider`

```prisma
model IntegrationProvider {
  id           String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug         String            @unique @db.VarChar(50)
  name         String            @db.VarChar(100)
  description  String?           @db.Text
  iconUrl      String?           @map("icon_url") @db.Text
  scope        IntegrationScope
  isEnabled    Boolean           @default(true) @map("is_enabled")
  configSchema Json?             @map("config_schema")
  sortOrder    Int               @default(0) @map("sort_order")
  createdAt    DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime          @updatedAt @map("updated_at") @db.Timestamptz(6)

  integrations Integration[]

  @@map("integration_providers")
}
```

**Seed (in the initial migration):**

| slug           | name         | scope     | description                                     |
| -------------- | ------------ | --------- | ----------------------------------------------- |
| `yandex`       | Yandex       | USER      | Личный аккаунт Яндекс (диск, почта, календарь)  |
| `github`       | GitHub       | USER      | Личный GitHub — репозитории, issues, PRs        |
| `telegram`     | Telegram     | USER      | Личный Telegram для уведомлений                 |
| `amocrm`       | AmoCRM       | WORKSPACE | CRM для workspace — сделки, контакты            |
| `mango_office` | MangoOffice  | WORKSPACE | Облачная телефония MangoOffice                  |

#### `Integration`

```prisma
model Integration {
  id           String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  providerId   String             @map("provider_id") @db.Uuid
  scope        IntegrationScope
  userId       String?            @map("user_id") @db.Uuid
  workspaceId  String?            @map("workspace_id") @db.Uuid
  status       IntegrationStatus  @default(PENDING)
  externalId   String?            @map("external_id") @db.VarChar(255)
  config       Json?
  credentials  Json?              // зашифрованные токены, в этой итерации всегда null
  connectedAt  DateTime?          @map("connected_at") @db.Timestamptz(6)
  lastSyncAt   DateTime?          @map("last_sync_at") @db.Timestamptz(6)
  errorMessage String?            @map("error_message") @db.Text
  createdAt    DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  provider  IntegrationProvider @relation(fields: [providerId], references: [id], onDelete: Restrict)
  user      User?               @relation("UserIntegrations", fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace?          @relation("WorkspaceIntegrations", fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([providerId])
  @@index([userId])
  @@index([workspaceId])
  @@index([status])
  @@map("integrations")
}
```

**CHECK constraint added via raw SQL in the migration:**

```sql
ALTER TABLE integrations ADD CONSTRAINT integrations_scope_target_check CHECK (
  (scope = 'USER'      AND user_id IS NOT NULL AND workspace_id IS NULL)
  OR
  (scope = 'WORKSPACE' AND workspace_id IS NOT NULL AND user_id IS NULL)
);
```

**Partial unique indexes (raw SQL):**

```sql
CREATE UNIQUE INDEX integrations_user_provider_unique
  ON integrations (provider_id, user_id)
  WHERE scope = 'USER' AND status IN ('PENDING', 'CONNECTED');

CREATE UNIQUE INDEX integrations_workspace_provider_unique
  ON integrations (provider_id, workspace_id)
  WHERE scope = 'WORKSPACE' AND status IN ('PENDING', 'CONNECTED');
```

Rationale: a user can connect GitHub exactly once, but can reconnect after disconnecting (the old DISCONNECTED row stays for history).

#### `Plan`

```prisma
model Plan {
  id                     String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug                   String        @unique @db.VarChar(50)
  name                   String        @db.VarChar(100)
  description            String?       @db.Text
  priceMonthly           Int           @default(0) @map("price_monthly")  // minor units (kopeks)
  currency               String        @default("RUB") @db.VarChar(3)
  maxWorkspaces          Int?          @map("max_workspaces")              // null = unlimited
  maxMembersPerWorkspace Int?          @map("max_members_per_workspace")
  features               Json          @default("[]")
  isActive               Boolean       @default(true) @map("is_active")
  sortOrder              Int           @default(0) @map("sort_order")
  createdAt              DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)

  subscriptions Subscription[]

  @@map("plans")
}
```

**Seed (in the initial migration):**

| slug        | name        | priceMonthly | maxWorkspaces | maxMembers | features                                             |
| ----------- | ----------- | ------------ | ------------- | ---------- | ---------------------------------------------------- |
| `free`      | Free        | 0            | 1             | 1          | `["Одно пространство", "Базовый редактор"]`          |
| `personal`  | Personal    | 39000 (390₽) | 5             | 1          | `["5 пространств", "История версий", "AI поиск"]`    |
| `corporate` | Corporate   | 149000 (1490₽) | null        | null       | `["∞ пространств", "Команды", "SSO", "Приоритет"]`   |

#### `Subscription`

```prisma
model Subscription {
  id                     String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId                 String             @map("user_id") @db.Uuid
  planId                 String             @map("plan_id") @db.Uuid
  status                 SubscriptionStatus @default(ACTIVE)
  startedAt              DateTime           @default(now()) @map("started_at") @db.Timestamptz(6)
  currentPeriodEnd       DateTime?          @map("current_period_end") @db.Timestamptz(6)
  canceledAt             DateTime?          @map("canceled_at") @db.Timestamptz(6)
  paymentProvider        String?            @map("payment_provider") @db.VarChar(32)
  providerSubscriptionId String?            @map("provider_subscription_id") @db.VarChar(255)
  amountPaid             Int?               @map("amount_paid")
  currency               String?            @db.VarChar(3)
  metadata               Json?
  createdAt              DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt              DateTime           @updatedAt @map("updated_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan Plan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@index([userId])
  @@index([planId])
  @@index([userId, status])
  @@map("subscriptions")
}
```

**Partial unique index (raw SQL):**

```sql
CREATE UNIQUE INDEX subscriptions_one_active_per_user
  ON subscriptions (user_id)
  WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE');
```

- Guarantees there's never more than one "current" subscription per user. Canceled/expired rows accumulate as history.

**Data migration (in the same migration file, after table creation):**

```sql
-- Give every existing user a FREE subscription.
INSERT INTO subscriptions (id, user_id, plan_id, status, started_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  u.id,
  (SELECT id FROM plans WHERE slug = 'free'),
  'ACTIVE',
  now(),
  now(),
  now()
FROM users u;

-- And an empty user_preferences row.
INSERT INTO user_preferences (id, user_id, created_at, updated_at)
SELECT gen_random_uuid(), u.id, now(), now() FROM users u;
```

### 3.3 Changes to existing `User` model

The `User` model (in `packages/db/prisma/schema.prisma`) gets new back-relations — no new columns:

```prisma
model User {
  // ... existing fields unchanged ...

  createdWorkspaces      Workspace[]       @relation("WorkspaceCreatedBy")
  workspaceMemberships   WorkspaceMember[]
  preferences            UserPreference?
  userIntegrations       Integration[]     @relation("UserIntegrations")
  subscriptions          Subscription[]
  createdPages           Page[]            @relation("PageCreatedBy")
  updatedPages           Page[]            @relation("PageUpdatedBy")
}
```

## 4. URL structure (route group `(protected)`)

```
apps/web/src/app/
├── (about)/              ← public, unchanged
├── (auth)/               ← redirect-if-logged-in, unchanged
├── (protected)/          ← NEW: auth gate + <TRPCReactProvider>
│   ├── layout.tsx                   ← requireSession() + <TRPCReactProvider>
│   ├── app/
│   │   └── page.tsx                 → /app                            (moved from apps/web/src/app/app/page.tsx)
│   ├── settings/
│   │   ├── layout.tsx               ← 2-pane shell (left nav + children)
│   │   ├── general/page.tsx         → /settings/general
│   │   ├── account/page.tsx         → /settings/account
│   │   ├── billing/page.tsx         → /settings/billing
│   │   └── integrations/page.tsx    → /settings/integrations
│   └── workspaces/
│       ├── new/page.tsx             → /workspaces/new
│       └── [workspaceId]/
│           ├── layout.tsx           ← dark theme forced, 3-col layout
│           └── page.tsx             → /workspaces/:id  (onboarding)
├── api/
├── layout.tsx (root)                ← only <UiProvider> + fonts, no auth, no trpc
├── page.tsx (/)
└── ...
```

**Migration from current state:**

- Current: `apps/web/src/app/app/layout.tsx` calls `requireSession()` and wraps children in `<TRPCReactProvider>`; `apps/web/src/app/app/page.tsx` renders the dashboard.
- Target: move both files under `app/(protected)/app/`. Delete the local `layout.tsx` (or leave it empty) — auth and tRPC are now in the parent `(protected)/layout.tsx`.

**`(protected)/layout.tsx` content sketch:**

```tsx
import type { ReactNode } from "react"
import { requireSession } from "@/lib/get-session"
import { TRPCReactProvider } from "@/trpc/client"

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return <TRPCReactProvider>{children}</TRPCReactProvider>
}
```

Everything else in `(protected)/*` can assume the session exists and that the tRPC client is mounted.

## 5. Settings pages

### 5.1 Shared layout `(protected)/settings/layout.tsx`

2-pane MUI Grid:

- **Left (260px, `Paper`)** — user card (avatar, name, email), section label "НАСТРОЙКИ", nav list with 4 items, "← Вернуться в workspace" link at top.
- **Right (flex)** — `children`.
- Page-level `Container maxWidth="lg"` to cap the total width. Active nav item detected via `usePathname()` in a client component (`SettingsNav`).

### 5.2 `/settings/general` (`GeneralSettingsPage`)

Sections (each a `Paper` card):

1. **Profile**
   - Avatar block — placeholder only. Upload/remove buttons are rendered but wired to a toast "Загрузка файлов скоро" because MinIO/S3 presigned-upload plumbing is out of scope for this iteration. The avatar itself renders `user.image` if set (already a column on the existing `User` model) or falls back to gradient + initials.
   - First name + last name inputs → `trpc.user.updateProfile.mutate({ firstName, lastName })`.
   - Email input + `emailVerified` badge + "Изменить" button. On click, a modal opens asking for the new email address. Submission calls the better-auth change-email endpoint (whichever the installed 1.4.9 build ships — see Risks §14). Until SMTP is wired, this throws in production and logs a confirmation link in development, matching existing `sendResetPassword` behavior.
2. **Theme**
   - 3 cards: Светлая / Тёмная / Системная, active border = primary.
   - On click → `trpc.user.setTheme.mutate({ theme })` → server writes `user_preferences.theme`, sets a `theme` cookie (`Set-Cookie` in the mutation response header via Next route handler) and refreshes.
3. **Notifications**
   - 3 `Switch` controls wired to a single form `{ mentions, comments, weeklyDigest }`.
   - `trpc.user.setNotificationSettings.mutate(...)` writes the jsonb.

### 5.3 `/settings/account`

- Top: "Выйти из системы" button (destructive), calls `authClient.signOut()` → `router.push('/sign-in')`.
- Table of active sessions (`@mui/material` `Table`):
  - Columns: Устройство (parsed from `user_agent`), IP (`ip_address`), Последняя активность (`updatedAt`, relative), Действие.
  - Current session row shows a "Эта сессия" chip instead of "Завершить".
  - "Завершить" calls `trpc.user.revokeSession.mutate({ sessionId })` → `prisma.session.delete` → `router.refresh()`.
- User-agent parsing: use a tiny inline parser (no new dependency) matching `/(Chrome|Firefox|Safari|Edge)/` for browser and `/(Mac|Windows|Linux|iPhone|Android)/` for OS. If it returns nothing, show "Unknown".

### 5.4 `/settings/billing`

- **Current plan card**
  - Reads `trpc.subscription.getCurrent.query()` → `{ plan: Plan, subscription: Subscription }`.
  - Shows plan name, price, `maxWorkspaces`, features list, "Обновить тариф" button (placeholder — on click shows a toast "Оплата скоро").
- **History table**
  - `trpc.subscription.listHistory.query()` → `Subscription[]` ordered by `startedAt DESC`.
  - Columns: Тариф, Период (`startedAt → currentPeriodEnd ?? canceledAt ?? "—"`), Сумма, Статус, Оплачен через.

### 5.5 `/settings/integrations`

- Grid of `Card`s, one per row in `integration_providers` (ordered by `sortOrder`).
- Each card shows: icon (MUI icon mapped from `slug`), name, description, scope chip, status chip (derived from matching `integrations` row for `{ userId: session.user.id }` for USER scope, or `{ workspaceId: defaultWorkspaceId }` for WORKSPACE scope).
- "Подключить" / "Отключить" button:
  - Connect: shows a modal "OAuth скоро. Сохранить как PENDING?" → creates `integrations` row with `status = PENDING`.
  - Disconnect: updates row to `status = DISCONNECTED`.
- **No-workspace edge case:** if the user has no default workspace, WORKSPACE-scope cards show status chip "Требуется рабочее пространство" and the button becomes a link to `/workspaces/new`. USER-scope cards are unaffected.

## 6. Workspaces pages

### 6.1 `/workspaces/new` (`NewWorkspacePage`)

Centered form (server component wrapping a client form):

- Inputs: name (required, 1-64 chars), icon (optional emoji picker — simple string for now).
- Submit → `trpc.workspace.create.mutate({ name, icon })`.
- On success → `redirect('/workspaces/${newId}')`.

**Mutation flow (server):**

```ts
async function createWorkspace({ input, ctx }) {
  const userId = ctx.user.id
  // Enforce plan limit
  const activePlan = await getActivePlanForUser(userId)
  if (activePlan.maxWorkspaces !== null) {
    const ownedCount = await ctx.prisma.workspaceMember.count({
      where: { userId, role: "OWNER" },
    })
    if (ownedCount >= activePlan.maxWorkspaces) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `На тарифе ${activePlan.name} можно создать не больше ${activePlan.maxWorkspaces} пространств`,
      })
    }
  }

  // Transaction: create workspace + owner membership + default pref
  return ctx.prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: { name: input.name, icon: input.icon, createdById: userId },
    })
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: "OWNER" },
    })
    await tx.userPreference.upsert({
      where: { userId },
      create: { userId, defaultWorkspaceId: workspace.id },
      update: { defaultWorkspaceId: workspace.id },
    })
    return workspace
  })
}
```

### 6.2 `/workspaces/[workspaceId]` (`WorkspacePage`)

**Guard in the layout (server):**

```ts
// (protected)/workspaces/[workspaceId]/layout.tsx
export default async function WorkspaceLayout({ params, children }) {
  const { workspaceId } = await params
  const session = await getSession()  // already guaranteed by (protected)
  const workspace = await getServerTRPC().workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  // RLS: workspace.getById already filters by workspace_members.user_id = session.user.id
  return <WorkspaceShell workspace={workspace}>{children}</WorkspaceShell>
}
```

**Entry point `/app` redirect logic:**

`(protected)/app/page.tsx` — on render:

```ts
// session is guaranteed by the parent (protected)/layout.tsx
const prefs = await getServerTRPC().user.getPreferences()
if (!prefs?.defaultWorkspaceId) redirect("/workspaces/new")
redirect(`/workspaces/${prefs.defaultWorkspaceId}`)
```

So `/app` is always a redirect; the real landing page is `/workspaces/:id`.

**Users with no default workspace hitting `/settings/*` directly.** `(protected)/layout.tsx` gates on session but not on default workspace — a user who deletes their only workspace and navigates to `/settings/integrations` will have `defaultWorkspaceId = null`. Handling:

- `/settings/general`, `/settings/account`, `/settings/billing` — all continue to work (they don't need a workspace).
- `/settings/integrations` — for WORKSPACE-scope providers, the card shows status "Требуется рабочее пространство" and the connect button links to `/workspaces/new` instead of opening the modal. USER-scope providers still work normally.

### 6.3 Notion-style onboarding page layout

**Forced dark theme** for this one route (CSS override in `WorkspaceShell`), regardless of `user_preferences.theme`. Rationale: the brief explicitly says dark; mixing light onboarding with dark wireframe would look wrong.

**Structure (from the approved wireframe):**

- Root: 100vh, `display: grid`, `gridTemplateColumns: '240px 1fr 340px'`, background `#0c0d10`.

- **Left sidebar** (`WorkspaceSidebar`, client component)
  - Top: workspace title + icon + plan chip, dropdown arrow (placeholder).
  - Nav list: Поиск / Главная / Настройки. "Настройки" links to `/settings/general`.
  - Section "СТРАНИЦЫ": static item "👋 Welcome to AnyNote" (active), "+ Новая страница" (disabled placeholder, click → toast "Скоро").
  - Bottom: "🗑 Корзина" (disabled placeholder).
  - Border-right `#1e2024`.

- **Center** (`WorkspaceMain`, server component, content is static)
  - Toolbar row: breadcrumb "👋 Welcome to AnyNote · Private · Edited 2m ago · Share · ⋯ · + New AI chat". All buttons are placeholders.
  - Body: centered 480px column, `pt: 10`, emoji `👋` (40px), H1 "Welcome to AnyNote", checklist of 10 items:
    1. ✓ Create your first page (checked)
    2. ✓ Pick a workspace icon (checked)
    3. ☐ Try a slash command — type `/heading` on a blank line
    4. ☐ Import notes from Notion or Obsidian
    5. ☐ Upload a file or image with drag-and-drop
    6. ☐ Connect an integration (GitHub, Telegram, AmoCRM)
    7. ▸ Advanced: databases, views, filters (toggle row)
    8. ☐ Share a page with a public link
    9. ☐ Ask AI about your docs — `/ask`
    10. ☐ Invite a teammate
  - `/heading` and `/ask` are wrapped in an inline `<code>`-like pill (purple background, monospace).

- **Right sidebar** (`WorkspaceAiPanel`, client component, all placeholders)
  - Header row: "✨ AI assistant", `⋯` on the right.
  - Bottom: welcome block — 44px gradient circle, "Hi, I'm Ani", 1 line description.
  - Input card: bordered, dark background, placeholder "Summarize my notes from last week...", bottom row "Auto mode ⌄" + send button. Textarea is disabled.

- **Cookie banner** (`CookieBanner`, client component)
  - Floating at bottom center, dark pill (`#17191d`), 3 actions: Settings / Reject / Accept all. Stores dismissal in `localStorage.cookiesAccepted`. Displayed only if not already accepted.

All of the above is **hardcoded JSX**. No `Block`/`Page` DB reads. `workspace.name` and `workspace.icon` come from the layout loader.

## 7. tRPC router layout

Extend `packages/trpc/src/index.ts` (currently a single flat router with `health` and `users`). Refactor into namespaces:

```ts
export const appRouter = t.router({
  health: healthRouter,
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
})
```

**`userRouter` procedures:**
- `getPreferences()` → `UserPreference | null`
- `setTheme({ theme })` → writes `user_preferences.theme` + returns new theme
- `setNotificationSettings(payload)` → writes jsonb
- `updateProfile({ firstName, lastName })` → writes `users`
- `listSessions()` → active sessions for current user
- `revokeSession({ sessionId })` → delete session (disallow revoking current)

**`workspaceRouter` procedures:**
- `create({ name, icon })` → flow above
- `getById({ id })` → filters by `workspace_members.userId = session.user.id`
- `listMine()` → workspaces where the user is a member
- `getDefault()` → convenience for the `/app` redirect

**`subscriptionRouter` procedures:**
- `getCurrent()` → active `{ plan, subscription }`
- `listHistory()` → ordered by `startedAt DESC`

**`integrationRouter` procedures:**
- `listProviders()` → all enabled providers
- `listMine()` → combines user + workspace integrations for a given workspaceId
- `connect({ providerId, scope, workspaceId? })` → creates `integrations` row with `status = PENDING`
- `disconnect({ integrationId })` → updates to `DISCONNECTED`

## 8. Theme persistence flow (hybrid A3)

1. **Server read in root layout** (`app/layout.tsx`):
   - If session exists → `getServerTRPC().user.getPreferences()` → use `preferences.theme` as the source of truth.
   - Otherwise → read `theme` cookie.
   - Fallback → `"system"`.
   - Pass resolved theme into `<UiProvider mode={theme}>`.

2. **Client toggle** (`/settings/general`):
   - Calls `trpc.user.setTheme.mutate({ theme })` — server writes DB + sets `theme` cookie via a new Next route handler (or via Next 16 `cookies()` mutation inside the tRPC procedure).
   - Then `router.refresh()` — the root layout re-reads with the new theme.

3. **Guest users** → only the cookie path. No DB read.

## 9. Seeding

New file: `packages/db/prisma/seed.ts`. Idempotent — uses `upsert` so running it twice is safe. Invoked:

1. Automatically via `prisma.config.ts` after `prisma migrate dev`. If Prisma 7 still uses `prisma/seed.ts` convention, wire it via `package.json` `"prisma": { "seed": "tsx prisma/seed.ts" }` inside `packages/db`.
2. Manually via `pnpm --filter @repo/db prisma:seed`.

The seed covers:
- 5 integration providers (idempotent `upsert` by `slug`).
- 3 plans (idempotent `upsert` by `slug`).

**Note:** the migration's inline `INSERT` for `subscriptions` handles pre-existing users once, at migration time. The seed script does not need to do it.

## 10. Free-plan enforcement

Enforced **only** in `workspace.create` mutation (see §6.1). Not a DB constraint — constraints can't reach subscription data.

Helper: `packages/trpc/src/helpers/plan.ts`

```ts
export async function getActivePlanForUser(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
    include: { plan: true },
    orderBy: { startedAt: "desc" },
  })
  if (!sub) throw new Error(`User ${userId} has no active subscription`)
  return sub.plan
}
```

All new users get a FREE subscription via the migration; signup-created users (after this migration) must also get one — either via a better-auth `databaseHooks.user.create.after` hook in `packages/auth/src/auth.ts` or via a wrapper around `authClient.signUp`. The hook is cleaner and keeps the invariant "every user has one active subscription" enforceable.

**Add to `packages/auth/src/auth.ts`:**

```ts
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        const freePlan = await prisma.plan.findUniqueOrThrow({ where: { slug: "free" } })
        await prisma.subscription.create({
          data: { userId: user.id, planId: freePlan.id, status: "ACTIVE" },
        })
        await prisma.userPreference.upsert({
          where: { userId: user.id },
          create: { userId: user.id },
          update: {},
        })
      },
    },
  },
},
```

## 11. Testing

**Minimum viable coverage for this iteration:**

1. **Prisma schema compiles** — `pnpm --filter @repo/db prisma:generate` runs without errors.
2. **Migration applies cleanly** — run migration against a fresh DB, verify all tables, enums, CHECK constraints, partial indexes exist via `\d+ integrations` / `\d+ subscriptions`.
3. **Seed idempotency** — run seed twice, verify no duplicate providers/plans.
4. **`pnpm lint`**, **`pnpm check-types`**, **`pnpm build`** all green.
5. **Smoke test via curl** (dev server):
   - GET `/` → 200
   - GET `/app` (unauthenticated) → 307 → `/sign-in`
   - GET `/workspaces/new` (unauthenticated) → 307 → `/sign-in`
6. **Playwright** (in `apps/e2e/`): new spec `workspace-flow.spec.ts`:
   - Sign in → redirected to `/workspaces/new` (because no default workspace yet)
   - Fill form → submit → redirected to `/workspaces/:id`
   - See onboarding content with H1 "Welcome to AnyNote"
   - Click left nav "Настройки" → redirected to `/settings/general`
   - Click "Аккаунт" → taken to `/settings/account`
7. **Unit test for `getActivePlanForUser`** and for the free-plan enforcement branch (requires either a test DB or a Prisma mock).

Tests that **won't** be written this iteration:
- Real OAuth round-trips (no real OAuth).
- Real billing flows (no payment provider).
- Block/page editor (not built).
- Integration credentials encryption.

## 12. Migration strategy

Single Prisma migration named `20260411_workspaces_settings_billing_integrations`. The body is assembled as follows:

1. **Prisma-generated section** (produced by `prisma migrate dev --create-only`):
   - New enums: `RoleType`, `ParentType`, `IntegrationScope`, `IntegrationStatus`, `SubscriptionStatus`.
   - New tables in FK order: `workspaces`, `workspace_members`, `pages`, `user_preferences`, `integration_providers`, `integrations`, `plans`, `subscriptions`.
   - New back-relations on `users` / `sessions` don't add columns — only Prisma-side relations.
2. **Hand-appended raw SQL** (added after Prisma-generated DDL, before Prisma commits the migration):
   - `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the very top (if not already present from a prior migration — check first).
   - `ALTER TABLE integrations ADD CONSTRAINT integrations_scope_target_check ...`
   - `CREATE UNIQUE INDEX integrations_user_provider_unique ...`
   - `CREATE UNIQUE INDEX integrations_workspace_provider_unique ...`
   - `CREATE UNIQUE INDEX subscriptions_one_active_per_user ...`
   - `INSERT INTO integration_providers ...` (5 rows)
   - `INSERT INTO plans ...` (3 rows)
   - `INSERT INTO subscriptions (...) SELECT ... FROM users` (backfill for existing users)
   - `INSERT INTO user_preferences (...) SELECT ... FROM users` (backfill for existing users)

**Reviewability:** the raw SQL block sits after the Prisma-generated DDL in the same `migration.sql` file, separated by a comment banner `-- ---- manual additions below ----`. This keeps the migration single-file and traceable in git without a separate file.

**The TS `seed.ts`** is a secondary tool for fresh environments (dev machine wipe, CI): it `upsert`s the same 5 providers + 3 plans. Running it is a no-op if the migration already seeded them.

## 13. Files to create / modify

### Create

- `packages/db/prisma/migrations/20260411_workspaces_settings_billing_integrations/migration.sql`
- `packages/db/prisma/seed.ts`
- `packages/trpc/src/routers/user.ts`
- `packages/trpc/src/routers/workspace.ts`
- `packages/trpc/src/routers/subscription.ts`
- `packages/trpc/src/routers/integration.ts`
- `packages/trpc/src/helpers/plan.ts`
- `apps/web/src/app/(protected)/layout.tsx`
- `apps/web/src/app/(protected)/app/page.tsx` (moved from `app/app/page.tsx`)
- `apps/web/src/app/(protected)/settings/layout.tsx`
- `apps/web/src/app/(protected)/settings/general/page.tsx`
- `apps/web/src/app/(protected)/settings/account/page.tsx`
- `apps/web/src/app/(protected)/settings/billing/page.tsx`
- `apps/web/src/app/(protected)/settings/integrations/page.tsx`
- `apps/web/src/app/(protected)/workspaces/new/page.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/page.tsx`
- `apps/web/src/components/settings/settings-nav.tsx` (client)
- `apps/web/src/components/settings/*-section.tsx` (profile, theme, notifications, sessions, billing-current, billing-history, integration-card — keep each < ~150 lines)
- `apps/web/src/components/workspace/workspace-shell.tsx`
- `apps/web/src/components/workspace/workspace-sidebar.tsx` (client)
- `apps/web/src/components/workspace/workspace-toolbar.tsx`
- `apps/web/src/components/workspace/workspace-onboarding.tsx` (the checklist)
- `apps/web/src/components/workspace/workspace-ai-panel.tsx` (client)
- `apps/web/src/components/workspace/cookie-banner.tsx` (client)
- `apps/e2e/workspace-flow.spec.ts`

### Modify

- `packages/db/prisma/schema.prisma` — add enums, new models, user back-relations.
- `packages/trpc/src/index.ts` — split into namespaced routers, export combined `appRouter`.
- `packages/auth/src/auth.ts` — add `databaseHooks.user.create.after` for FREE subscription.
- `apps/web/src/app/app/layout.tsx` — delete (auth moved to `(protected)/layout.tsx`).
- `apps/web/src/app/app/page.tsx` — delete after the `(protected)/app/page.tsx` replacement is in place.
- `packages/db/package.json` — add `"prisma": { "seed": "tsx prisma/seed.ts" }` and `prisma:seed` script.

### Delete

- `apps/web/src/app/app/` directory (after the move).

## 14. Risks and open items

- **Prisma `gen_random_uuid()` vs `uuid(7)`.** Existing schema uses `@default(uuid(7))` (Prisma 7 inline function, server-side in the Prisma query engine). All new models in this spec were written with `dbgenerated("gen_random_uuid()")` for consistency with raw-SQL `INSERT` statements in the migration. **Decision at implementation time:** either align all new models to `uuid(7)` (and then the raw-SQL inserts must use a different UUID generation approach, like `gen_random_uuid()` from `pgcrypto` — same function, different call site), or keep `dbgenerated("gen_random_uuid()")` and accept the one-line schema mismatch with the existing models. Pick whichever leaves fewer surprises in generated SQL.
- **`pgcrypto` extension.** Required for `gen_random_uuid()` in raw SQL inserts regardless of which Prisma default is chosen. Migration starts with `CREATE EXTENSION IF NOT EXISTS pgcrypto;`.
- **better-auth `databaseHooks` signature and `changeEmail` endpoint.** Version 1.4.9 must be consulted for (a) the exact `databaseHooks.user.create.after` hook signature (confirm it's `(user) => ...` and not `(data, context) => ...`) and (b) the exact `authClient.changeEmail` / `auth.api.*` endpoint name and required fields. Both should be verified by reading `node_modules/better-auth` types before writing the code, not guessed.
- **Theme cookie mutation from tRPC.** Setting a cookie from inside a tRPC procedure in Next.js App Router is slightly awkward. Fallback if it's too painful: client sets the cookie directly via `document.cookie` + calls the mutation for DB persistence. Cookie-flash is still prevented because the server reads from `user_preferences.theme` first.
- **Integration UNIQUE partial indexes.** The `status IN ('PENDING', 'CONNECTED')` filter means a user can create a DISCONNECTED row, then create a new PENDING/CONNECTED row — by design. Verify that disconnect flows always transition to DISCONNECTED (not delete), to preserve history.
- **Next 16 route group with subsegments.** `(protected)/workspaces/[workspaceId]` — verify that the dynamic segment correctly resolves within a route group in Next 16. If there are any quirks with `notFound()` inside a nested layout in a route group, flag during implementation.

---

## Appendix A: Decision log

| Area | Options | Chosen | Reason |
|---|---|---|---|
| Schema scope | (A) full merge / (B) minimum for current UI / (C) core content | **B** | Focused iteration; pgvector-free; next iterations add their own slice. |
| Integration scope | (A1) user / (A2) workspace / (A3) both | **A3** | GitHub/Telegram are personal, AmoCRM/MangoOffice are corporate. |
| Integration catalog | (B1) static in TS / (B2) table | **B2** | Hundreds of providers planned; table scales, admin UI later. |
| Subscription scope | (A1) user / (A2) workspace / (A3) hybrid | **A3** | "Free = 1 workspace" is a per-user constraint. |
| Plan model | (B1) enum / (B2) plans table / (B3) plans + subscriptions history | **B3** | UI asks for purchase history. |
| Workspace ownership | (A1) via members only / (A2) duplicated owner_id / (A3) members + createdById audit | **A3** | Matches docs/database.md; no denormalization. |
| Default workspace | (B1) user_preferences / (B2) members.is_default | **B1** | Existing column in target schema; simpler invariant. |
| Signup flow | (C1) manual `/workspaces/new` / (C2) auto-create Personal | **C1** | User's explicit requirement. |
| URL structure | (A) flat / (B) all under `/app` / (C) `(protected)` group | **C** | Single auth gate; short URLs; minimal refactor. |
| Theme storage | (A1) client only / (A2) server only / (A3) hybrid | **A3** | Prevents flash of wrong theme, persists across devices. |
| Notifications | (B1) stub / (B2) persisted jsonb | **B2** | Table exists anyway, stub = broken state. |
| Sessions table | (C1) real query / (C2) stub | **C1** | better-auth already writes real data. |
| Notion onboarding data | (A) static JSX / (B) Welcome Page record / (C) hybrid | **A** | B-merge promised minimum tables; welcome is a template, not a page. |
