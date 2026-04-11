-- Required for gen_random_uuid() in raw SQL inserts below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER', 'GUEST');

-- CreateEnum
CREATE TYPE "ParentType" AS ENUM ('WORKSPACE', 'PAGE', 'DATABASE', 'BLOCK');

-- CreateEnum
CREATE TYPE "IntegrationScope" AS ENUM ('USER', 'WORKSPACE', 'BOTH');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'CANCELED', 'EXPIRED', 'PAST_DUE');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255),
    "icon" VARCHAR(64),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoleType" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "parent_type" "ParentType" NOT NULL,
    "parent_id" UUID,
    "title" TEXT,
    "icon" TEXT,
    "cover_url" TEXT,
    "is_database_row" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "theme" VARCHAR(16),
    "locale" VARCHAR(16),
    "default_workspace_id" UUID,
    "notification_settings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon_url" TEXT,
    "scope" "IntegrationScope" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_schema" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "scope" "IntegrationScope" NOT NULL,
    "user_id" UUID,
    "workspace_id" UUID,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" VARCHAR(255),
    "config" JSONB,
    "credentials" JSONB,
    "connected_at" TIMESTAMPTZ(6),
    "last_sync_at" TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "price_monthly" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
    "max_workspaces" INTEGER,
    "max_members_per_workspace" INTEGER,
    "features" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "payment_provider" VARCHAR(32),
    "provider_subscription_id" VARCHAR(255),
    "amount_paid" INTEGER,
    "currency" VARCHAR(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_created_by_id_idx" ON "workspaces"("created_by_id");

-- CreateIndex
CREATE INDEX "workspace_members_workspace_id_idx" ON "workspace_members"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_role_idx" ON "workspace_members"("user_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "pages_workspace_id_idx" ON "pages"("workspace_id");

-- CreateIndex
CREATE INDEX "pages_parent_type_parent_id_idx" ON "pages"("parent_type", "parent_id");

-- CreateIndex
CREATE INDEX "pages_archived_idx" ON "pages"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "user_preferences_default_workspace_id_idx" ON "user_preferences"("default_workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_slug_key" ON "integration_providers"("slug");

-- CreateIndex
CREATE INDEX "integrations_provider_id_idx" ON "integrations"("provider_id");

-- CreateIndex
CREATE INDEX "integrations_user_id_idx" ON "integrations"("user_id");

-- CreateIndex
CREATE INDEX "integrations_workspace_id_idx" ON "integrations"("workspace_id");

-- CreateIndex
CREATE INDEX "integrations_status_idx" ON "integrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_workspace_id_fkey" FOREIGN KEY ("default_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "integration_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- manual additions below ----

-- Scope invariant: a user-scoped integration must have user_id (not workspace_id), and vice versa.
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_scope_target_check" CHECK (
  ("scope" = 'USER'      AND "user_id" IS NOT NULL AND "workspace_id" IS NULL)
  OR
  ("scope" = 'WORKSPACE' AND "workspace_id" IS NOT NULL AND "user_id" IS NULL)
);

-- Partial uniques: one live (PENDING/CONNECTED) integration per (provider, user) or (provider, workspace).
-- DISCONNECTED rows accumulate for history.
CREATE UNIQUE INDEX "integrations_user_provider_unique"
  ON "integrations" ("provider_id", "user_id")
  WHERE "scope" = 'USER' AND "status" IN ('PENDING', 'CONNECTED');

CREATE UNIQUE INDEX "integrations_workspace_provider_unique"
  ON "integrations" ("provider_id", "workspace_id")
  WHERE "scope" = 'WORKSPACE' AND "status" IN ('PENDING', 'CONNECTED');

-- Only one active subscription per user. Canceled/expired rows accumulate for history.
CREATE UNIQUE INDEX "subscriptions_one_active_per_user"
  ON "subscriptions" ("user_id")
  WHERE "status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE');

-- ---- seed: integration_providers ----
INSERT INTO "integration_providers" ("id", "slug", "name", "description", "scope", "is_enabled", "sort_order", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'yandex',       'Yandex',      'Личный аккаунт Яндекс (диск, почта, календарь)', 'USER',      true, 10, now(), now()),
  (gen_random_uuid(), 'github',       'GitHub',      'Личный GitHub — репозитории, issues, PR',         'USER',      true, 20, now(), now()),
  (gen_random_uuid(), 'telegram',     'Telegram',    'Личный Telegram для уведомлений',                 'USER',      true, 30, now(), now()),
  (gen_random_uuid(), 'amocrm',       'AmoCRM',      'CRM для workspace — сделки, контакты',            'WORKSPACE', true, 40, now(), now()),
  (gen_random_uuid(), 'mango_office', 'MangoOffice', 'Облачная телефония MangoOffice',                  'WORKSPACE', true, 50, now(), now());

-- ---- seed: plans ----
INSERT INTO "plans" ("id", "slug", "name", "description", "price_monthly", "currency", "max_workspaces", "max_members_per_workspace", "features", "is_active", "sort_order", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'free',      'Free',      'Одно пространство, базовые возможности',   0,      'RUB', 1,    1,    '["Одно пространство", "Базовый редактор"]'::jsonb,                       true, 10, now(), now()),
  (gen_random_uuid(), 'personal',  'Personal',  'Для личных проектов и фриланса',            39000,  'RUB', 5,    1,    '["5 пространств", "История версий", "AI поиск"]'::jsonb,                 true, 20, now(), now()),
  (gen_random_uuid(), 'corporate', 'Corporate', 'Для команд и компаний',                     149000, 'RUB', NULL, NULL, '["∞ пространств", "Команды", "SSO", "Приоритетная поддержка"]'::jsonb,   true, 30, now(), now());

-- ---- backfill: every existing user gets a FREE subscription and an empty preference row ----
INSERT INTO "subscriptions" ("id", "user_id", "plan_id", "status", "started_at", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id", p."id", 'ACTIVE', now(), now(), now()
FROM "users" u
CROSS JOIN LATERAL (SELECT "id" FROM "plans" WHERE "slug" = 'free' LIMIT 1) p;

INSERT INTO "user_preferences" ("id", "user_id", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id", now(), now()
FROM "users" u;
