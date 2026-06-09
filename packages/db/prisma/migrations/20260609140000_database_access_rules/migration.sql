
-- CreateEnum
CREATE TYPE "DatabaseAccessLevel" AS ENUM ('CAN_VIEW', 'CAN_COMMENT', 'CAN_EDIT_CONTENT', 'CAN_EDIT', 'FULL_ACCESS');

-- AlterTable
ALTER TABLE "database_sources" ADD COLUMN     "structure_locked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "database_page_access_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "access_level" "DatabaseAccessLevel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_page_access_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_page_access_rules_source_id_idx" ON "database_page_access_rules"("source_id");

-- AddForeignKey
ALTER TABLE "database_page_access_rules" ADD CONSTRAINT "database_page_access_rules_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_page_access_rules" ADD CONSTRAINT "database_page_access_rules_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "database_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

