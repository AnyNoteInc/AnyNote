-- CreateEnum
CREATE TYPE "ReminderAudience" AS ENUM ('ME', 'WORKSPACE', 'LIST');

-- AlterEnum
ALTER TYPE "NotificationEventType" ADD VALUE 'REMINDER_DUE';

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_id" UUID,
    "label" VARCHAR(200),
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "offsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "audience" "ReminderAudience" NOT NULL DEFAULT 'ME',
    "done_at" TIMESTAMPTZ(6),
    "done_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_recipients" (
    "reminder_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "reminder_recipients_pkey" PRIMARY KEY ("reminder_id","user_id")
);

-- CreateIndex
CREATE INDEX "reminders_page_id_deleted_at_idx" ON "reminders"("page_id", "deleted_at");

-- CreateIndex
CREATE INDEX "reminders_workspace_id_due_at_idx" ON "reminders"("workspace_id", "due_at");

-- CreateIndex
CREATE INDEX "reminders_done_at_idx" ON "reminders"("done_at");

-- CreateIndex
CREATE INDEX "reminder_recipients_user_id_idx" ON "reminder_recipients"("user_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_recipients" ADD CONSTRAINT "reminder_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
