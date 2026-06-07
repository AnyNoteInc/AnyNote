-- DropForeignKey
ALTER TABLE "page_templates" DROP CONSTRAINT "page_templates_workspace_id_fkey";

-- DropForeignKey
ALTER TABLE "page_templates" DROP CONSTRAINT "page_templates_backing_page_id_fkey";

-- DropForeignKey
ALTER TABLE "page_templates" DROP CONSTRAINT "page_templates_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "page_template_tags" DROP CONSTRAINT "page_template_tags_template_id_fkey";

-- DropIndex
DROP INDEX "pages_is_template_backing_idx";

-- AlterTable
ALTER TABLE "pages" DROP COLUMN "is_template_backing",
ADD COLUMN     "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "is_template" "PageTemplateScope",
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "template_key" TEXT,
ADD COLUMN     "template_meta" JSONB,
ADD COLUMN     "usage_count" INTEGER NOT NULL DEFAULT 0;

-- Clear orphaned tag links: the junction repoints from page_templates (being
-- dropped) to pages, so the old template_id rows cannot carry over. Template
-- tags are re-seeded against template pages.
DELETE FROM "page_template_tags";

-- AlterTable
ALTER TABLE "page_template_tags" DROP CONSTRAINT "page_template_tags_pkey",
DROP COLUMN "template_id",
ADD COLUMN     "page_id" UUID NOT NULL,
ADD CONSTRAINT "page_template_tags_pkey" PRIMARY KEY ("page_id", "tag_id");

-- DropTable
DROP TABLE "page_templates";

-- CreateIndex
CREATE UNIQUE INDEX "pages_template_key_key" ON "pages"("template_key");

-- CreateIndex
CREATE INDEX "pages_is_template_idx" ON "pages"("is_template");

-- CreateIndex
CREATE INDEX "pages_workspace_id_is_template_idx" ON "pages"("workspace_id", "is_template");

-- AddForeignKey
ALTER TABLE "page_template_tags" ADD CONSTRAINT "page_template_tags_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

