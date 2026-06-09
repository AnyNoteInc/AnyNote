
-- CreateEnum
CREATE TYPE "PageRevisionAction" AS ENUM ('EDIT', 'TITLE_CHANGE', 'MOVE', 'ARCHIVE', 'RESTORE', 'PUBLISH');

-- CreateEnum
CREATE TYPE "PageNotificationLevel" AS ENUM ('ALL_COMMENTS', 'REPLIES_AND_MENTIONS', 'ALL_UPDATES', 'IMPORTANT_UPDATES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventType" ADD VALUE 'COMMENT_REPLY';
ALTER TYPE "NotificationEventType" ADD VALUE 'DATABASE_UPDATE';
ALTER TYPE "NotificationEventType" ADD VALUE 'DATABASE_PERSON_ASSIGNED';
ALTER TYPE "NotificationEventType" ADD VALUE 'DATABASE_DATE_REMINDER';
ALTER TYPE "NotificationEventType" ADD VALUE 'PAGE_REVISION_RESTORED';

-- CreateTable
CREATE TABLE "page_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "PageRevisionAction" NOT NULL,
    "content" JSONB,
    "content_yjs" BYTEA,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "level" "PageNotificationLevel" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "page_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_date_reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "offset_minutes" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_date_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_revisions_page_id_created_at_idx" ON "page_revisions"("page_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "page_notification_preferences_page_id_idx" ON "page_notification_preferences"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_notification_preferences_user_id_page_id_key" ON "page_notification_preferences"("user_id", "page_id");

-- CreateIndex
CREATE INDEX "database_date_reminders_row_id_idx" ON "database_date_reminders"("row_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_date_reminders_property_id_row_id_user_id_key" ON "database_date_reminders"("property_id", "row_id", "user_id");

-- AddForeignKey
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_revisions" ADD CONSTRAINT "page_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_notification_preferences" ADD CONSTRAINT "page_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_notification_preferences" ADD CONSTRAINT "page_notification_preferences_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_date_reminders" ADD CONSTRAINT "database_date_reminders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "database_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_date_reminders" ADD CONSTRAINT "database_date_reminders_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_date_reminders" ADD CONSTRAINT "database_date_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

