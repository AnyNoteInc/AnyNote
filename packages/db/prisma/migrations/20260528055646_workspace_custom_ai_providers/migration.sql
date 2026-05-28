/*
  Warnings:

  - You are about to drop the column `chat_model_connection` on the `workspace_ai_settings` table. All the data in the column will be lost.
  - You are about to drop the column `embedding_model_connection` on the `workspace_ai_settings` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[workspace_id,slug]` on the table `ai_providers` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `kind` to the `ai_providers` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('OLLAMA', 'OPENAI', 'GIGACHAT', 'YANDEXGPT', 'ANTHROPIC', 'DEEPSEEK');

-- DropIndex
DROP INDEX "ai_providers_slug_key";

-- AlterTable
ALTER TABLE "ai_providers" ADD COLUMN     "connection_enc" JSONB,
ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "kind" "AiProviderKind",
ADD COLUMN     "workspace_id" UUID;
UPDATE "ai_providers" SET "kind" = UPPER("slug")::"AiProviderKind";
ALTER TABLE "ai_providers" ALTER COLUMN "kind" SET NOT NULL;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "custom_ai_providers_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "workspace_ai_settings" DROP COLUMN "chat_model_connection",
DROP COLUMN "embedding_model_connection";

-- CreateIndex
CREATE INDEX "ai_providers_workspace_id_idx" ON "ai_providers"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_workspace_id_slug_key" ON "ai_providers"("workspace_id", "slug");

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shared providers (workspace_id IS NULL) keep globally-unique slugs
CREATE UNIQUE INDEX "ai_providers_global_slug_key" ON "ai_providers" ("slug") WHERE "workspace_id" IS NULL;
