-- CreateTable
CREATE TABLE "workspace_ai_settings" (
    "workspace_id" UUID NOT NULL,
    "default_model_id" UUID,
    "system_prompt_page_id" UUID,
    "temperature" DOUBLE PRECISION,
    "max_output_tokens" INTEGER,
    "top_p" DOUBLE PRECISION,
    "provider_credentials" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_ai_settings_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateIndex
CREATE INDEX "workspace_ai_settings_default_model_id_idx" ON "workspace_ai_settings"("default_model_id");

-- CreateIndex
CREATE INDEX "workspace_ai_settings_system_prompt_page_id_idx" ON "workspace_ai_settings"("system_prompt_page_id");

-- AddForeignKey
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_default_model_id_fkey" FOREIGN KEY ("default_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_system_prompt_page_id_fkey" FOREIGN KEY ("system_prompt_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
