CREATE TYPE "ChatMessageStatus" AS ENUM ('STREAMING', 'DONE', 'ERROR');

ALTER TABLE "chat_messages"
  ADD COLUMN "status" "ChatMessageStatus" NOT NULL DEFAULT 'DONE',
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6);

UPDATE "chat_messages"
SET "updated_at" = "created_at"
WHERE "updated_at" IS NULL;

ALTER TABLE "chat_messages"
  ALTER COLUMN "updated_at" SET DEFAULT NOW(),
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX "chat_messages_chat_id_status_idx"
  ON "chat_messages" ("chat_id", "status");
