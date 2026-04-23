ALTER TABLE "chat_messages"
  ADD COLUMN "parts" JSONB NOT NULL DEFAULT '[]';

DROP TABLE "chat_message_files";

ALTER TABLE "chat_messages"
  DROP COLUMN "content";
