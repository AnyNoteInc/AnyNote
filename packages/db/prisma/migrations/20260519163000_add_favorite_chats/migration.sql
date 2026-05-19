CREATE TABLE "favorite_chats" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "favorite_chats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "favorite_chats_user_id_chat_id_key" ON "favorite_chats"("user_id", "chat_id");
CREATE INDEX "favorite_chats_user_id_idx" ON "favorite_chats"("user_id");

ALTER TABLE "favorite_chats"
  ADD CONSTRAINT "favorite_chats_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "favorite_chats"
  ADD CONSTRAINT "favorite_chats_chat_id_fkey"
  FOREIGN KEY ("chat_id") REFERENCES "chats"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
