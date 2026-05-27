-- DropIndex
DROP INDEX "api_keys_key_hash_idx";

-- DropIndex
DROP INDEX "api_keys_user_id_idx";

-- CreateIndex
CREATE INDEX "api_keys_user_id_created_at_idx" ON "api_keys"("user_id", "created_at" DESC);
