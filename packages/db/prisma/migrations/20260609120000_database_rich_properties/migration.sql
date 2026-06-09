
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DatabasePropertyType" ADD VALUE 'URL';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'EMAIL';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'PHONE';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'FORMULA';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'RELATION';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'ROLLUP';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'PAGE_LINK';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'CREATED_TIME';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'CREATED_BY';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'LAST_EDITED_TIME';
ALTER TYPE "DatabasePropertyType" ADD VALUE 'LAST_EDITED_BY';

-- CreateTable
CREATE TABLE "database_relation_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "row_id" UUID NOT NULL,
    "target_row_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "database_relation_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_relation_links_property_id_row_id_idx" ON "database_relation_links"("property_id", "row_id");

-- CreateIndex
CREATE INDEX "database_relation_links_target_row_id_idx" ON "database_relation_links"("target_row_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_relation_links_property_id_row_id_target_row_id_key" ON "database_relation_links"("property_id", "row_id", "target_row_id");

-- AddForeignKey
ALTER TABLE "database_relation_links" ADD CONSTRAINT "database_relation_links_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "database_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_relation_links" ADD CONSTRAINT "database_relation_links_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_relation_links" ADD CONSTRAINT "database_relation_links_target_row_id_fkey" FOREIGN KEY ("target_row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

