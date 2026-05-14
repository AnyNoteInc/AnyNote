-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('SERVICE', 'SECURITY', 'COLLABORATION', 'MARKETING');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD', 'PASSWORD_CHANGED', 'EMAIL_CHANGED', 'WELCOME', 'ACCOUNT_DELETION_REQUESTED', 'ACCOUNT_DELETION_COMPLETED', 'NEW_LOGIN', 'SUSPICIOUS_ACTIVITY', 'WORKSPACE_INVITE', 'ROLE_CHANGED', 'PAGE_MENTION', 'COMMENT_CREATED', 'WEEKLY_DIGEST', 'PRODUCT_UPDATE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WEB_PUSH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "notification_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "NotificationEventType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_id" UUID,
    "resource_url" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_in_app" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_in_app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(64),
    "target_email" VARCHAR(255),
    "target_subscription_id" UUID,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" VARCHAR(1024),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_events_user_id_created_at_idx" ON "notification_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_events_workspace_id_idx" ON "notification_events"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_in_app_event_id_key" ON "notification_in_app"("event_id");

-- CreateIndex
CREATE INDEX "notification_in_app_user_id_created_at_idx" ON "notification_in_app"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_in_app_user_id_read_at_idx" ON "notification_in_app"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_event_id_idx" ON "notification_deliveries"("event_id");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_channel_key" ON "notification_preferences"("user_id", "category", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_in_app" ADD CONSTRAINT "notification_in_app_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_in_app" ADD CONSTRAINT "notification_in_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "notification_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_target_subscription_id_fkey" FOREIGN KEY ("target_subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill notification_preferences from old user_preferences.notification_settings JSON.
INSERT INTO notification_preferences (id, user_id, category, channel, enabled, updated_at)
SELECT
  gen_random_uuid(),
  user_id,
  'COLLABORATION'::"NotificationCategory",
  'EMAIL'::"NotificationChannel",
  COALESCE((notification_settings -> 'email' ->> 'mentions')::boolean, true)
    AND COALESCE((notification_settings -> 'email' ->> 'comments')::boolean, true),
  now()
FROM user_preferences
WHERE notification_settings IS NOT NULL
ON CONFLICT (user_id, category, channel) DO NOTHING;

INSERT INTO notification_preferences (id, user_id, category, channel, enabled, updated_at)
SELECT
  gen_random_uuid(),
  user_id,
  'MARKETING'::"NotificationCategory",
  'EMAIL'::"NotificationChannel",
  COALESCE((notification_settings -> 'email' ->> 'weeklyDigest')::boolean, false),
  now()
FROM user_preferences
WHERE notification_settings IS NOT NULL
ON CONFLICT (user_id, category, channel) DO NOTHING;

-- Idempotency partial unique indexes (NULL-safe).
CREATE UNIQUE INDEX notification_deliveries_email_idem
  ON notification_deliveries (event_id, user_id)
  WHERE channel = 'EMAIL';

CREATE UNIQUE INDEX notification_deliveries_push_idem
  ON notification_deliveries (event_id, user_id, target_subscription_id)
  WHERE channel = 'WEB_PUSH';
