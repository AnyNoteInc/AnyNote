-- CreateEnum
CREATE TYPE "ThinkingEffort" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "supports_reasoning" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "ai_model_id" UUID,
ADD COLUMN     "temperature" DOUBLE PRECISION,
ADD COLUMN     "thinking_effort" "ThinkingEffort" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "top_p" DOUBLE PRECISION,
ADD COLUMN     "use_thinking" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "chats_ai_model_id_idx" ON "chats"("ai_model_id");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_ai_model_id_fkey" FOREIGN KEY ("ai_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
