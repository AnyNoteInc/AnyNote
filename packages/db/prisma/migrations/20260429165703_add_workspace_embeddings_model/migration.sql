-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "supports_embeddings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vector_size" INTEGER;

-- AlterTable
ALTER TABLE "workspace_ai_settings" ADD COLUMN     "embeddings_model_id" UUID;

-- CreateIndex
CREATE INDEX "workspace_ai_settings_embeddings_model_id_idx" ON "workspace_ai_settings"("embeddings_model_id");

-- AddForeignKey
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_embeddings_model_id_fkey" FOREIGN KEY ("embeddings_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
