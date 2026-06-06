-- CreateEnum
CREATE TYPE "PageTemplateScope" AS ENUM ('GLOBAL', 'WORKSPACE');

-- CreateTable
CREATE TABLE "page_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID,
    "scope" "PageTemplateScope" NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT,
    "type" "PageType" NOT NULL DEFAULT 'TEXT',
    "content" JSONB,
    "content_yjs" BYTEA,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "page_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_templates_key_key" ON "page_templates"("key");

-- CreateIndex
CREATE INDEX "page_templates_workspace_id_idx" ON "page_templates"("workspace_id");

-- CreateIndex
CREATE INDEX "page_templates_scope_idx" ON "page_templates"("scope");

-- CreateIndex
CREATE INDEX "page_templates_created_at_idx" ON "page_templates"("created_at");

-- CreateIndex
CREATE INDEX "page_templates_usage_count_idx" ON "page_templates"("usage_count");

-- AddForeignKey
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
