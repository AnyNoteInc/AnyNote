/*
  Warnings:

  - You are about to drop the column `category` on the `page_templates` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[backing_page_id]` on the table `page_templates` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "page_templates" DROP COLUMN "category",
ADD COLUMN     "average_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "backing_page_id" UUID,
ADD COLUMN     "preview_color" TEXT,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "is_template_backing" BOOLEAN NOT NULL DEFAULT false;

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
    "template_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "page_template_tags_pkey" PRIMARY KEY ("template_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_tags_slug_key" ON "template_tags"("slug");

-- CreateIndex
CREATE INDEX "page_template_tags_tag_id_idx" ON "page_template_tags"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_templates_backing_page_id_key" ON "page_templates"("backing_page_id");

-- CreateIndex
CREATE INDEX "pages_is_template_backing_idx" ON "pages"("is_template_backing");

-- AddForeignKey
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_backing_page_id_fkey" FOREIGN KEY ("backing_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_templates" ADD CONSTRAINT "page_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_template_tags" ADD CONSTRAINT "page_template_tags_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "page_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_template_tags" ADD CONSTRAINT "page_template_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "template_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
