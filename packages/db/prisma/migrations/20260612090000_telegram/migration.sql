-- CreateEnum
CREATE TYPE "TelegramConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "TelegramChatStatus" AS ENUM ('ACTIVE', 'LEFT');

-- CreateEnum
CREATE TYPE "TelegramDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TelegramCommandResult" AS ENUM ('OK', 'DENIED', 'ERROR');

-- CreateTable
CREATE TABLE "telegram_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "bot_token_enc" JSONB NOT NULL,
    "bot_username" VARCHAR(64),
    "webhook_secret_enc" JSONB NOT NULL,
    "status" "TelegramConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_chats" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "chat_id" VARCHAR(32) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "title" VARCHAR(255),
    "status" "TelegramChatStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_collection_subscriptions" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "chat_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "events" TEXT[],
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_collection_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_user_links" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "telegram_user_id" VARCHAR(32) NOT NULL,
    "username" VARCHAR(64),
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_user_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_link_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_deliveries" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "event_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" VARCHAR(64),
    "response_snippet" VARCHAR(500),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_bot_command_audits" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "chat_id" VARCHAR(32) NOT NULL,
    "telegram_user_id" VARCHAR(32) NOT NULL,
    "linked_user_id" UUID,
    "command" VARCHAR(32) NOT NULL,
    "args_summary" VARCHAR(200),
    "result" "TelegramCommandResult" NOT NULL,
    "detail" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_bot_command_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_connections_workspace_id_key" ON "telegram_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_chats_connection_id_chat_id_key" ON "telegram_chats"("connection_id", "chat_id");

-- CreateIndex
CREATE INDEX "telegram_collection_subscriptions_connection_id_idx" ON "telegram_collection_subscriptions"("connection_id");

-- CreateIndex
CREATE INDEX "telegram_collection_subscriptions_collection_id_idx" ON "telegram_collection_subscriptions"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_collection_subscriptions_chat_id_collection_id_key" ON "telegram_collection_subscriptions"("chat_id", "collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_user_links_user_id_key" ON "telegram_user_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_user_links_telegram_user_id_key" ON "telegram_user_links"("telegram_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_link_codes_code_hash_key" ON "telegram_link_codes"("code_hash");

-- CreateIndex
CREATE INDEX "telegram_link_codes_user_id_idx" ON "telegram_link_codes"("user_id");

-- CreateIndex
CREATE INDEX "telegram_deliveries_status_next_attempt_at_idx" ON "telegram_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "telegram_deliveries_connection_id_created_at_idx" ON "telegram_deliveries"("connection_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_deliveries_subscription_id_event_id_key" ON "telegram_deliveries"("subscription_id", "event_id");

-- CreateIndex
CREATE INDEX "telegram_bot_command_audits_connection_id_created_at_idx" ON "telegram_bot_command_audits"("connection_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "telegram_connections" ADD CONSTRAINT "telegram_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "telegram_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_collection_subscriptions" ADD CONSTRAINT "telegram_collection_subscriptions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "telegram_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_collection_subscriptions" ADD CONSTRAINT "telegram_collection_subscriptions_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "telegram_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_collection_subscriptions" ADD CONSTRAINT "telegram_collection_subscriptions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_user_links" ADD CONSTRAINT "telegram_user_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "telegram_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "telegram_collection_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_bot_command_audits" ADD CONSTRAINT "telegram_bot_command_audits_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "telegram_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

