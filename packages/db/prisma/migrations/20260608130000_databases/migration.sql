
-- CreateEnum
CREATE TYPE "DatabaseViewType" AS ENUM ('TABLE');

-- CreateEnum
CREATE TYPE "DatabasePropertyType" AS ENUM ('TEXT', 'NUMBER', 'STATUS', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'DATE', 'PERSON', 'FILE');

-- CreateTable
CREATE TABLE "database_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "title" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "type" "DatabaseViewType" NOT NULL DEFAULT 'TABLE',
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB,

    CONSTRAINT "database_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "type" "DatabasePropertyType" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "settings" JSONB,

    CONSTRAINT "database_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_cell_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "row_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "value" JSONB,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "database_cell_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "database_sources_page_id_key" ON "database_sources"("page_id");

-- CreateIndex
CREATE INDEX "database_sources_workspace_id_idx" ON "database_sources"("workspace_id");

-- CreateIndex
CREATE INDEX "database_views_source_id_idx" ON "database_views"("source_id");

-- CreateIndex
CREATE INDEX "database_properties_source_id_idx" ON "database_properties"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_rows_page_id_key" ON "database_rows"("page_id");

-- CreateIndex
CREATE INDEX "database_rows_source_id_position_idx" ON "database_rows"("source_id", "position");

-- CreateIndex
CREATE INDEX "database_rows_page_id_idx" ON "database_rows"("page_id");

-- CreateIndex
CREATE INDEX "database_cell_values_row_id_idx" ON "database_cell_values"("row_id");

-- CreateIndex
CREATE UNIQUE INDEX "database_cell_values_row_id_property_id_key" ON "database_cell_values"("row_id", "property_id");

-- AddForeignKey
ALTER TABLE "database_sources" ADD CONSTRAINT "database_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_sources" ADD CONSTRAINT "database_sources_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_views" ADD CONSTRAINT "database_views_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_properties" ADD CONSTRAINT "database_properties_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_rows" ADD CONSTRAINT "database_rows_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_rows" ADD CONSTRAINT "database_rows_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_cell_values" ADD CONSTRAINT "database_cell_values_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "database_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_cell_values" ADD CONSTRAINT "database_cell_values_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "database_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

