-- Squashed migration (post v1.23.0): combines the 5 unreleased migrations
--   20260606075218_add_task_actual_date
--   20260606110000_add_page_templates
--   20260607081445_marketplace_templates
--   20260607105258_add_active_workspace_id
--   20260607185058_templates_as_pages
-- into a single net-schema diff. Verified schema-identical to applying the
-- five originals in sequence (tables, columns, indexes, constraints, enums).

-- CreateEnum
CREATE TYPE "PageTemplateScope" AS ENUM ('GLOBAL', 'WORKSPACE');

-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE 'ACTUAL_DATE_CHANGED';

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "is_template" "PageTemplateScope",
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "template_key" TEXT,
ADD COLUMN     "template_meta" JSONB,
ADD COLUMN     "usage_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "active_workspace_id" UUID;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "actual_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "template_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "template_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_template_tags" (
    "page_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "page_template_tags_pkey" PRIMARY KEY ("page_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_tags_slug_key" ON "template_tags"("slug");

-- CreateIndex
CREATE INDEX "page_template_tags_tag_id_idx" ON "page_template_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "pages_template_key_key" ON "pages"("template_key");

-- CreateIndex
CREATE INDEX "pages_is_template_idx" ON "pages"("is_template");

-- CreateIndex
CREATE INDEX "pages_workspace_id_is_template_idx" ON "pages"("workspace_id", "is_template");

-- CreateIndex
CREATE INDEX "user_preferences_active_workspace_id_idx" ON "user_preferences"("active_workspace_id");

-- AddForeignKey
ALTER TABLE "page_template_tags" ADD CONSTRAINT "page_template_tags_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_template_tags" ADD CONSTRAINT "page_template_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "template_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_workspace_id_fkey" FOREIGN KEY ("active_workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
