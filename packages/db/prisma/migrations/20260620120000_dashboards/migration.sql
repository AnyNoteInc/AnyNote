-- CreateEnum
CREATE TYPE "DashboardWidgetType" AS ENUM ('METRIC', 'GROUPED', 'TABLE', 'BAR', 'LINE', 'DONUT', 'NUMBER');

-- AlterEnum
ALTER TYPE "PageType" ADD VALUE 'DASHBOARD';

-- CreateTable
CREATE TABLE "dashboards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Дашборд',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dashboard_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "view_id" UUID,
    "type" "DashboardWidgetType" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL DEFAULT '{}',
    "grid_x" INTEGER NOT NULL DEFAULT 0,
    "grid_y" INTEGER NOT NULL DEFAULT 0,
    "grid_w" INTEGER NOT NULL DEFAULT 4,
    "grid_h" INTEGER NOT NULL DEFAULT 4,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_global_filters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dashboard_id" UUID NOT NULL,
    "property_name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_global_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_page_id_key" ON "dashboards"("page_id");

-- CreateIndex
CREATE INDEX "dashboards_workspace_id_idx" ON "dashboards"("workspace_id");

-- CreateIndex
CREATE INDEX "dashboard_widgets_dashboard_id_position_idx" ON "dashboard_widgets"("dashboard_id", "position");

-- CreateIndex
CREATE INDEX "dashboard_global_filters_dashboard_id_idx" ON "dashboard_global_filters"("dashboard_id");

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_view_id_fkey" FOREIGN KEY ("view_id") REFERENCES "database_views"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_global_filters" ADD CONSTRAINT "dashboard_global_filters_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

